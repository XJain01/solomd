<script setup lang="ts">
/**
 * Center-pane task kanban. Projects, columns, and tasks are created by the
 * user and stored on this device. Notes in the vault are not cards.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
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
const projectNameInput = ref<HTMLInputElement | null>(null);
// Esc must not be treated as a commit when the browser fires blur on the
// input we are about to unmount.
let skipRenameCommit = false;
const columnDraft = ref('');
const addingColumn = ref(false);
const taskDraft = ref<Record<string, string>>({});
const editingId = ref<string | null>(null);
const editTitle = ref('');
const editNotes = ref('');

const dragging = ref<string | null>(null);
const overCol = ref<string | null>(null);
// The card under the cursor stays where it is (dimmed); this follows the
// pointer so the drag has something visible in the hand.
const ghost = ref<{ x: number; y: number; title: string } | null>(null);
// A drag that ends back over a card still fires click/dblclick, which would
// drop the user into the editor by accident. Swallow the following open for as
// long as the browser's double-click window is live.
let justDragged = false;
let justDraggedTimer = 0;
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

function startProjectRename() {
  renamingProject.value = true;
  // The header swaps a <select> for an <input>; autofocus only applies on the
  // first mount, so focus by hand once the input exists.
  nextTick(() => projectNameInput.value?.focus());
}

function commitProjectName(name: string) {
  if (skipRenameCommit) {
    skipRenameCommit = false;
    renamingProject.value = false;
    return;
  }
  const current = project.value;
  renamingProject.value = false;
  const trimmed = name.trim();
  if (!current || !trimmed || trimmed === current.name) return;
  board.renameProject(current.id, trimmed);
}

function cancelProjectRename() {
  skipRenameCommit = true;
  renamingProject.value = false;
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
  if (justDragged) return;
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
  // A press-drag over text means "select this text" by default. On a card it
  // means "move this card", so cancel the selection gesture and focus the card
  // ourselves (preventDefault also suppresses the browser's own focus handling).
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus();
  dragStart = { x: e.clientX, y: e.clientY, id, moved: false };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function taskTitle(id: string): string {
  return project.value?.tasks.find((item) => item.id === id)?.title ?? '';
}

function setDragChrome(on: boolean) {
  document.body.style.cursor = on ? 'grabbing' : '';
  document.body.style.userSelect = on ? 'none' : '';
}

function clearDragVisuals() {
  dragging.value = null;
  overCol.value = null;
  ghost.value = null;
  setDragChrome(false);
}

function onPointerMove(e: PointerEvent) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (!dragStart.moved && dx * dx + dy * dy < 36) return;
  if (!dragStart.moved) {
    dragStart.moved = true;
    dragging.value = dragStart.id;
    setDragChrome(true);
  }
  ghost.value = { x: e.clientX, y: e.clientY, title: taskTitle(dragStart.id) };
  overCol.value = columnAt(e.clientX, e.clientY);
}

function onPointerUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  const start = dragStart;
  dragStart = null;
  const moved = start?.moved ?? false;
  const target = moved ? columnAt(e.clientX, e.clientY) : null;
  clearDragVisuals();
  if (moved && start) {
    justDragged = true;
    window.clearTimeout(justDraggedTimer);
    justDraggedTimer = window.setTimeout(() => {
      justDragged = false;
    }, 500);
  }
  const current = project.value;
  if (!moved || !current || !start?.id || !target) return;
  const task = current.tasks.find((item) => item.id === start.id);
  if (!task || task.columnId === target) return;
  board.moveTask(current.id, task.id, target);
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  window.clearTimeout(justDraggedTimer);
  clearDragVisuals();
});
</script>

<template>
  <div class="kanban pg">
    <header class="pg-head">
      <button class="pg-icon-btn" type="button" :title="t('kanban.back')" :aria-label="t('kanban.back')" @click="close">
        <Icons name="chevron-left" :size="18" />
      </button>
      <h1 class="pg-title">{{ t('kanban.heading') }}</h1>
      <span v-if="project" class="kanban__project">
        <input
          v-if="renamingProject"
          ref="projectNameInput"
          class="kanban__input kanban__project-name"
          :value="project.name"
          :aria-label="t('kanban.projectName')"
          @change="commitProjectName(($event.target as HTMLInputElement).value)"
          @blur="commitProjectName(($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="commitProjectName(($event.target as HTMLInputElement).value)"
          @keydown.esc.prevent="cancelProjectRename"
        />
        <template v-else>
          <select
            class="kanban__select"
            :value="project.id"
            :aria-label="t('kanban.projects')"
            @change="board.setActive(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in board.projects" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
          <button
            class="pg-icon-btn"
            type="button"
            :title="t('kanban.projectName')"
            :aria-label="t('kanban.projectName')"
            @click="startProjectRename"
          >
            <Icons name="pencil" :size="14" />
          </button>
        </template>
      </span>
      <span class="pg-spacer" />
      <span class="kanban__actions">
        <button class="rp-btn" type="button" @click="startProject">{{ t('kanban.newProject') }}</button>
        <button v-if="project" class="rp-btn" type="button" @click="removeProject">{{ t('kanban.deleteProject') }}</button>
      </span>
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
      <div class="kanban__board pg-body" role="list" :title="t('kanban.hint')">
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
              tabindex="0"
              @pointerdown="onCardPointerDown($event, task.id)"
              @dblclick="openTask(task)"
              @keydown.enter.prevent="openTask(task)"
            >
              <template v-if="editingId === task.id">
                <input v-model="editTitle" class="kanban__input kanban__card-input" type="text" :placeholder="t('kanban.taskTitle')" @click.stop @pointerdown.stop @keydown.stop />
                <textarea v-model="editNotes" class="kanban__notes kanban__card-input" rows="3" :placeholder="t('kanban.taskNotes')" @click.stop @pointerdown.stop @keydown.stop />
                <div class="kanban__card-actions">
                  <button class="rp-btn" type="button" @click.stop="saveTask">{{ t('kanban.save') }}</button>
                  <button class="rp-btn" type="button" @click.stop="removeTask">{{ t('kanban.deleteTask') }}</button>
                  <button class="rp-btn" type="button" @click.stop="editingId = null">{{ t('kanban.cancel') }}</button>
                </div>
              </template>
              <template v-else>
                <span class="kanban__card-title">{{ task.title }}</span>
                <span v-if="task.notes" class="kanban__card-notes">{{ task.notes }}</span>
                <!-- Deliberate alternative to double-click: a single click here
                     is unambiguous because it sits on a control, not the card. -->
                <button
                  class="kanban__card-edit"
                  type="button"
                  :title="t('kanban.editTask')"
                  :aria-label="t('kanban.editTask')"
                  @click.stop="openTask(task)"
                  @pointerdown.stop
                >
                  <Icons name="pencil" :size="13" />
                </button>
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

    <!-- Teleported so the drag preview is never clipped by a scrolling column
         or offset by an ancestor transform; it is pointer-transparent, so it
         cannot steal the drop target lookup under the cursor. -->
    <Teleport to="body">
      <div
        v-if="ghost"
        class="kanban__ghost"
        :style="{ left: `${ghost.x}px`, top: `${ghost.y}px` }"
        aria-hidden="true"
      >{{ ghost.title }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
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
/* Header groups: `.pg-head` wraps on a narrow content column (agent dock
   open), so keep each group on one line rather than letting the pencil or a
   button drop onto its own ragged row. */
