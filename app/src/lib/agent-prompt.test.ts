import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeAgentSystemPrompt } from './agent-prompt.ts';

test('global prompt, persona, and context compose in order', () => {
  const text = composeAgentSystemPrompt({
    globalPrompt: '  Always answer in Chinese.  ',
    persona: { name: 'Editor', prompt: ' Cut 20% of the words. ' },
    vaultContext: 'Workspace: D:\\notes',
    noteContext: 'Active note: draft.md',
  });
  assert.equal(
    text,
    [
      'Always answer in Chinese.',
      '## Persona: Editor\nCut 20% of the words.',
      'Workspace: D:\\notes',
      'Active note: draft.md',
    ].join('\n\n'),
  );
});

test('empty slots do not leave blank separators', () => {
  assert.equal(composeAgentSystemPrompt({}), '');
  assert.equal(
    composeAgentSystemPrompt({ globalPrompt: '   ', persona: { name: 'X', prompt: '  ' } }),
    '',
  );
  assert.equal(composeAgentSystemPrompt({ persona: { name: '', prompt: 'Only text' } }), 'Only text');
});
