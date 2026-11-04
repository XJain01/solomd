/**
 * File-backed task board.
 *
 * Every project is one Obsidian-Kanban-compatible `.md` file under
 * `<workspace>/boards/`. The in-memory projects keep the shape the UI already
 * renders; mutations are written back to the owning file (debounced 250ms).
 * The old `solomd.kanban.v1` localStorage blob is migrated once and kept as a
 * backup.
 */
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import {
  addColumn,
  addTask,
  deleteColumn,
  deleteTask,
  moveTask,
  renameColumn,
  updateTask,
  type KanbanBoard,
  type KanbanChecklistItem,
  type KanbanPriority,
  type KanbanProject,
} from '../lib/kanban';
import {
  createBoardMarkdown,
  parseBoardMarkdown,
  serializeBoardMarkdown,
  type MarkdownBoard,
} from '../lib/kanban-markdown';
import {
  legacyBoardFromStorage,
  safeBoardFileName,
  projectToMarkdown,
} from '../lib/kanban-migrate';

const LS_KEY = 'solomd.kanban.v1';
const MIGRATED_KEY = 'solomd.kanban.migrated.v1';
const BOARDS_DIR = 'boards';

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FileReadResult {
  content: string;
  encoding: string;
}

interface StoredProject extends KanbanProject {
  filePath?: string;
  fileEncoding?: string;
  /** Parsed source kept so frontmatter/footer/archive survive a write. */
  markdown?: MarkdownBoard;
}

interface State {
  folder: string | null;
  projects: StoredProject[];
  activeProjectId: string | null;
  loading: boolean;
  lastError: string | null;
}

/** Debounce timers live outside Pinia state (timers are not serializable). */
const persistTimers = new Map<string, number>();

function joinPath(folder: string, ...parts: string[]): string {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  const base = folder.replace(/[\\/]+$/, '');
  return [base, ...parts].join(sep);
}

function boardFromProject(project: StoredProject): MarkdownBoard {
  const base = project.markdown;
  const lanes = project.columns.map((column, index) => {
    const old =
      base?.lanes.find((lane) => lane.title === column.title) ?? base?.lanes[index];
    return {
      title: column.title,
      intro: old?.intro ?? [],
      cards: project.tasks
        .filter((task) => task.columnId === column.id)
        .map((task) => {
          const body = task.notes ? task.notes.split(/\r?\n/) : [];
          for (const item of task.checklist ?? []) {
            body.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
          }
          while (body.length && !body[body.length - 1].trim()) body.pop();
          return {
            title: task.title,
            body,
            checked: !!task.checked,
            priority: task.priority,
            due: task.due,
          };
        }),
    };
  });
  return {
    frontmatterRaw: base?.frontmatterRaw || '---\nkanban-plugin: board\n---',
    preamble: base?.preamble ?? [],
    lanes,
    archiveRaw: base?.archiveRaw ?? '',
    footerRaw: base?.footerRaw ?? '',
    eol: base?.eol ?? '\n',
    bom: base?.bom ?? false,
  };
}

function projectFromBoard(
  name: string,
  filePath: string,
  encoding: string,
  markdown: MarkdownBoard,
): StoredProject {
  const columns = markdown.lanes.map((lane, index) => ({
    id: `col_${index}`,
    title: lane.title || `Column ${index + 1}`,
  }));
  const tasks = markdown.lanes.flatMap((lane, laneIndex) =>
    lane.cards.map((card, cardIndex) => {
      const checklist = [];
      const description = [];
      for (const line of card.body) {
        const item = /^-\s*\[([ xX])\]\s?(.*)$/.exec(line.trim());
        if (item) checklist.push({ text: item[2], done: item[1].toLowerCase() === 'x' });
        else description.push(line);
      }
      return {
        id: `task_${laneIndex}_${cardIndex}`,
        columnId: columns[laneIndex].id,
        title: card.title,
        notes: description.join('\n'),
        checked: card.checked,
        priority: card.priority,
        due: card.due,
        checklist,
      };
    }),
  );
  return {
    id: filePath,
    name,
    columns,
    tasks,
    filePath,
    fileEncoding: encoding,
    markdown,
  };
}

