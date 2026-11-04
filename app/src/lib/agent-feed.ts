import type { AgentMessage } from '../stores/agentPanel';

export type AgentFeedItem =
  | { kind: 'message'; key: string; message: AgentMessage; index: number }
  | { kind: 'tools'; key: string; tools: AgentMessage[] };

/**
 * Collapse the raw message list into what the panel renders.
 *
 * Two things used to fill the whole panel during a tool-heavy run:
 *
 * 1. Every tool call rendered its own row. A 15-call run pushed the actual
 *    conversation off screen. Consecutive tool messages now fold into one
 *    group row (`Tools × 15`), expanded on demand.
 * 2. `insertToolCall` adds an empty assistant placeholder after every tool
 *    call for post-tool text. Most stay empty, so the panel showed a blank
 *    bubble between every pair of tool cards. Drop them, except the last one
 *    while a reply is still streaming into it.
 */
export function buildAgentFeed(messages: AgentMessage[], streaming: boolean): AgentFeedItem[] {
  const items: AgentFeedItem[] = [];
  const lastIndex = messages.length - 1;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const emptyScaffold =
      message.role === 'assistant' && !message.content.trim() && !(streaming && i === lastIndex);
    if (emptyScaffold) continue;

    if (message.role === 'tool' && message.tool) {
      const tools: AgentMessage[] = [];
      let j = i;
      while (j < messages.length) {
        const next = messages[j];
        if (next.role === 'tool' && next.tool) {
          tools.push(next);
          j++;
          continue;
        }
        // Empty assistant placeholders sit between tool calls in the raw
        // list; skip them so the calls still group together.
        if (next.role === 'assistant' && !next.content.trim()) {
          j++;
          continue;
        }
        break;
      }
      items.push({ kind: 'tools', key: `tools:${tools[0]!.id}`, tools });
      i = j - 1;
      continue;
    }

    items.push({ kind: 'message', key: message.id, message, index: i });
  }

  return items;
}