.kanban__project,
.kanban__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.kanban__project {
  /* Shrinkable so a narrow content column (agent dock open) costs the select
     width instead of pushing the whole header onto extra rows. */
  flex: 1 1 120px;
}
.kanban__actions { flex: 0 0 auto; }
.kanban__select {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  max-width: 220px;
}
.kanban__project-name {
  width: 200px;
  max-width: 220px;
}
.kanban__create {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 0;
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
  position: relative;
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
  /* A card is a drag target, not a text surface: without this a press-drag
     highlights the title instead of moving the card. Inputs inside the edit
     state re-enable selection (see .kanban__input / .kanban__notes). */
  user-select: none;
  -webkit-user-select: none;
}
.kanban__card--dragging {
  opacity: 0.35;
  cursor: grabbing;
}
.kanban__card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.kanban__card-input {
  user-select: text;
  -webkit-user-select: text;
}
.kanban__card-title { font-weight: 560; line-height: 1.4; }
.kanban__card-edit {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--fill-1);
  color: var(--text-2);
  cursor: pointer;
  opacity: 0;
}
.kanban__card:hover .kanban__card-edit,
.kanban__card:focus-within .kanban__card-edit { opacity: 1; }
.kanban__card-edit:hover { background: var(--fill-2); color: var(--text); }
.kanban__ghost {
  position: fixed;
  z-index: 999;
  max-width: 260px;
  padding: 10px 12px;
  border: var(--bd-hair);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  line-height: 1.4;
  box-shadow: var(--shadow-2, 0 8px 24px rgb(0 0 0 / 22%));
  pointer-events: none;
  transform: translate(-50%, -50%) rotate(-1.5deg);
  opacity: 0.92;
}
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
