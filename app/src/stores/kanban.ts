/**
 * Local task board. Same persistence style as the pomodoro store:
 * one JSON blob in localStorage, reloaded on the next launch.
 */
import { defineStore } from 'pinia';
import {
  addColumn,
  addTask,
  createProject,
  deleteColumn,
  deleteProject,
  deleteTask,
  emptyBoard,
  moveTask,
  normalizeBoard,
  renameColumn,
  renameProject,
  updateTask,
  type KanbanBoard,
} from '../lib/kanban';

const LS_KEY = 'solomd.kanban.v1';

function load(): KanbanBoard {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return emptyBoard();
    return normalizeBoard(JSON.parse(raw));
  } catch {
    return emptyBoard();
  }
}

export const useKanbanStore = defineStore('taskKanban', {
  state: (): KanbanBoard => load(),
  actions: {
    persist() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          projects: this.projects,
          activeProjectId: this.activeProjectId,
        }));
      } catch { /* private mode / quota */ }
    },
    apply(next: KanbanBoard) {
      this.projects = next.projects;
      this.activeProjectId = next.activeProjectId;
      this.persist();
    },
    setActive(projectId: string) {
      if (!this.projects.some((p) => p.id === projectId)) return;
      this.activeProjectId = projectId;
      this.persist();
    },
    createProject(name: string, columnTitles: string[]) {
      this.apply(createProject(this.$state, name, columnTitles));
    },
    renameProject(projectId: string, name: string) {
      this.apply(renameProject(this.$state, projectId, name));
    },
    deleteProject(projectId: string) {
      this.apply(deleteProject(this.$state, projectId));
    },
    addColumn(projectId: string, title: string) {
      this.apply(addColumn(this.$state, projectId, title));
    },
    renameColumn(projectId: string, columnId: string, title: string) {
      this.apply(renameColumn(this.$state, projectId, columnId, title));
    },
    deleteColumn(projectId: string, columnId: string) {
      this.apply(deleteColumn(this.$state, projectId, columnId));
    },
    addTask(projectId: string, columnId: string, title: string, notes = '') {
      this.apply(addTask(this.$state, projectId, columnId, title, notes));
    },
    updateTask(projectId: string, taskId: string, patch: { title?: string; notes?: string; columnId?: string }) {
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
