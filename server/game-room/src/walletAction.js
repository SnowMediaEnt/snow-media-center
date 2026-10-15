import { getOrCreateBalance } from './chips.js';

// One wallet is shared by every game and every connection for this user.
// Serialize the complete affordability check + settlement, not just debits.
const pending = new Map();
export async function walletAction(userId, action) {
  const previous = pending.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    try {
      return await action();
    } catch (error) {
      const message = String(error?.message ?? '');
      const insufficient = /insufficient_(chips|balance)/i.test(message)
        || (error?.code === '23514' && /play_chips.*balance|balance.*check/i.test(message));
      if (!insufficient) throw error;
      return { ok: false, error: 'insufficient_balance', balance: await getOrCreateBalance(userId) };
    }
  });
  pending.set(userId, current);
  try { return await current; }
  finally { if (pending.get(userId) === current) pending.delete(userId); }
}
