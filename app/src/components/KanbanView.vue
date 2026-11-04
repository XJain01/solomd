<script setup lang="ts">
/**
 * Center-pane task kanban. Projects, columns, and tasks are created by the
 * user and stored on this device. Notes in the vault are not cards.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import Icons from './Icons.vue';
import '../styles/panels.css';
import { useI18n } from '../i18n';
import { useKanbanStore } from '../stores/kanban';
import type { KanbanTask } from '../lib/kanban';
import { KANBAN_CLOSE_EVENT } from '../composables/useKanbanView';

const { t } = useI18n();
const board = useKanbanStore();

const project = computed(() =>
  board.projects.find((p) => p.id === board.activeProjectId) ?? board.projects[0] ?? null,
);

const creatingProject = ref(false);
const projectDraft = ref('');
const renamingProject = ref(false);
const columnDraft = ref('');
const addingColumn = ref(false);
const taskDraft = ref<Record<string, string>>({});
const editingId = ref<string | null>(null);
const editTitle = ref('');
const editNotes = ref('');

const dragging = ref<string | null>(null);
const overCol = ref<string | null>(null);
let suppressClick = false;
let dragStart: { x: number; y: number; id: string; moved: boolean } | null = null;

function close() {
  window.dispatchEvent(new CustomEvent(KANBAN_CLOSE_EVENT));
}

function defaultColumns(): string[] {
  return [t('kanban.colTodo'), t('kanban.colDoing'), t('kanban.colDone')];
}

function startProject() {
  creatingProject.value = true;
  projectDraft.value = '';
}

function commitProject() {
  const name = projectDraft.value.trim();
  if (!name) return;
  board.createProject(name, defaultColumns());
  creatingProject.value = false;
  projectDraft.value = '';
}

function removeProject() {
  const current = project.value;
  if (!current) return;
  if (!window.confirm(t('kanban.confirmDeleteProject'))) return;
  board.deleteProject(current.id);
}

function commitColumn() {
  const current = project.value;
  const title = columnDraft.value.trim();
  if (!current || !title) return;
  board.addColumn(current.id, title);
  columnDraft.value = '';
  addingColumn.value = false;
}

function removeColumn(columnId: string) {
  const current = project.value;
  if (!current) return;
  if (!window.confirm(t('kanban.confirmDeleteColumn'))) return;
  board.deleteColumn(current.id, columnId);
}

function renameColumn(columnId: string, title: string) {
  const current = project.value;
  if (!current) return;
  board.renameColumn(current.id, columnId, title);
}

function tasksIn(columnId: string): KanbanTask[] {
  return project.value?.tasks.filter((task) => task.columnId === columnId) ?? [];
}

function addTask(columnId: string) {
  const current = project.value;
  const title = (taskDraft.value[columnId] || '').trim();
  if (!current || !title) return;
  board.addTask(current.id, columnId, title);
  taskDraft.value = { ...taskDraft.value, [columnId]: '' };
}

function openTask(task: KanbanTask) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  editingId.value = task.id;
  editTitle.value = task.title;
  editNotes.value = task.notes;
}

function saveTask() {
  const current = project.value;
  const id = editingId.value;
  if (!current || !id) return;
  board.updateTask(current.id, id, { title: editTitle.value, notes: editNotes.value });
  editingId.value = null;
}

function removeTask() {
  const current = project.value;
  const id = editingId.value;
  if (!current || !id) return;
  board.deleteTask(current.id, id);
  editingId.value = null;
}

function columnAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  const col = el?.closest<HTMLElement>('[data-kanban-col]');
  return col?.dataset.kanbanCol ?? null;
}

function onCardPointerDown(e: PointerEvent, id: string) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement | null)?.closest('input, textarea, button')) return;
  dragStart = { x: e.clientX, y: e.clientY, id, moved: false };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e: PointerEvent) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (!dragStart.moved && dx * dx + dy * dy < 36) return;
  dragStart.moved = true;
  dragging.value = dragStart.id;
  overCol.value = columnAt(e.clientX, e.clientY);
}

function onPointerUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  const start = dragStart;
  dragStart = null;
  if (start?.moved) {
    suppressClick = true;
    queueMicrotask(() => { suppressClick = false; });
  }
  const target = start?.moved ? columnAt(e.clientX, e.clientY) : null;
  dragging.value = null;
  overCol.value = null;
  const current = project.value;
  if (!start?.moved || !current || !start.id || !target) return;
  const task = current.tasks.find((item) => item.id === start.id);
  if (!task || task.columnId === target) return;
  board.moveTask(current.id, task.id, target);
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
});
</script>

<template>
  <div class="kanban pg">
    <header class="pg-head">
      <button class="pg-icon-btn" type="button" :title="t('kanban.back')" :aria-label="t('kanban.back')" @click="close">
        <Icons name="chevron-left" :size="18" />
      </button>
      <h1 class="pg-title">{{ t('kanban.heading') }}</h1>
      <label v-if="board.projects.length" class="kanban__project">
        <span class="kanban__project-label">{{ t('kanban.projects') }}</span>
        <select
          class="kanban__select"
          :value="project?.id || ''"
          @change="board.setActive(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="item in board.projects" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </label>
      <span class="pg-spacer" />
      <button class="rp-btn" type="button" @click="startProject">{{ t('kanban.newProject') }}</button>
      <button v-if="project" class="rp-btn" type="button" @click="removeProject">{{ t('kanban.deleteProject') }}</button>
    </header>

    <form v-if="creatingProject" class="kanban__create" @submit.prevent="commitProject">
      <input
        v-model="projectDraft"
        class="kanban__input"
        type="text"
        :placeholder="t('kanban.projectName')"
        autofocus
      />
      <button class="rp-btn" type="submit">{{ t('kanban.save') }}</button>
      <button class="rp-btn" type="button" @click="creatingProject = false">{{ t('kanban.cancel') }}</button>
    </form>

    <div v-if="!project && !creatingProject" class="kanban__empty">
      <p class="kanban__empty-title">{{ t('kanban.emptyTitle') }}</p>
      <p class="kanban__empty-body">{{ t('kanban.emptyBody') }}</p>
      <button class="rp-btn" type="button" @click="startProject">{{ t('kanban.newProject') }}</button>
    </div>

    <template v-else-if="project">
      <div class="kanban__toolbar">
        <input
          v-if="renamingProject"
          class="kanban__input"
          :value="project.name"
          @change="board.renameProject(project.id, ($event.target as HTMLInputElement).value); renamingProject = false"
          @keydown.enter="board.renameProject(project.id, ($event.target as HTMLInputElement).value); renamingProject = false"
        />
        <button v-else class="kanban__rename" type="button" @click="renamingProject = true">
          {{ project.name }}
        </button>
        <span class="kanban__hint">{{ t('kanban.hint') }}</span>
      </div>

      <div class="kanban__board pg-body" role="list">
        <section
          v-for="col in project.columns"
          :key="col.id"
          class="kanban__col"
          :class="{ 'kanban__col--over': overCol === col.id }"
          :data-kanban-col="col.id"
          role="list"
          :aria-label="col.title"
        >
          <header class="kanban__col-head">
            <input
              class="kanban__col-title"
              :value="col.title"
              :aria-label="t('kanban.columnName')"
              @change="renameColumn(col.id, ($event.target as HTMLInputElement).value)"
            />
            <span class="kanban__count">{{ tasksIn(col.id).length }}</span>
            <button class="kanban__icon" type="button" :title="t('kanban.deleteColumn')" :aria-label="t('kanban.deleteColumn')" @click="removeColumn(col.id)">
              <Icons name="close" :size="14" />
            </button>
          </header>
          <div class="kanban__cards">
            <article
              v-for="task in tasksIn(col.id)"
              :key="task.id"
              class="kanban__card"
              :class="{ 'kanban__card--dragging': dragging === task.id }"
              @pointerdown="onCardPointerDown($event, task.id)"
              @click="openTask(task)"
            >
              <template v-if="editingId === task.id">
                <input v-model="editTitle" class="kanban__input" type="text" :placeholder="t('kanban.taskTitle')" @click.stop @pointerdown.stop />
                <textarea v-model="editNotes" class="kanban__notes" rows="3" :placeholder="t('kanban.taskNotes')" @click.stop @pointerdown.stop />
                <div class="kanban__card-actions">
                  <button class="rp-btn" type="button" @click.stop="saveTask">{{ t('kanban.save') }}</button>
                  <button class="rp-btn" type="button" @click.stop="removeTask">{{ t('kanban.deleteTask') }}</button>
                  <button class="rp-btn" type="button" @click.stop="editingId = null">{{ t('kanban.cancel') }}</button>
                </div>
              </template>
              <template v-else>
                <span class="kanban__card-title">{{ task.title }}</span>
                <span v-if="task.notes" class="kanban__card-notes">{{ task.notes }}</span>
              </template>
            </article>
            <p v-if="tasksIn(col.id).length === 0" class="kanban__drop">{{ t('kanban.noTasks') }}</p>
          </div>
          <form class="kanban__add" @submit.prevent="addTask(col.id)">
            <input
              v-model="taskDraft[col.id]"
              class="kanban__input"
              type="text"
              :placeholder="t('kanban.newTask')"
              @pointerdown.stop
            />
          </form>
        </section>

        <section class="kanban__col kanban__col--new">
          <form v-if="addingColumn" class="kanban__add" @submit.prevent="commitColumn">
            <input v-model="columnDraft" class="kanban__input" type="text" :placeholder="t('kanban.columnName')" autofocus />
            <div class="kanban__card-actions">
              <button class="rp-btn" type="submit">{{ t('kanban.save') }}</button>
              <button class="rp-btn" type="button" @click="addingColumn = false">{{ t('kanban.cancel') }}</button>
            </div>
          </form>
          <button v-else class="kanban__new-col" type="button" @click="addingColumn = true">{{ t('kanban.newColumn') }}</button>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.kanban__project {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.kanban__project-label,
.kanban__hint,
.kanban__count,
.kanban__card-notes,
.kanban__drop {
  font-size: 12px;
  color: var(--text-3);
}
.kanban__select,
.kanban__input,
.kanban__notes,
.kanban__col-title {
  font: inherit;
  color: var(--text);
  background: var(--bg);
  border: var(--bd-hair);
  border-radius: var(--r-sm);
  padding: 4px 8px;
}
.kanban__select { max-width: 220px; }
.kanban__create,
.kanban__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 0;
}
.kanban__hint { margin-left: auto; max-width: 420px; }
.kanban__rename {
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.kanban__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  text-align: center;
  color: var(--text-3);
}
.kanban__empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.kanban__empty-body {
  margin: 0;
  max-width: 440px;
  line-height: 1.6;
}
.kanban__board {
  display: flex;
  gap: 12px;
  align-items: stretch;
  overflow-x: auto;
}
.kanban__col {
  flex: 1 1 220px;
  min-width: 220px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  min-height: 240px;
  border: var(--bd-hair);
  border-radius: var(--r-lg);
  background: var(--fill-1);
}
.kanban__col--new {
  background: transparent;
  min-height: 0;
  justify-content: flex-start;
  padding: 8px;
}
.kanban__col--over {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.kanban__col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
}
.kanban__col-title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  background: transparent;
}
.kanban__icon,
.kanban__new-col {
  border: 0;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.kanban__new-col {
  padding: 8px;
  text-align: left;
  font: inherit;
}
.kanban__cards {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 8px;
  min-height: 48px;
}
.kanban__card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  padding: 10px 12px;
  border: var(--bd-hair);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--text);
  text-align: left;
  cursor: grab;
  touch-action: none;
}
.kanban__card--dragging { opacity: 0.45; }
.kanban__card-title { font-weight: 560; line-height: 1.4; }
.kanban__card-notes {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  white-space: pre-wrap;
}
.kanban__notes { width: 100%; resize: vertical; }
.kanban__card-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.kanban__add { display: flex; flex-direction: column; gap: 6px; padding: 0 8px 8px; }
.kanban__drop { margin: 4px; text-align: center; }
</style>
