import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UNSORTED_COLUMN,
  columnForNote,
  kanbanColumns,
  moveNoteStatus,
  noteStatus,
} from './kanban.ts';

test('notes without status land in the unsorted column', () => {
  const notes = [
    { path: 'a.md', frontmatter: null },
    { path: 'b.md', frontmatter: { title: 'B' } },
    { path: 'c.md', frontmatter: { status: 'doing' } },
  ];
  const cols = kanbanColumns(notes);
  assert.equal(columnForNote(notes[0], cols), UNSORTED_COLUMN);
  assert.equal(columnForNote(notes[1], cols), UNSORTED_COLUMN);
  assert.equal(columnForNote(notes[2], cols), 'doing');
  assert.deepEqual(cols.map((c) => c.id), [UNSORTED_COLUMN, 'todo', 'doing', 'done']);
});

test('unknown statuses become their own columns', () => {
  const notes = [{ path: 'a.md', frontmatter: { state: 'Review' } }];
  const cols = kanbanColumns(notes);
  assert.ok(cols.some((c) => c.id === 'review' && c.writeValue === 'Review'));
  assert.equal(noteStatus(notes[0].frontmatter), 'Review');
  assert.equal(columnForNote(notes[0], cols), 'review');
});

test('moving a card writes status and keeps the body', () => {
  const src = '---\ntitle: Hello\n---\n\nBody stays.\n';
  const next = moveNoteStatus(src, {
    id: 'todo',
    writeValue: 'todo',
    builtin: true,
  });
  assert.match(next, /status: todo/);
  assert.match(next, /title: Hello/);
  assert.match(next, /Body stays\./);
});

test('moving to unsorted removes the existing status key', () => {
  const src = '---\nstate: doing\n---\n\nKeep me\n';
  const next = moveNoteStatus(src, {
    id: UNSORTED_COLUMN,
    writeValue: null,
    builtin: true,
  });
  assert.doesNotMatch(next, /state:/);
  assert.match(next, /Keep me/);
});