export const useKanbanStore = defineStore('taskKanban', {
  state: (): State => ({
    folder: null,
    projects: [],
    activeProjectId: null,
    loading: false,
    lastError: null,
  }),

  actions: {
    /** Point the board at a workspace and load its `boards/*.md` files. */
    async load(folder: string | null) {
      if (!folder) {
        this.folder = null;
        this.projects = [];
        this.activeProjectId = null;
        return;
      }
      if (this.folder === folder && this.projects.length > 0) return;
      this.folder = folder;
      this.loading = true;
      this.lastError = null;
      try {
        await this.migrateLegacy(folder);
        const dir = joinPath(folder, BOARDS_DIR);
        let entries: DirEntry[] = [];
        try {
          entries = await invoke<DirEntry[]>('list_dir', { path: dir });
        } catch {
          entries = [];
        }
        const files = entries
          .filter((entry) => !entry.is_dir && /\.md$/i.test(entry.name) && entry.path)
          .sort((a, b) => a.name.localeCompare(b.name));
        const loaded: StoredProject[] = [];
        for (const file of files) {
          try {
            const res = await invoke<FileReadResult>('read_file', { path: file.path });
            // Only files that declare themselves boards are loaded; a stray
            // note in boards/ must not become a column-less project.
            if (!/kanban-plugin\s*:/i.test(res.content)) continue;
            const markdown = parseBoardMarkdown(res.content);
            loaded.push(
              projectFromBoard(
                file.name.replace(/\.md$/i, ''),
                file.path,
                res.encoding || 'UTF-8',
                markdown,
              ),
            );
          } catch (err) {
            console.warn('[kanban] failed to read board', file.path, err);
          }
        }
        this.projects = loaded;
        this.activeProjectId = loaded[0]?.id ?? null;
      } catch (err) {
        this.lastError = String(err);
      } finally {
        this.loading = false;
      }
    },

    async ensureBoardsDir(folder: string): Promise<string> {
      const dir = joinPath(folder, BOARDS_DIR);
      try {
        await invoke('fs_create_dir', { path: dir });
      } catch (err) {
        if (!String(err).includes('already exists')) throw err;
      }
      return dir;
    },

    /** Copy the old localStorage boards into `boards/*.md` exactly once. */
    async migrateLegacy(folder: string) {
      if (localStorage.getItem(MIGRATED_KEY) === folder) return;
      const legacy = legacyBoardFromStorage(localStorage.getItem(LS_KEY));
      if (!legacy) {
        localStorage.setItem(MIGRATED_KEY, folder);
        return;
      }
      try {
        const dir = await this.ensureBoardsDir(folder);
        let entries: DirEntry[] = [];
        try {
          entries = await invoke<DirEntry[]>('list_dir', { path: dir });
        } catch {
          entries = [];
        }
        const taken = new Set(
          entries.filter((entry) => !entry.is_dir).map((entry) => entry.name.toLowerCase()),
        );
        for (const project of legacy.projects) {
          const fileName = safeBoardFileName(project.name, taken);
          await invoke('write_file', {
            path: joinPath(dir, fileName),
            content: projectToMarkdown(project),
            encoding: 'UTF-8',
          });
        }
        localStorage.setItem(MIGRATED_KEY, folder);
      } catch (err) {
        // Keep the marker unset so a later open retries. The legacy blob is
        // still there; nothing is lost.
        this.lastError = `看板迁移失败：${String(err)}`;
      }
    },

    async listFileNames(folder: string): Promise<Set<string>> {
      const dir = joinPath(folder, BOARDS_DIR);
      try {
        const entries = await invoke<DirEntry[]>('list_dir', { path: dir });
        return new Set(
          entries.filter((entry) => !entry.is_dir).map((entry) => entry.name.toLowerCase()),
        );
      } catch {
        return new Set();
      }
    },

    async createProject(name: string, columnTitles: string[]) {
      const folder = this.folder;
      if (!folder) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const dir = await this.ensureBoardsDir(folder);
        const taken = await this.listFileNames(folder);
        const fileName = safeBoardFileName(trimmed, taken);
        const path = joinPath(dir, fileName);
        const content = createBoardMarkdown(columnTitles);
        await invoke('write_file', { path, content, encoding: 'UTF-8' });
        const project = projectFromBoard(
          fileName.replace(/\.md$/i, ''),
          path,
          'UTF-8',
          parseBoardMarkdown(content),
        );
        this.projects.push(project);
        this.activeProjectId = project.id;
      } catch (err) {
        this.lastError = String(err);
      }
    },

    async renameProject(projectId: string, name: string) {
      const project = this.projects.find((p) => p.id === projectId);
      const trimmed = name.trim();
      const folder = this.folder;
      if (!project || !trimmed || !project.filePath || !folder) return;
      if (trimmed === project.name) return;
      try {
        const taken = await this.listFileNames(folder);
        taken.delete(`${project.name}.md`.toLowerCase());
        const fileName = safeBoardFileName(trimmed, taken);
        const nextPath = joinPath(folder, BOARDS_DIR, fileName);
        await invoke('fs_rename', { from: project.filePath, to: nextPath });
        project.name = fileName.replace(/\.md$/i, '');
        project.filePath = nextPath;
        project.id = nextPath;
        if (this.activeProjectId === projectId) this.activeProjectId = nextPath;
      } catch (err) {
        this.lastError = String(err);
      }
    },

    async deleteProject(projectId: string) {
      const project = this.projects.find((p) => p.id === projectId);
      if (!project) return;
      try {
        if (project.filePath) await invoke('fs_delete', { path: project.filePath });
        this.projects = this.projects.filter((p) => p.id !== projectId);
        if (this.activeProjectId === projectId) {
          this.activeProjectId = this.projects[0]?.id ?? null;
        }
      } catch (err) {
        this.lastError = String(err);
      }
    },

    /** Persist one project immediately (serializer keeps unknown content). */
    async persistNow(projectId: string) {
      const project = this.projects.find((p) => p.id === projectId);
      if (!project?.filePath) return;
      try {
        const content = serializeBoardMarkdown(boardFromProject(project));
        await invoke('write_file', {
          path: project.filePath,
          content,
          encoding: project.fileEncoding || 'UTF-8',
        });
        project.markdown = parseBoardMarkdown(content);
      } catch (err) {
        this.lastError = String(err);
      }
    },

    schedulePersist(projectId: string) {
      const existing = persistTimers.get(projectId);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        persistTimers.delete(projectId);
        void this.persistNow(projectId);
      }, 250);
      persistTimers.set(projectId, timer);
    },

    /** Apply a pure board mutation and write only the projects it changed. */
    apply(next: KanbanBoard) {
      const previous = this.projects;
      const projects = next.projects as StoredProject[];
      this.projects = projects;
      this.activeProjectId = next.activeProjectId;
      for (let i = 0; i < projects.length; i++) {
        if (projects[i] !== previous[i] && projects[i].filePath) {
          this.schedulePersist(projects[i].id);
        }
      }
    },

    setActive(projectId: string) {
      if (!this.projects.some((p) => p.id === projectId)) return;
      this.activeProjectId = projectId;
    },

    renameColumn(projectId: string, columnId: string, title: string) {
      this.apply(renameColumn(this.$state, projectId, columnId, title));
    },
    addColumn(projectId: string, title: string) {
      this.apply(addColumn(this.$state, projectId, title));
    },
    deleteColumn(projectId: string, columnId: string) {
      this.apply(deleteColumn(this.$state, projectId, columnId));
    },
    addTask(projectId: string, columnId: string, title: string, notes = '') {
      this.apply(addTask(this.$state, projectId, columnId, title, notes));
    },
    updateTask(
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
    ) {
      this.apply(updateTask(this.$state, projectId, taskId, patch));
    },
    deleteTask(projectId: string, taskId: string) {
      this.apply(deleteTask(this.$state, projectId, taskId));
    },
    moveTask(projectId: string, taskId: string, columnId: string) {
      this.apply(moveTask(this.$state, projectId, taskId, columnId));
    },
  },
});
