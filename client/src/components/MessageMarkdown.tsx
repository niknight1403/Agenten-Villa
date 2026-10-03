import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Chat-Antworten als echtes Markdown rendern (wie im Superagent-Chat):
 * Überschriften, Listen, Tabellen, Code-Blöcke und Zitate statt einer
 * einzigen unstrukturierten Textwand. Memoisiert, weil sich der Text
 * einer Nachricht nach dem Rendern nicht mehr ändert.
 */
const MessageMarkdown = memo(function MessageMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
});

export default MessageMarkdown;
