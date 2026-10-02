import { Fragment, memo } from 'react';
import { parseChatMarkdown, renderInline } from '@/lib/chatMarkdown';

/**
 * The little Markdown the AI answers in, drawn as plain React elements:
 * **bold** / __bold__, *italic* / _italic_, `code`, "- " and "1. " lists,
 * "# " headings (a bold line), "---" rules and line breaks. A link
 * [text](url) shows only its text: the TV cannot follow it.
 *
 * Nothing here builds HTML from the text. Every piece of the reply becomes a
 * React text node, which React escapes, so "<script>" in a reply is shown as
 * those characters and never runs.
 */

interface ChatMarkdownProps {
  text: string;
  className?: string;
}

const ChatMarkdown = memo(({ text, className = '' }: ChatMarkdownProps) => {
  const blocks = parseChatMarkdown(text);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const gap = i === 0 ? '' : 'mt-2';
        if (b.kind === 'h') return <p key={i} className={`${gap} font-bold text-white`}>{renderInline(b.text, `h${i}`)}</p>;
        if (b.kind === 'hr') return <div key={i} className={`${gap} border-t border-white/15`} />;
        if (b.kind === 'ul') {
          return (
            <ul key={i} className={gap}>
              {b.items.map((item, j) => (
                <li key={j} className="flex mt-1 first:mt-0">
                  <span aria-hidden="true" className="mr-2 shrink-0 text-brand-ice">•</span>
                  <span className="min-w-0">{renderInline(item, `u${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (b.kind === 'ol') {
          return (
            <ol key={i} className={gap}>
              {b.items.map((item, j) => (
                <li key={j} className="flex mt-1 first:mt-0">
                  <span className="mr-2 shrink-0 min-w-[1.25rem] text-brand-ice font-semibold">{item.n}.</span>
                  <span className="min-w-0">{renderInline(item.text, `o${i}-${j}`)}</span>
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i} className={gap}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line, `p${i}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
});
ChatMarkdown.displayName = 'ChatMarkdown';

export default ChatMarkdown;
