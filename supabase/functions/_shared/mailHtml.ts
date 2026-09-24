// Deno copy of src/lib/mailHtml.ts for the mail-publish function. Keep the two
// identical (src/lib/mailHtml.test.ts runs both over the same inputs).
//
// Campaign html is rebuilt here before it is stored, so a box on an older
// app, whose own sanitizer could be fooled by an unfinished tag, is only ever
// sent markup this code wrote: allow-listed tags with no attributes except an
// https image src, and every other `<` and `>` as text.

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'a', 'img', 'blockquote', 'span', 'div']);
/** Dropped with everything inside them: code, styling or embedded documents,
 *  never the message. One that is never closed drops the rest. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'title', 'textarea', 'iframe', 'noscript', 'noembed', 'noframes', 'xmp', 'template', 'object', 'svg', 'math', 'form']);
const TAG_START = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)/y;
const IMG_SRC = /(?:^|[\s/"'])src\s*=\s*["']?(https:\/\/[^"'\s<>]+)/i;

const text = (t: string): string => t.replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Keeps text and structure only. `<a>` loses its href (links are shown as
 *  QR codes elsewhere) and `<img>` keeps only an https src. */
export function sanitizeMailHtml(raw: string): string {
  const input = typeof raw === 'string' ? raw : '';
  const open: string[] = [];
  let out = '';
  let pos = 0;
  while (pos < input.length) {
    const lt = input.indexOf('<', pos);
    if (lt === -1) { out += text(input.slice(pos)); break; }
    out += text(input.slice(pos, lt));
    // A comment, a doctype, <?xml …>: skipped whole, as a browser does. One
    // that never ends takes the rest with it.
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      if (end === -1) break;
      pos = end + 3;
      continue;
    }
    if (input[lt + 1] === '!' || input[lt + 1] === '?') {
      const end = input.indexOf('>', lt);
      if (end === -1) break;
      pos = end + 1;
      continue;
    }
    TAG_START.lastIndex = lt;
    const m = TAG_START.exec(input);
    // A `<` that starts no tag ("3 < 4") is text.
    if (!m) { out += '&lt;'; pos = lt + 1; continue; }
    const gt = input.indexOf('>', lt);
    // A tag that never ends: a browser drops it, and nothing after it can
    // be a tag either.
    if (gt === -1) break;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = input.slice(lt + m[0].length, gt);
    pos = gt + 1;
    if (!closing && DROP_WITH_CONTENT.has(name)) {
      const close = new RegExp(`</${name}`, 'gi');
      close.lastIndex = pos;
      const end = close.exec(input);
      const endGt = end ? input.indexOf('>', end.index) : -1;
      if (endGt === -1) break;
      pos = endGt + 1;
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    if (name === 'br') { out += '<br />'; continue; }
    if (name === 'img') {
      const src = closing ? undefined : IMG_SRC.exec(attrs)?.[1];
      if (src) out += `<img src="${src}" alt="" />`;
      continue;
    }
    if (closing) {
      // Closes what was opened inside it too; a closer with nothing to
      // close is dropped.
      const idx = open.lastIndexOf(name);
      while (idx !== -1 && open.length > idx) out += `</${open.pop()}>`;
      continue;
    }
    open.push(name);
    out += `<${name}>`;
  }
  for (let i = open.length - 1; i >= 0; i -= 1) out += `</${open[i]}>`;
  return out;
}
