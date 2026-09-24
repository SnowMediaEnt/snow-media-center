import { describe, expect, it } from 'vitest';
import { sanitizeMailHtml } from './mailHtml';
import { sanitizeMailHtml as sanitizeOnServer } from '../../supabase/functions/_shared/mailHtml';

const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'A', 'IMG', 'BLOCKQUOTE', 'SPAN', 'DIV']);

/** What the reader does with it: innerHTML into a div. */
const render = (html: string): HTMLDivElement => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

/** Nothing in the rendered tree can run script or reach out, except an https image. */
const expectInert = (html: string) => {
  const root = render(html);
  for (const el of Array.from(root.querySelectorAll('*'))) {
    expect(ALLOWED.has(el.tagName)).toBe(true);
    for (const a of Array.from(el.attributes)) {
      expect(el.tagName === 'IMG' && (a.name === 'src' || a.name === 'alt')).toBe(true);
      if (a.name === 'src') expect(a.value).toMatch(/^https:\/\//);
    }
  }
};

// Every one of these ran script through the old regex sanitizer, or is a
// well-known way past a naive one.
const ATTACKS = [
  '<p>hi<img src=x onerror=alert(1) ',
  '<div>a<img src=x onerror=alert(1)//',
  '<p>hi<svg onload=alert(1) ',
  '<p>hi<img src=https://cdn.example/a.png onerror=alert(1) ',
  '<img src="https://cdn.example/a.png" onerror="alert(1)">',
  '<IMG SRC=x ONERROR=alert(1)>',
  '<img src="javascript:alert(1)">',
  '<img alt=">" src=x onerror=alert(1)>',
  '<<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">tap</a>',
  '<p onclick="alert(1)" style="background:url(javascript:alert(1))">t</p>',
  '<script>alert(1)</script>',
  '<p>x<script>alert(1)',
  '<scr<script>ipt>alert(1)</script>',
  '<!--<img src=x onerror=alert(1)>-->',
  '<!--><img src=x onerror=alert(1)>-->',
  '<![CDATA[<img src=x onerror=alert(1)>]]>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<svg><style><img src=x onerror=alert(1)></style></svg>',
  '<form><button formaction=javascript:alert(1)>go</button></form>',
  '<object data="javascript:alert(1)"></object>',
  '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
  '<div\nonmouseover=alert(1)>x</div>',
  '<img/src=x/onerror=alert(1)>',
  '<a/href=javascript:alert(1)>x</a>',
];

describe('sanitizeMailHtml', () => {
  it('leaves nothing that can run script, whatever the input', () => {
    for (const html of ATTACKS) {
      const out = sanitizeMailHtml(html);
      expectInert(out);
      expect(out.toLowerCase()).not.toMatch(/<(?!\/?(p|br|strong|b|em|i|u|ul|ol|li|h[1-4]|a|img|blockquote|span|div)\b)/);
    }
  });

  it('drops an unfinished tag instead of letting the closers finish it', () => {
    expect(sanitizeMailHtml('<p>hi<img src=x onerror=alert(1) ')).toBe('<p>hi</p>');
    expect(render(sanitizeMailHtml('<div>a<img src=x onerror=alert(1)//')).querySelector('img')).toBeNull();
  });

  it('keeps the message: text, structure and https images', () => {
    expect(sanitizeMailHtml('<p class="x">Hello <strong>there</strong>,<br>see <a href="https://snowmediaent.com">this</a></p>'))
      .toBe('<p>Hello <strong>there</strong>,<br />see <a>this</a></p>');
    expect(sanitizeMailHtml('<img src="https://cdn.example/a.png?w=1&amp;h=2" width="10">'))
      .toBe('<img src="https://cdn.example/a.png?w=1&amp;h=2" alt="" />');
    expect(sanitizeMailHtml('<UL><LI>one<LI>two</UL>')).toBe('<ul><li>one<li>two</li></li></ul>');
    expect(sanitizeMailHtml('<b><i>x</b></i>')).toBe('<b><i>x</i></b>');
  });

  it('shows a stray < or > as the character', () => {
    const out = sanitizeMailHtml('x <b>bold</b> 3 < 4 and 5 > 2');
    expect(out).toBe('x <b>bold</b> 3 &lt; 4 and 5 &gt; 2');
    expect(render(out).textContent).toBe('x bold 3 < 4 and 5 > 2');
  });

  it('drops scripts, styles, comments and a doctype with what is inside them', () => {
    expect(sanitizeMailHtml('<!DOCTYPE html><html><head><title>T</title><style>p{}</style></head><body><!-- c --><p>Hi</p><script>x()</script></body></html>'))
      .toBe('<p>Hi</p>');
  });

  it('closes what it opened and ignores closers it did not', () => {
    expect(sanitizeMailHtml('</div><p><em>a')).toBe('<p><em>a</em></p>');
  });

  it('gives the same answer twice, so the app re-cleaning stored mail changes nothing', () => {
    for (const html of [...ATTACKS, '<p>a <b>b</b> 3 < 4 <img src="https://x.example/i.png"></p>', '<b><i>x</b></i>']) {
      const once = sanitizeMailHtml(html);
      expect(sanitizeMailHtml(once)).toBe(once);
    }
  });

  it('is the same code the mail-publish function runs', () => {
    for (const html of [...ATTACKS, '<p>a <b>b</b> 3 < 4</p>', '<UL><LI>one</UL>']) {
      expect(sanitizeOnServer(html)).toBe(sanitizeMailHtml(html));
    }
  });

  it('stays fast on hostile input', () => {
    const t = Date.now();
    sanitizeMailHtml('<a'.repeat(20000));
    sanitizeMailHtml('<script>'.repeat(5000));
    sanitizeMailHtml('<p>'.repeat(20000));
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
