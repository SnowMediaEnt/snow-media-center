import { Fragment, type ReactNode } from 'react';

/**
 * The little Markdown the AI answers in (see components/ChatMarkdown.tsx):
 * blocks from the reply's lines, and bold / italic / code / link text inside
 * a line as React elements. Nothing here builds HTML from the text: every
 * piece becomes a React text node, which React escapes.
 */

export type ChatBlock =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: { n: string; text: string }[] }
  | { kind: 'hr' };

const headingRe = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const bulletRe = /^\s*[-*+•]\s+(.*)$/;
const numberedRe = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const ruleRe = /^\s*([-*_])(\s*\1){2,}\s*$/;
const fenceRe = /^\s*```/;
const quoteRe = /^\s*>\s?/;

/** Splits a reply into paragraphs, headings, lists and rules. */
export function parseChatMarkdown(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let para: string[] | null = null;
  let ul: string[] | null = null;
  let ol: { n: string; text: string }[] | null = null;
  const flush = () => {
    if (para) blocks.push({ kind: 'p', lines: para });
    if (ul) blocks.push({ kind: 'ul', items: ul });
    if (ol) blocks.push({ kind: 'ol', items: ol });
    para = null; ul = null; ol = null;
  };
  for (const raw of (text || '').replace(/\r\n?/g, '\n').split('\n')) {
    // Code fences: the markers go, the lines inside stay as text.
    if (fenceRe.test(raw)) continue;
    const line = raw.replace(quoteRe, '');
    if (!line.trim()) { flush(); continue; }
    if (ruleRe.test(line)) { flush(); blocks.push({ kind: 'hr' }); continue; }
    const h = headingRe.exec(line);
    if (h) { flush(); if (h[1]) blocks.push({ kind: 'h', text: h[1] }); continue; }
    const b = bulletRe.exec(line);
    if (b) {
      if (!ul) { flush(); ul = []; }
      ul.push(b[1]);
      continue;
    }
    const n = numberedRe.exec(line);
    if (n) {
      if (!ol) { flush(); ol = []; }
      ol.push({ n: n[1], text: n[2] });
      continue;
    }
    // An indented line under a list item continues that item.
    if ((ul || ol) && /^\s{2,}\S/.test(raw)) {
      if (ul) ul[ul.length - 1] += ` ${line.trim()}`;
      else if (ol) ol[ol.length - 1].text += ` ${line.trim()}`;
      continue;
    }
    if (!para) { flush(); para = []; }
    para.push(line);
  }
  flush();
  return blocks;
}

// Earliest first; at one position the alternatives are tried in this order,
// so ** is read as bold before * could be read as italic.
const inlineRe = /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__|`([^`]+)`|\[([^\]]+)\]\(([^)\s]*)\)|\*(?=[^\s*])([\s\S]*?[^\s*])\*|(^|[^A-Za-z0-9_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![A-Za-z0-9_])/;

/** Bold, italic, code and link text inside one line. */
export function renderInline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest) {
    const m = inlineRe.exec(rest);
    if (!m) { out.push(rest); break; }
    let start = m.index;
    // The underscore form captures the character before it; that stays text.
    if (m[8] !== undefined && m[7]) start += m[7].length;
    if (start > 0) out.push(rest.slice(0, start));
    const key = `${keyBase}-${k++}`;
    if (m[1] !== undefined || m[2] !== undefined) {
      out.push(<strong key={key} className="font-bold text-white">{renderInline(m[1] ?? m[2], key)}</strong>);
    } else if (m[3] !== undefined) {
      out.push(<code key={key} className="rounded bg-black/40 px-1 font-mono text-[0.92em]">{m[3]}</code>);
    } else if (m[4] !== undefined) {
      out.push(<Fragment key={key}>{renderInline(m[4], key)}</Fragment>);
    } else if (m[6] !== undefined || m[8] !== undefined) {
      out.push(<em key={key} className="italic">{renderInline(m[6] ?? m[8], key)}</em>);
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}
