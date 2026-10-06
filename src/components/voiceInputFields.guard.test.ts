/**
 * The Fire TV keyboard's "speak instead of typing" key, like Gboard's mic,
 * shows only on plain free-text fields. Android keyboards drop it for
 * password, email and URL fields, for TYPE_TEXT_FLAG_NO_SUGGESTIONS (which
 * the WebView sets for autocomplete="off"; autocorrect="off" and
 * spellcheck="false" turn suggestions down too), and for number/phone/email
 * input modes. enterkeyhint changes the keyboard's action on newer WebViews;
 * the one field the owner saw the key on (Plex search) has none, so these
 * fields carry none either.
 *
 * This guard reads the source: each field below must stay a plain text box.
 * Sign-in and password fields are the opposite and must keep type="password".
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

/** Where speaking makes sense: file, and a string found only in that field's opening tag. */
const FREE_TEXT_FIELDS: Array<[string, string, string]> = [
  ['Support → AI Chat ask box', 'src/components/ChatCommunity.tsx', 'data-howto="ai.input"'],
  ['AI Chat new ticket subject', 'src/components/ChatCommunity.tsx', 'data-focus-id="new-subject"'],
  ['AI Chat new ticket message', 'src/components/ChatCommunity.tsx', 'data-focus-id="new-message"'],
  ['AI Chat ticket reply', 'src/components/ChatCommunity.tsx', 'data-focus-id="reply-input"'],
  ['Ticket subject', 'src/components/SupportTicketSystem.tsx', 'data-tv-focus-id="create-subject"'],
  ['Ticket message', 'src/components/SupportTicketSystem.tsx', 'data-tv-focus-id="create-message"'],
  ['Ticket reply', 'src/components/SupportTicketSystem.tsx', 'data-tv-focus-id="ticket-reply"'],
  ['Ticket AI chat', 'src/components/SupportTicketSystem.tsx', 'data-tv-focus-id="ai-chat-input"'],
  ['Ticket AI new chat', 'src/components/SupportTicketSystem.tsx', 'data-tv-focus-id="ai-new-input"'],
  ['AI Conversations ask', 'src/components/AIConversationSystem.tsx', "placeholder={t('ai.conversations.askPlaceholder')}"],
  ['AI Conversations reply', 'src/components/AIConversationSystem.tsx', "placeholder={t('ai.conversations.typePlaceholder')}"],
  ['Plex search', 'src/components/livetv/PlexSection.tsx', "placeholder={t('plex.search.placeholder')}"],
  ['Plex request search', 'src/components/livetv/OverseerrRequestPanel.tsx', "placeholder={t('plex.request.searchPlaceholder')}"],
  ['Live TV channel search', 'src/components/livetv/LiveSection.tsx', 'data-howto="live.searchBox"'],
  ['Live TV VOD movie search', 'src/components/livetv/MoviesSection.tsx', 'ref={searchInputRef}'],
  ['Live TV VOD series search', 'src/components/livetv/SeriesSection.tsx', 'ref={searchInputRef}'],
  ['Report a channel note', 'src/components/livetv/ReportChannelDialog.tsx', "placeholder={t('live.report.placeholder')}"],
  ['Recording rename', 'src/components/livetv/RecordingsScreen.tsx', 'value={text}'],
  ['Community chat message', 'src/components/CommunityChat.tsx', 'data-tv-focus-id="input"'],
  ['Remote help issue', 'src/components/RemoteSupport.tsx', 'data-tv-focus-id="rs-issue"'],
  ['Remote help needs', 'src/components/RemoteSupport.tsx', 'data-tv-focus-id="rs-needs"'],
  ['Buffering report name', 'src/components/BufferingGuide.tsx', 'onChange={(e) => onTitleChange(e.target.value)}'],
  ['App review comment', 'src/components/review/ReviewDialog.tsx', 'data-tv-focus-id="review-text"'],
];

/** Fields that must keep the keyboard's voice key off. */
const PASSWORD_FIELDS: Array<[string, string, string]> = [
  ['Vibez sign-in password', 'src/components/getstarted/VibezSignInScreen.tsx', 'id="vs-pass"'],
  ['Billing password', 'src/components/billing/BillingAuthForm.tsx', 'id="ba-pass"'],
  ['Live TV password', 'src/components/livetv/CredentialsForm.tsx', 'id="lt-pass"'],
  ['Ticket account password', 'src/components/SupportTicketSystem.tsx', 'value={accountPassword}'],
];

const OPENERS = ['<input', '<Input', '<textarea', '<Textarea'];

/** The whole opening tag (attributes included) of the field holding `anchor`. */
function openingTag(file: string, anchor: string): string {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`${file}: "${anchor}" not found`);
  if (src.indexOf(anchor, at + 1) >= 0) throw new Error(`${file}: "${anchor}" is not unique`);
  const start = Math.max(...OPENERS.map((o) => src.lastIndexOf(o, at)));
  if (start < 0) throw new Error(`${file}: no field opens before "${anchor}"`);
  // Walk to the tag's own ">", skipping the ones inside {...} and quotes.
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (depth === 0 && c === '>') {
      const tag = src.slice(start, i + 1);
      if (!tag.includes(anchor)) throw new Error(`${file}: "${anchor}" is not inside the field's tag`);
      return tag;
    }
  }
  throw new Error(`${file}: unterminated tag at "${anchor}"`);
}

describe('free-text fields keep the keyboard voice key', () => {
  it.each(FREE_TEXT_FIELDS)('%s', (_name, file, anchor) => {
    const tag = openingTag(file, anchor);
    const type = /\btype=["']([^"']+)["']/.exec(tag)?.[1];
    expect(type === undefined || type === 'text', `type="${type}"`).toBe(true);
    expect(tag).not.toMatch(/\bautoComplete=/);
    expect(tag).not.toMatch(/\bautoCorrect=/);
    expect(tag).not.toMatch(/\bspellCheck=\{?\s*false/);
    expect(tag).not.toMatch(/\binputMode=/);
    expect(tag).not.toMatch(/\benterKeyHint=/);
  });
});

describe('password fields keep voice off', () => {
  it.each(PASSWORD_FIELDS)('%s', (_name, file, anchor) => {
    expect(openingTag(file, anchor)).toMatch(/\btype="password"/);
  });
});
