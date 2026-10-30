// A message another screen hands to the AI chat to send as the viewer's own
// (Support › Device check's "Ask the assistant", ported from Tronix). Support
// opens its AI tab; ChatCommunity takes the message once it is ready (signed
// out, or the account's profile loaded so the credit check is real) or,
// already open, on ASSISTANT_HANDOFF_EVENT, and sends it like a typed one: the
// same credits, free-AI gate and Kids rules. Kept for this run only, never stored.
export const ASSISTANT_HANDOFF_EVENT = 'assistant-chat:handoff';

let pending: string | null = null;

export function handAssistant(message: string): void {
  const m = message.trim();
  if (!m) return;
  pending = m;
  try { window.dispatchEvent(new CustomEvent(ASSISTANT_HANDOFF_EVENT)); } catch { /* taken on mount */ }
}

/** Whether a message is waiting (without taking it). */
export const hasAssistantHandoff = (): boolean => pending !== null;

/** Dropped unsent (the screen that handed it went away). */
export function clearAssistantHandoff(): void { pending = null; }

/** The handed message, once. */
export function takeAssistantHandoff(): string | null {
  const m = pending;
  pending = null;
  return m;
}
