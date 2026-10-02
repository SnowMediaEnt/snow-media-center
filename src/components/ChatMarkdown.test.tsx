import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import ChatMarkdown from './ChatMarkdown';
import { parseChatMarkdown } from '@/lib/chatMarkdown';

// The reply from the owner's photo: literal asterisks on screen before.
const REPLY = `Tonight's **main PPV** is **AEW All Out 2026**.

- **WWE Worlds Collide 2026** — 7 PM ET
- *Pre-show* at 7:30

### How to watch
1. Open **Live TV**
2. Pick the [PPV channel](https://example.com/ppv)`;

describe('ChatMarkdown', () => {
  it('draws bold, italics, lists and headings with no markers left', () => {
    const { container } = render(<ChatMarkdown text={REPLY} />);
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('###');
    const bold = Array.from(container.querySelectorAll('strong')).map((b) => b.textContent);
    expect(bold).toEqual(expect.arrayContaining(['main PPV', 'AEW All Out 2026', 'WWE Worlds Collide 2026', 'Live TV']));
    expect(container.querySelector('p.font-bold')?.textContent).toBe('How to watch');
    expect(container.querySelector('em')?.textContent).toBe('Pre-show');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    const ol = container.querySelectorAll('ol li');
    expect(ol).toHaveLength(2);
    expect(ol[0].textContent).toBe('1.Open Live TV');
  });

  it('shows a link as its text only', () => {
    const { container } = render(<ChatMarkdown text="See [the guide](https://example.com/x) now" />);
    expect(container.textContent).toBe('See the guide now');
    expect(container.querySelector('a')).toBeNull();
  });

  it('never turns reply text into HTML', () => {
    const evil = '<img src=x onerror="alert(1)"> **<script>alert(2)</script>** <b>hi</b>';
    const { container } = render(<ChatMarkdown text={evil} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector('strong')?.textContent).toBe('<script>alert(2)</script>');
  });

  it('keeps line breaks and leaves lone asterisks and snake_case alone', () => {
    const { container } = render(<ChatMarkdown text={'2 * 3 * 4\nmy_file_name and 5 ** 2'} />);
    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(container.textContent).toBe('2 * 3 * 4my_file_name and 5 ** 2');
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
  });

  it('splits paragraphs on blank lines', () => {
    expect(parseChatMarkdown('a\nb\n\nc').map((b) => b.kind)).toEqual(['p', 'p']);
    expect(parseChatMarkdown('---')).toEqual([{ kind: 'hr' }]);
  });
});
