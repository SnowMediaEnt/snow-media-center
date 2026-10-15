// Run on the VPS with its existing .env. Creates and removes only its own
// temporary test account; no customer wallet or credentials are used.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';
import { supabase } from '../src/supabase.js';
import { env } from '../src/config.js';

let userId;
let socket;
try {
  for(let attempt=0;attempt<30;attempt+=1){
    try { if((await fetch(`http://127.0.0.1:${env.port}/health`)).ok) break; } catch {}
    if(attempt===29)throw new Error('game_server_not_ready');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email: `arcade-${randomUUID()}@smc-test.invalid`, password: randomBytes(32).toString('hex'), email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
  const token = jwt.sign({ sub: userId, role: 'authenticated', aud: 'authenticated' }, env.supabaseJwtSecret, { expiresIn: '5m' });
  socket = io('https://smcdreamstreams.store', { path: '/gamesocket', auth: { token }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve,reject) => { socket.once('connect',resolve); socket.once('connect_error',reject); });
  const emit = async (event,payload) => {
    // Respect the same two-events/second budget as a real remote client.
    await new Promise(resolve=>setTimeout(resolve,550));
    return new Promise((resolve,reject) => socket.timeout(15000).emit(event,payload,(error,response) => error ? reject(error) : resolve(response)));
  };
  const initial = await emit('whoami',{});
  assert.equal(initial.balance,100);
  const legacy = await emit('arcade_play',{game:'dice',bet:100,dice:[6,6,6,6,6]});
  assert.equal(legacy.error,'game_update_required');
  const requestId=randomUUID();
  let dice = await emit('arcade_start',{game:'dice',requestId,bet:25});
  assert.equal(dice.ok,true);
  assert.equal(dice.balance,75);
  const retry = await emit('arcade_start',{game:'dice',requestId,bet:25});
  assert.deepEqual(retry.dice,dice.dice);
  assert.equal(retry.balance,75);
  const firstFace = dice.dice[0];
  dice = await emit('arcade_action',{game:'dice',sessionId:dice.sessionId,version:dice.version,action:'roll',holds:[true,false,false,false,false]});
  assert.equal(dice.dice[0],firstFace);
  assert.equal(dice.rollsUsed,2);
  const recovered=await emit('arcade_state',{game:'dice'});
  assert.deepEqual(recovered.dice,dice.dice);
  const bankAction={game:'dice',sessionId:dice.sessionId,version:dice.version,action:'bank'};
  dice=await emit('arcade_action',bankAction);
  assert.equal(dice.ok,true); assert.equal(dice.status,'settled');
  const paidAgain=await emit('arcade_action',bankAction);
  assert.equal(paidAgain.balance,dice.balance);
  assert.equal(paidAgain.alreadySettled,true);
  let trivia=await emit('arcade_start',{game:'trivia',requestId:randomUUID(),mode:'snow',difficulty:'easy',bet:10});
  assert.equal(trivia.ok,true);
  assert.equal('correct' in trivia.question,false);
  assert.equal('fact' in trivia.question,false);
  const forged=await emit('arcade_action',{game:'trivia',sessionId:trivia.sessionId,version:trivia.version,action:'answer',score:999999});
  assert.equal(forged.error,'invalid_arcade_action');
  for(let index=0;index<10;index+=1){
    const {data:session,error}=await supabase.from('arcade_sessions').select('state').eq('id',trivia.sessionId).eq('user_id',userId).single();
    if(error)throw error;
    const question=session.state.questions[index];
    trivia=await emit('arcade_action',{game:'trivia',sessionId:trivia.sessionId,version:trivia.version,
      action:'answer',questionId:trivia.question.id,answerIndex:question.correct});
    assert.equal(trivia.ok,true);
    if(index<9)trivia=await emit('arcade_action',{game:'trivia',sessionId:trivia.sessionId,version:trivia.version,action:'next'});
  }
  assert.equal(trivia.status,'settled');
  assert.equal(trivia.correctCount,10);
  assert.equal(trivia.payout,34);
  const {data:rounds,error:roundError}=await supabase.from('game_rounds').select('game,result').eq('user_id',userId);
  if(roundError)throw roundError;
  assert.equal(rounds.length,2);
  assert.ok(rounds.every(round=>round.result.verified===true));
  console.log('PASS: live auth, Dice roll/hold/recovery/bank, Trivia grading, forged-outcome denial, single debit, single payout, and verified records.');
} catch(error) {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode=1;
} finally {
  socket?.disconnect();
  if(userId){
    const {error}=await supabase.auth.admin.deleteUser(userId);
    if(error)throw error;
    console.log('Temporary smoke-test account and its game records removed.');
  }
}
