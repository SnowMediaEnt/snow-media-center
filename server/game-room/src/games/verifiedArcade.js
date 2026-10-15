import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { supabase } from '../supabase.js';
import { getOrCreateBalance } from '../chips.js';
import { _internal as arcadeRules } from './arcade.js';

const FALLBACK = JSON.parse(readFileSync(new URL('./triviaBank.json', import.meta.url), 'utf8'));
const DIFFICULTIES = ['easy', 'standard', 'expert'];
const TRIVIA_BETS = { easy: 10, standard: 25, expert: 50 };
const POINTS = { easy: 1, standard: 1.5, expert: 2 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
const outcomeFields = ['dice', 'score', 'payout', 'correct', 'correctCount', 'total', 'multiplier'];

export function triviaReturn(correct, total, difficulty) {
  const ratio = correct / total;
  const base = ratio === 1 ? 4 : ratio >= .8 ? 2 : ratio >= .6 ? 1.25 : ratio >= .4 ? .5 : 0;
  return Math.round(base * (difficulty === 'expert' ? 1.25 : difficulty === 'easy' ? .85 : 1) * 100) / 100;
}

// The only DTO sent to a device. The stored question bank, future questions,
// grading keys, and source-document fields never leave the server session.
export function publicSession(session, balance, extras = {}) {
  const state = session.state;
  const result = session.result ?? {};
  const common = { ok: true, game: session.game, sessionId: session.id, version: session.version,
    status: session.status, bet: session.bet, balance, expiresAt: session.expires_at,
    ...result, ...extras };
  if (session.game === 'dice') {
    const scored = arcadeRules.diceScore(state.dice);
    return { ...common, dice: state.dice, holds: state.holds, rollsUsed: state.rollsUsed,
      category: scored.key, score: scored.score, multiplier: arcadeRules.DICE_RETURN[scored.key] };
  }
  const question = state.questions[state.index];
  const answer = state.answers[state.index];
  return { ...common, mode: state.mode, difficulty: state.difficulty,
    questionIndex: state.index, total: state.questions.length,
    correctCount: state.correctCount, score: state.score, streak: state.streak, bestStreak: state.bestStreak,
    selectedAnswer: answer?.selected ?? null, pointsAwarded: answer?.points ?? 0,
    question: { id: question.id, category: question.category, categoryLabel: question.categoryLabel,
      prompt: question.prompt, answers: question.answers, points: question.points ?? 100,
      ...(answer ? { correct: question.correct, fact: question.fact } : {}) } };
}

export function createVerifiedArcade({ db = supabase, getBalance = getOrCreateBalance,
  draw = (max) => randomInt(max), uuid = randomUUID, now = Date.now, fallback = FALLBACK } = {}) {
  let cachedBank;
  let cacheUntil = 0;
  async function loadBank() {
    if (cachedBank && cacheUntil > now()) return cachedBank;
    const { data, error } = await db.from('trivia_questions')
      .select('slug,topic,difficulty,prompt,answers,correct_index,fact,points')
      .eq('is_published', true).order('sort_order', { ascending: true }).limit(300);
    if (error) throw error;
    const merged = new Map(fallback.map((question) => [question.id, question]));
    for (const row of data ?? []) {
      if (!row.slug || !row.prompt || !Array.isArray(row.answers) || row.answers.length !== 4
        || !Number.isInteger(row.correct_index) || row.correct_index < 0 || row.correct_index > 3) continue;
      merged.set(row.slug, { id: row.slug, category: 'snow', categoryLabel: `Snow Media · ${row.topic}`,
        topic: row.topic, difficulty: row.difficulty ?? 'easy', prompt: row.prompt,
        answers: row.answers, correct: row.correct_index, fact: row.fact,
        points: Math.max(25, Math.min(500, row.points || 100)) });
    }
    cachedBank = [...merged.values()];
    cacheUntil = now() + 300_000;
    return cachedBank;
  }
  const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = draw(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  async function read(userId, game, id) {
    let query = db.from('arcade_sessions').select('*').eq('user_id', userId).eq('game', game);
    query = id ? query.eq('id', id) : query.eq('status', 'active');
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }
  async function state(userId, payload) {
    const { game, sessionId } = payload ?? {};
    if (!['dice', 'trivia'].includes(game) || (sessionId && !UUID.test(sessionId))) return { ok: false, error: 'invalid_session' };
    const session = await read(userId, game, sessionId);
    const balance = await getBalance(userId);
    if (!session) return { ok: true, game, status: 'ready', balance };
    if (session.status === 'active' && Date.parse(session.expires_at) <= now()) return { ok: true, game, status: 'ready', balance, expired: true };
    return publicSession(session, balance, { resumed: true });
  }
  async function start(userId, payload) {
    const { game, requestId, bet, mode, difficulty } = payload ?? {};
    if (!['dice', 'trivia'].includes(game) || !UUID.test(requestId ?? '')
      || outcomeFields.some((key) => has(payload, key))) return { ok: false, error: 'invalid_arcade_start' };
    if (game === 'dice' && !arcadeRules.ARCADE_BETS.includes(bet)) return { ok: false, error: 'invalid_bet' };
    if (game === 'trivia' && (!['snow', 'mixed'].includes(mode) || !DIFFICULTIES.includes(difficulty)
      || bet !== TRIVIA_BETS[difficulty])) return { ok: false, error: 'invalid_challenge' };
    // A retry after an ACK was lost must return the same round, even if it has
    // since settled. A fresh request cannot discard an unfinished paid round.
    const existing = await read(userId, game, requestId) ?? await read(userId, game);
    if (existing && (existing.status !== 'active' || Date.parse(existing.expires_at) > now())) {
      return publicSession(existing, await getBalance(userId), { resumed: true });
    }
    let nextState;
    if (game === 'dice') {
      nextState = { dice: Array.from({ length: 5 }, () => draw(6) + 1), holds: Array(5).fill(false), rollsUsed: 1 };
    } else {
      const bank = (await loadBank()).filter((q) => mode === 'snow'
        ? q.category === 'snow' && q.difficulty === difficulty : q.category !== 'snow');
      if (bank.length < 10) return { ok: false, error: 'questions_unavailable' };
      // Randomize both question order and answer positions for every session.
      const questions = shuffle(bank).slice(0, 10).map((question) => {
        const order = shuffle([0, 1, 2, 3]);
        return { ...question, sourceId: question.id, id: uuid(),
          answers: order.map((index) => question.answers[index]), correct: order.indexOf(question.correct) };
      });
      nextState = { mode, difficulty, questions, index: 0, answers: [], score: 0,
        correctCount: 0, streak: 0, bestStreak: 0 };
    }
    const { data, error } = await db.rpc('start_verified_arcade', {
      p_user: userId, p_id: requestId, p_game: game, p_bet: bet, p_state: nextState,
    });
    if (error) throw error;
    return publicSession(data.session, data.balance, { resumed: data.resumed });
  }
  async function action(userId, payload) {
    const { game, sessionId, version, action: intent } = payload ?? {};
    if (!['dice', 'trivia'].includes(game) || !UUID.test(sessionId ?? '')
      || !Number.isSafeInteger(version) || version < 0
      || outcomeFields.some((key) => has(payload, key))) return { ok: false, error: 'invalid_arcade_action' };
    const session = await read(userId, game, sessionId);
    if (!session) return { ok: false, error: 'round_not_found' };
    if (session.status !== 'active' || session.version !== version) {
      return publicSession(session, await getBalance(userId), { alreadySettled: session.status === 'settled', resynced: true });
    }
    if (Date.parse(session.expires_at) <= now()) return { ok: false, error: 'round_expired' };
    const next = structuredClone(session.state);
    let result = null;
    if (game === 'dice') {
      if (intent === 'roll') {
        const holds = payload.holds;
        if (!Array.isArray(holds) || holds.length !== 5 || holds.some((held) => typeof held !== 'boolean')
          || holds.every(Boolean) || next.rollsUsed >= 3) return { ok: false, error: 'invalid_roll' };
        next.dice = next.dice.map((face, index) => holds[index] ? face : draw(6) + 1);
        next.holds = [...holds];
        next.rollsUsed += 1;
      } else if (intent === 'bank') {
        const scored = arcadeRules.diceScore(next.dice);
        const multiplier = arcadeRules.DICE_RETURN[scored.key];
        result = { dice: next.dice, category: scored.key, score: scored.score, multiplier,
          payout: Math.round(session.bet * multiplier), mode: 'classic' };
      } else return { ok: false, error: 'invalid_action' };
    } else if (intent === 'answer') {
      const question = next.questions[next.index];
      if (payload.questionId !== question.id || !Number.isInteger(payload.answerIndex)
        || payload.answerIndex < 0 || payload.answerIndex > 3 || next.answers[next.index]) {
        return { ok: false, error: 'invalid_answer' };
      }
      const correct = payload.answerIndex === question.correct;
      const points = correct ? Math.round((question.points ?? 100) * POINTS[next.difficulty]) + next.streak * 25 : 0;
      next.answers.push({ selected: payload.answerIndex, points });
      next.correctCount += Number(correct);
      next.score += points;
      next.streak = correct ? next.streak + 1 : 0;
      next.bestStreak = Math.max(next.bestStreak, next.streak);
      if (next.answers.length === next.questions.length) {
        const multiplier = triviaReturn(next.correctCount, next.questions.length, next.difficulty);
        result = { correct: next.correctCount, total: next.questions.length, score: next.score,
          difficulty: next.difficulty, mode: next.mode, multiplier, payout: Math.round(session.bet * multiplier) };
      }
    } else if (intent === 'next') {
      if (!next.answers[next.index] || next.index >= next.questions.length - 1) return { ok: false, error: 'answer_required' };
      next.index += 1;
    } else return { ok: false, error: 'invalid_action' };
    const { data, error } = await db.rpc('advance_verified_arcade', {
      p_user: userId, p_id: sessionId, p_version: version, p_state: next, p_result: result,
    });
    if (error) throw error;
    return publicSession(data.session, data.balance, { alreadySettled: data.alreadySettled, resynced: data.resynced });
  }
  return { start, state, action };
}

const service = createVerifiedArcade();
export const startVerifiedArcade = service.start;
export const verifiedArcadeState = service.state;
export const verifiedArcadeAction = service.action;
