/**
 * The viewer is typing in a text field (an editable input, textarea or
 * contenteditable has the focus). The remote's Search / voice key is then the
 * system keyboard's (its own "speak instead of typing" dictation), never SMC's
 * voice commands: taking it there is what made dictation disappear.
 */
export function typingInField(doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    return !el.readOnly && !el.disabled && ['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(type);
  }
  return false;
}
