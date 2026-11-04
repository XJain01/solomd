import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoardMarkdown,
  parseBoardMarkdown,
  serializeBoardMarkdown,
} from './kanban-markdown.ts';

const BOARD = `---
kanban-plugin: board
---

## Todo

- [ ] First card
- [x] Done card
    body line one
    body line two

## Doing

## Done

**Complete**
- [x] Finished
`;

test('parses lanes, cards, checkbox state, and card body', () => {
  const parsed = parseBoardMarkdown(BOARD);
  assert.equal(parsed.lanes.length, 3);
  assert.deepEqual(parsed.lanes.map((l) => l.title), ['Todo', 'Doing', 'Done']);
  assert.equal(parsed.lanes[0].cards.length, 2);
  assert.equal(parsed.lanes[0].cards[0].title, 'First card');
  assert.equal(parsed.lanes[0].cards[0].checked, false);
  assert.equal(parsed.lanes[0].cards[1].checked, true);
  assert.deepEqual(parsed.lanes[0].cards[1].body, ['body line one', 'body line two']);
  assert.deepEqual(parsed.lanes[2].intro, ['**Complete**']);
  assert.equal(parsed.frontmatterRaw, '---\nkanban-plugin: board\n---');
});

test('round-trips structure and is idempotent', () => {
  const first = parseBoardMarkdown(BOARD);
  const once = serializeBoardMarkdown(first);
  const second = parseBoardMarkdown(once);
  const twice = serializeBoardMarkdown(second);
  assert.deepEqual(second.lanes, first.lanes);
  assert.equal(twice, once);
});

test('preserves BOM and CRLF', () => {
  const crlf = `\uFEFF---\r\nkanban-plugin: board\r\n---\r\n\r\n## Todo\r\n\r\n- [ ] A\r\n`;
  const parsed = parseBoardMarkdown(crlf);
  assert.equal(parsed.bom, true);
  assert.equal(parsed.eol, '\r\n');
  const out = serializeBoardMarkdown(parsed);
  assert.ok(out.startsWith('\uFEFF'));
  assert.ok(out.includes('\r\n'));
  assert.equal(parseBoardMarkdown(out).lanes[0].cards[0].title, 'A');
});

test('keeps unknown frontmatter, preamble, lane intro, archive, and settings footer', () => {
  const text = `---
kanban-plugin: board
custom: keep-me
---

# Board title

Some preamble.

## Todo

lane intro line

- [ ] A

***

## Archive

- [x] archived card

%% kanban:settings
{"kanban-plugin":"board","lane-width":300}
%%
`;
  const parsed = parseBoardMarkdown(text);
  assert.match(parsed.frontmatterRaw, /custom: keep-me/);
  assert.deepEqual(parsed.preamble, ['# Board title', '', 'Some preamble.']);
  assert.deepEqual(parsed.lanes[0].intro, ['lane intro line']);
  assert.match(parsed.archiveRaw, /archived card/);
  assert.match(parsed.footerRaw, /lane-width/);

  const out = serializeBoardMarkdown(parsed);
  assert.match(out, /custom: keep-me/);
  assert.match(out, /# Board title/);
  assert.match(out, /lane intro line/);
  assert.match(out, /## Archive/);
  assert.match(out, /lane-width/);
});

test('ignores lane and card syntax inside fenced code blocks', () => {
  const text = `## Todo

- [ ] Card
    \`\`\`md
    ## Not a lane
    - [ ] Not a card
    \`\`\`
`;
  const parsed = parseBoardMarkdown(text);
  assert.equal(parsed.lanes.length, 1);
  assert.equal(parsed.lanes[0].cards.length, 1);
  assert.ok(parsed.lanes[0].cards[0].body.some((line) => line.includes('## Not a lane')));
});

test('duplicate card titles are kept as separate cards', () => {
  const parsed = parseBoardMarkdown(`## Todo\n\n- [ ] Same\n- [ ] Same\n`);
  assert.deepEqual(
    parsed.lanes[0].cards.map((c) => c.title),
    ['Same', 'Same'],
  );
});

test('createBoardMarkdown writes the frontmatter and empty lanes', () => {
  const out = createBoardMarkdown(['Todo', 'Doing', 'Done']);
  assert.ok(out.startsWith('---\nkanban-plugin: board\n---\n'));
  const parsed = parseBoardMarkdown(out);
  assert.deepEqual(parsed.lanes.map((l) => l.title), ['Todo', 'Doing', 'Done']);
  assert.equal(parsed.lanes[0].cards.length, 0);
});

test('a file without frontmatter or lanes parses as a plain preamble', () => {
  const parsed = parseBoardMarkdown('# Just a note\n\nsome text\n');
  assert.equal(parsed.frontmatterRaw, '');
  assert.equal(parsed.lanes.length, 0);
  assert.deepEqual(parsed.preamble, ['# Just a note', '', 'some text']);
});

test('parses and writes Tasks priority and due metadata', () => {
  const parsed = parseBoardMarkdown(
    '## Todo\n\n- [ ] Ship it 🔺 📅 2026-10-23\n- [ ] Later 🔼\n',
  );
  assert.equal(parsed.lanes[0].cards[0].title, 'Ship it');
  assert.equal(parsed.lanes[0].cards[0].priority, 'P0');
  assert.equal(parsed.lanes[0].cards[0].due, '2026-10-23');
  assert.equal(parsed.lanes[0].cards[1].priority, 'P2');

  const out = serializeBoardMarkdown(parsed);
  assert.match(out, /- \[ \] Ship it 🔺 📅 2026-10-23/);
  assert.deepEqual(parseBoardMarkdown(out).lanes, parsed.lanes);
});
