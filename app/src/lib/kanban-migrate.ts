/**
 * One-time bridge from the old localStorage board to Markdown files.
 *
 * The old shape is `{ projects: [{ id, name, columns, tasks }], activeProjectId }`.
 * Each project becomes one board file; the original blob is never deleted.
 */
import { normalizeBoard, type KanbanBoard } from './kanban';
import { serializeBoardMarkdown, type MarkdownBoard } from './kanban-markdown';

export function legacyBoardFromStorage(raw: string | null): KanbanBoard | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const board = normalizeBoard(parsed);
    return board.projects.length > 0 ? board : null;
  } catch {
    return null;
  }
}

/** Convert one project into an Obsidian-Kanban board file. */
export function projectToMarkdown(project: KanbanBoard['projects'][number]): string {
  const board: MarkdownBoard = {
    frontmatterRaw: ['---', 'kanban-plugin: board', '---'].join('\n'),
    preamble: [],
    lanes: project.columns.map((column) => ({
      title: column.title,
      intro: [],
      cards: project.tasks
        .filter((task) => task.columnId === column.id)
        .map((task) => {
          const body = task.notes ? task.notes.split(/\r?\n/) : [];
          for (const item of task.checklist ?? []) {
            body.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
          }
          return {
            title: task.title,
            body,
            checked: !!task.checked,
            priority: task.priority,
            due: task.due,
          };
        }),
    })),
    archiveRaw: '',
    footerRaw: '',
    eol: '\n',
    bom: false,
  };
  return serializeBoardMarkdown(board);
}

const INVALID = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Filesystem-safe, collision-free `<name>.md`. `taken` is mutated. */
export function safeBoardFileName(name: string, taken: Set<string>): string {
  let base = name
    .trim()
    .replace(INVALID, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  if (!base) base = 'board';
  let candidate = `${base}.md`;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${n}.md`;
    n++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
