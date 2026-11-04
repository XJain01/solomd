import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyBoardFromStorage,
  projectToMarkdown,
  safeBoardFileName,
} from './kanban-migrate.ts';
import { parseBoardMarkdown } from './kanban-markdown.ts';

const LEGACY = JSON.stringify({
  activeProjectId: 'prj_a',
  projects: [
    {
      id: 'prj_a',
      name: 'Work',
      columns: [{ id: 'col_a', title: 'Todo' }],
      tasks: [
        { id: 't1', columnId: 'col_a', title: 'Ship it', notes: 'line one\nline two' },
        { id: 't2', columnId: 'col_a', title: 'Done thing', notes: '' },
      ],
    },
    {
      id: 'prj_b',
      name: 'Home',
      columns: [{ id: 'col_b', title: 'Later' }],
      tasks: [],
    },
  ],
});

test('reads the legacy localStorage blob and rejects junk', () => {
  const board = legacyBoardFromStorage(LEGACY);
  assert.equal(board?.projects.length, 2);
  assert.equal(board?.projects[0].name, 'Work');
  assert.equal(legacyBoardFromStorage('{not json'), null);
  assert.equal(legacyBoardFromStorage(null), null);
  assert.equal(legacyBoardFromStorage(JSON.stringify({ projects: [] })), null);
});

test('converts a project to a board file with columns, cards, and notes', () => {
  const board = legacyBoardFromStorage(LEGACY)!;
  const md = projectToMarkdown(board.projects[0]);
  const parsed = parseBoardMarkdown(md);
  assert.equal(parsed.lanes.length, 1);
  assert.equal(parsed.lanes[0].title, 'Todo');
  assert.deepEqual(
    parsed.lanes[0].cards.map((card) => card.title),
    ['Ship it', 'Done thing'],
  );
  assert.deepEqual(parsed.lanes[0].cards[0].body, ['line one', 'line two']);
});

test('file names are filesystem-safe and never collide', () => {
  const taken = new Set<string>();
  assert.equal(safeBoardFileName('Work', taken), 'Work.md');
  assert.equal(safeBoardFileName('Work', taken), 'Work-2.md');
  assert.equal(safeBoardFileName('a/b:c*d?', taken), 'a-b-c-d-.md');
  assert.equal(safeBoardFileName('   ', taken), 'board.md');
  // Case-insensitive collision (Windows/macOS).
  assert.equal(safeBoardFileName('work', taken), 'work-3.md');
});
