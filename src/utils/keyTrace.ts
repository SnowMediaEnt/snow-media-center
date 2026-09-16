/**
 * A short, in-memory record of what the keyboard path saw: which keys
 * reached a text field, what the platform said about keyboard visibility,
 * and what the focus hook decided. It exists because none of this can be
 * watched on a TV from a desk — the sign-in form shows the last few entries
 * so one screenshot from the box says exactly which layer dropped the ball.
 */
const MAX = 8;
const entries: string[] = [];
const listeners = new Set<(lines: string[]) => void>();

export const traceKey = (line: string) => {
  entries.push(line);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  const snapshot = entries.slice();
  listeners.forEach((cb) => { try { cb(snapshot); } catch { /* never break a key press */ } });
};

export const getKeyTrace = () => entries.slice();

export const onKeyTrace = (cb: (lines: string[]) => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
