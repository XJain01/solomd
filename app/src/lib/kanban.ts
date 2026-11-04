/**
 * Task kanban. Projects, columns, and tasks live in local storage.
 * Nothing here reads or writes vault notes.
 */

export interface KanbanColumn {
  id: string;
  title: string;
}

export type KanbanPriority = 'P0' | 'P1' | 'P2';

export interface KanbanChecklistItem {
  text: string;
  done: boolean;
}

export interface KanbanTask {
  id: string;
  columnId: string;
  title: string;
  notes: string;
  /** Markdown `[x]`. Older localStorage boards have no such field. */
  checked?: boolean;
  /** P0/P1/P2, stored as Obsidian Tasks priority emoji. */
  priority?: KanbanPriority;
  /** ISO date (`YYYY-MM-DD`), stored as `📅`. */
  due?: string;
  /** Acceptance checklist, stored as indented `- [ ]` body lines. */
  checklist?: KanbanChecklistItem[];
}

export interface KanbanProject {
  id: string;
  name: string;
  columns: KanbanColumn[];
  tasks: KanbanTask[];
}

export interface KanbanBoard {
  projects: KanbanProject[];
  activeProjectId: string | null;
}

export function emptyBoard(): KanbanBoard {
  return { projects: [], activeProjectId: null };
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Drop anything that isn't a project/column/task shape. */
export function normalizeBoard(raw: unknown): KanbanBoard {
  if (!raw || typeof raw !== 'object') return emptyBoard();
  const src = raw as Partial<KanbanBoard>;
  const projects: KanbanProject[] = [];
  if (Array.isArray(src.projects)) {
    for (const item of src.projects) {
      if (!item || typeof item !== 'object') continue;
      const p = item as Partial<KanbanProject>;
      const id = text(p.id);
      const name = text(p.name).trim();
      if (!id || !name) continue;
      const columns: KanbanColumn[] = [];
      if (Array.isArray(p.columns)) {
        for (const col of p.columns) {
          if (!col || typeof col !== 'object') continue;
          const c = col as Partial<KanbanColumn>;
          const cid = text(c.id);
          const title = text(c.title).trim();
          if (cid && title) columns.push({ id: cid, title });
        }
      }
      const known = new Set(columns.map((c) => c.id));
      const tasks: KanbanTask[] = [];
      if (Array.isArray(p.tasks)) {
        for (const task of p.tasks) {
          if (!task || typeof task !== 'object') continue;
          const t = task as Partial<KanbanTask>;
          const tid = text(t.id);
          const columnId = text(t.columnId);
          if (!tid || !known.has(columnId)) continue;
          tasks.push({
            id: tid,
            columnId,
            title: text(t.title),
            notes: text(t.notes),
          });
        }
      }
      projects.push({ id, name, columns, tasks });
    }
  }
  const active = text(src.activeProjectId);
  const activeProjectId = projects.some((p) => p.id === active)
    ? active
    : (projects[0]?.id ?? null);
  return { projects, activeProjectId };
}

function withProject(
  board: KanbanBoard,
  projectId: string,
  update: (project: KanbanProject) => KanbanProject,
): KanbanBoard {
  return {
    ...board,
    projects: board.projects.map((p) => (p.id === projectId ? update(p) : p)),
  };
}

export function createProject(
  board: KanbanBoard,
  name: string,
  columnTitles: string[],
): KanbanBoard {
  const trimmed = name.trim();
  if (!trimmed) return board;
  const columns = columnTitles
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title) => ({ id: newId('col'), title }));
  const project: KanbanProject = {
    id: newId('prj'),
    name: trimmed,
    columns,
    tasks: [],
  };
  return {
    projects: [...board.projects, project],
    activeProjectId: project.id,
  };
}

export function renameProject(board: KanbanBoard, projectId: string, name: string): KanbanBoard {
  const trimmed = name.trim();
  if (!trimmed) return board;
  return withProject(board, projectId, (p) => ({ ...p, name: trimmed }));
}

export function deleteProject(board: KanbanBoard, projectId: string): KanbanBoard {
  const projects = board.projects.filter((p) => p.id !== projectId);
  const activeProjectId = board.activeProjectId === projectId
    ? (projects[0]?.id ?? null)
    : board.activeProjectId;
  return { projects, activeProjectId };
}

export function addColumn(board: KanbanBoard, projectId: string, title: string): KanbanBoard {
  const trimmed = title.trim();
  if (!trimmed) return board;
  return withProject(board, projectId, (p) => ({
    ...p,
    columns: [...p.columns, { id: newId('col'), title: trimmed }],
  }));
}

export function renameColumn(
  board: KanbanBoard,
  projectId: string,
  columnId: string,
  title: string,
): KanbanBoard {
  const trimmed = title.trim();
  if (!trimmed) return board;
  return withProject(board, projectId, (p) => ({
    ...p,
    columns: p.columns.map((c) => (c.id === columnId ? { ...c, title: trimmed } : c)),
  }));
}

export function deleteColumn(board: KanbanBoard, projectId: string, columnId: string): KanbanBoard {
  return withProject(board, projectId, (p) => ({
    ...p,
    columns: p.columns.filter((c) => c.id !== columnId),
    tasks: p.tasks.filter((t) => t.columnId !== columnId),
  }));
}

export function addTask(
  board: KanbanBoard,
  projectId: string,
  columnId: string,
  title: string,
  notes = '',
): KanbanBoard {
  const trimmed = title.trim();
  if (!trimmed) return board;
  return withProject(board, projectId, (p) => {
    if (!p.columns.some((c) => c.id === columnId)) return p;
    return {
      ...p,
      tasks: [...p.tasks, { id: newId('task'), columnId, title: trimmed, notes }],
    };
  });
}

export function updateTask(
  board: KanbanBoard,
  projectId: string,
  taskId: string,
  patch: {
    title?: string;
    notes?: string;
    columnId?: string;
    checked?: boolean;
    priority?: KanbanPriority | null;
    due?: string | null;
    checklist?: KanbanChecklistItem[];
  },
): KanbanBoard {
  return withProject(board, projectId, (p) => ({
    ...p,
    tasks: p.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const title = patch.title !== undefined ? patch.title.trim() : task.title;
      if (!title) return task;
      const columnId = patch.columnId && p.columns.some((c) => c.id === patch.columnId)
        ? patch.columnId
        : task.columnId;
      return {
        ...task,
        title,
        notes: patch.notes !== undefined ? patch.notes : task.notes,
        columnId,
        ...(patch.checked !== undefined ? { checked: patch.checked } : {}),
        ...(patch.priority !== undefined
          ? { priority: patch.priority === null ? undefined : patch.priority }
          : {}),
        ...(patch.due !== undefined ? { due: patch.due === null ? undefined : patch.due } : {}),
        ...(patch.checklist !== undefined ? { checklist: patch.checklist } : {}),
      };
    }),
  }));
}

export function deleteTask(board: KanbanBoard, projectId: string, taskId: string): KanbanBoard {
  return withProject(board, projectId, (p) => ({
    ...p,
    tasks: p.tasks.filter((t) => t.id !== taskId),
  }));
}

export function moveTask(
  board: KanbanBoard,
  projectId: string,
  taskId: string,
  columnId: string,
): KanbanBoard {
  return updateTask(board, projectId, taskId, { columnId });
}
