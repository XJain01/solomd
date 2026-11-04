import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentFeed } from './agent-feed.ts';
import type { AgentMessage } from '../stores/agentPanel.ts';

let seq = 0;
function message(role: AgentMessage['role'], content: string): AgentMessage {
  seq += 1;
  return { id: `m${seq}`, role, content, createdAt: seq };
}

function tool(name: string): AgentMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    role: 'tool',
    content: '',
    createdAt: seq,
    tool: { name, args: {}, toolCallId: `t${seq}` },
  };
}

test('consecutive tool calls fold into one group and empty assistant bubbles disappear', () => {
  const feed = buildAgentFeed(
    [
      message('user', '整理这篇笔记'),
      message('assistant', ''),
      tool('read_note'),
      message('assistant', ''),
      tool('write_note'),
      message('assistant', ''),
      tool('read_note'),
      message('assistant', '已完成'),
    ],
    false,
  );

  assert.equal(feed.length, 3);
  assert.equal(feed[0].kind, 'message');
  assert.equal(feed[1].kind, 'tools');
  assert.deepEqual(
    feed[1].kind === 'tools' ? feed[1].tools.map((m) => m.tool?.name) : [],
    ['read_note', 'write_note', 'read_note'],
  );
  assert.equal(feed[2].kind === 'message' ? feed[2].message.content : '', '已完成');
});

test('an empty assistant placeholder stays while a reply is still streaming', () => {
  const feed = buildAgentFeed([message('user', 'hi'), message('assistant', '')], true);
  assert.equal(feed.length, 2);
  assert.equal(feed[1].kind === 'message' ? feed[1].message.role : '', 'assistant');
});

test('tool groups do not swallow a real assistant reply between them', () => {
  const feed = buildAgentFeed(
    [tool('search'), message('assistant', '找到了'), tool('read_note')],
    false,
  );
  assert.deepEqual(
    feed.map((item) => (item.kind === 'tools' ? `tools:${item.tools.length}` : item.message.content)),
    ['tools:1', '找到了', 'tools:1'],
  );
});
