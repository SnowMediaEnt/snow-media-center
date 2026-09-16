export const TV_BETS = [10, 25, 50, 100, 250, 500, 1000] as const;

export const readSavedBet = (key: string, fallback = TV_BETS[0]): number => {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = Number(window.localStorage.getItem(key));
    return (TV_BETS as readonly number[]).includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

export const saveSelectedBet = (key: string, value: number): void => {
  try { window.localStorage.setItem(key, String(value)); } catch { /* TV storage may be locked */ }
};
