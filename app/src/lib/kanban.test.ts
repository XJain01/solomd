import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addColumn,
  addTask,
  createProject,
  deleteColumn,
  deleteProject,
  emptyBoard,
  moveTask,
  normalizeBoard,
  updateTask,
} from './kanban.ts';

test('a new project is active and starts with the columns the user asked for', () => {
  const board = createProject(emptyBoard(), '  写作  ', ['待办', '完成']);
  assert.equal(board.projects.length, 1);
  assert.equal(board.projects[0].name, '写作');
  assert.equal(board.activeProjectId, board.projects[0].id);
  assert.deepEqual(board.projects[0].columns.map((c) => c.title), ['待办', '完成']);
  assert.deepEqual(board.projects[0].tasks, []);
});

test('tasks stay inside their column and can move', () => {
  let board = createProject(emptyBoard(), 'Launch', ['Todo', 'Done']);
  const project = board.projects[0];
  const [todo, done] = project.columns;
  board = addTask(board, project.id, todo.id, 'Write notes', 'optional');
  const task = board.projects[0].tasks[0];
  assert.equal(task.columnId, todo.id);
  assert.equal(task.notes, 'optional');
  board = moveTask(board, project.id, task.id, done.id);
  assert.equal(board.projects[0].tasks[0].columnId, done.id);
  board = updateTask(board, project.id, task.id, { title: 'Ship', notes: 'now' });
  assert.equal(board.projects[0].tasks[0].title, 'Ship');
  assert.equal(board.projects[0].tasks[0].notes, 'now');
});

test('deleting a column removes its tasks and deleting a project selects another', () => {
  let board = createProject(emptyBoard(), 'A', ['Only']);
  board = createProject(board, 'B', ['Keep']);
  const a = board.projects[0];
  const b = board.projects[1];
  board = addTask(board, a.id, a.columns[0].id, 'gone');
  board = addColumn(board, a.id, 'Later');
  assert.equal(board.projects[0].columns.length, 2);
  board = deleteColumn(board, a.id, a.columns[0].id);
  assert.equal(board.projects[0].tasks.length, 0);
  assert.equal(board.projects[0].columns.length, 1);
  board = deleteProject(board, b.id);
  assert.equal(board.projects.length, 1);
  assert.equal(board.activeProjectId, a.id);
});

test('stored boards drop notes-as-cards and unknown shapes', () => {
  const board = normalizeBoard({
    activeProjectId: 'missing',
    projects: [
      {
        id: 'p1',
        name: 'Real',
        columns: [{ id: 'c1', title: 'Todo' }, { id: '', title: 'Nope' }],
        tasks: [
          { id: 't1', columnId: 'c1', title: 'Stay', notes: '' },
          { id: 't2', columnId: 'nope', title: 'Drop', notes: '' },
        ],
      },
      { id: '', name: 'Nameless' },
    ],
  });
  assert.equal(board.projects.length, 1);
  assert.equal(board.activeProjectId, 'p1');
  assert.equal(board.projects[0].tasks.length, 1);
  assert.equal(board.projects[0].tasks[0].title, 'Stay');
});
