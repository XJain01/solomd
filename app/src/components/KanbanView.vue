<script setup lang="ts">
/**
 * Center-pane task kanban. Projects, columns, and tasks are created by the
 * user and stored on this device. Notes in the vault are not cards.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icons from './Icons.vue';
import '../styles/panels.css';
import { useI18n } from '../i18n';
import { useKanbanStore } from '../stores/kanban';
import { useWorkspaceStore } from '../stores/workspace';
import { useFiles } from '../composables/useFiles';
import type { KanbanChecklistItem, KanbanPriority, KanbanTask } from '../lib/kanban';
import { KANBAN_CLOSE_EVENT } from '../composables/useKanbanView';

const { t } = useI18n();
const board = useKanbanStore();
const workspace = useWorkspaceStore();
const files = useFiles();

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

// Task detail drawer. Edits are local until Save so Cancel is real.
const detailId = ref<string | null>(null);
const detailTitle = ref('');
const detailNotes = ref('');
const detailPriority = ref<'' | KanbanPriority>('');
const detailDue = ref('');
const detailColumnId = ref('');
const detailChecklist = ref<KanbanChecklistItem[]>([]);
const detailChecked = ref(false);
const checklistDraft = ref('');

const dragging = ref<string | null>(null);
const overCol = ref<string | null>(null);
// Card under the cursor, used only while the mouse button is down so the
// card does not look draggable on hover.
const pressingId = ref<string | null>(null);
// The card under the cursor stays where it is (dimmed); this follows the
// pointer so the drag has something visible in the hand.
const ghost = ref<{ x: number; y: number; title: string } | null>(null);
let holdTimer = 0;
let held = false;
let dragStart: { x: number; y: number; id: string; moved: boolean; startedAt: number } | null = null;

function close() {
  window.dispatchEvent(new CustomEvent(KANBAN_CLOSE_EVENT));
}

async function openSource() {
  const path = project.value?.filePath;
  if (!path) return;
  close();
  await files.openPath(path, { bypassNewWindow: true });
}

function loadBoards() {
  void board.load(workspace.currentFolder);
}

onMounted(loadBoards);
watch(() => workspace.currentFolder, loadBoards);

function defaultColumns(): string[] {
  return [t('kanban.colTodo'), t('kanban.colDoing'), t('kanban.colDone')];
}

function startProject() {
  creatingProject.value = true;
  projectDraft.value = '';
}

async function commitProject() {
  const name = projectDraft.value.trim();
  if (!name) return;
  await board.createProject(name, defaultColumns());
  creatingProject.value = false;
  projectDraft.value = '';
}

function startProjectRename() {
  renamingProject.value = true;
  // The header swaps a <select> for an <input>; autofocus only applies on the
  // first mount, so focus by hand once the input exists.
  nextTick(() => projectNameInput.value?.focus());
}

async function commitProjectName(name: string) {
  if (skipRenameCommit) {
    skipRenameCommit = false;
    renamingProject.value = false;
    return;
  }
  const current = project.value;
  renamingProject.value = false;
  const trimmed = name.trim();
  if (!current || !trimmed || trimmed === current.name) return;
  await board.renameProject(current.id, trimmed);
}

function cancelProjectRename() {
  skipRenameCommit = true;
  renamingProject.value = false;
}

async function removeProject() {
  const current = project.value;
  if (!current) return;
  if (!window.confirm(t('kanban.confirmDeleteProject'))) return;
  await board.deleteProject(current.id);
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

/** `## 进行中 (3)` → 3; no suffix → null. */
function wipLimit(title: string): number | null {
  const match = /\((\d+)\)\s*$/.exec(title);
  return match ? Number(match[1]) : null;
}

function isOverLimit(title: string, count: number): boolean {
  const limit = wipLimit(title);
  return limit !== null && count > limit;
}

function isOverdue(due?: string): boolean {
  if (!due) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  return due < today;
}

function checklistDone(task: KanbanTask): number {
  return (task.checklist ?? []).filter((item) => item.done).length;
}

function checklistPercent(task: KanbanTask): number {
  const total = task.checklist?.length ?? 0;
  if (!total) return 0;
  return Math.round((checklistDone(task) / total) * 100);
}

function addTask(columnId: string) {
  const current = project.value;
  const title = (taskDraft.value[columnId] || '').trim();
  if (!current || !title) return;
  board.addTask(current.id, columnId, title);
  taskDraft.value = { ...taskDraft.value, [columnId]: '' };
}

function openDetail(task: KanbanTask) {
  detailId.value = task.id;
  detailTitle.value = task.title;
  detailNotes.value = task.notes;
  detailPriority.value = task.priority ?? '';
  detailDue.value = task.due ?? '';
  detailColumnId.value = task.columnId;
  detailChecklist.value = (task.checklist ?? []).map((item) => ({ ...item }));
  detailChecked.value = !!task.checked;
  checklistDraft.value = '';
}

/** Persist the drawer's local edits. Returns false when there is nothing
 *  valid to save (e.g. an empty title), in which case closing discards them. */
function applyDetail(): boolean {
  const current = project.value;
  const id = detailId.value;
  const title = detailTitle.value.trim();
  if (!current || !id || !title) return false;
  board.updateTask(current.id, id, {
    title,
    notes: detailNotes.value,
    priority: detailPriority.value || null,
    due: detailDue.value || null,
    checklist: detailChecklist.value,
    columnId: detailColumnId.value,
    checked: detailChecked.value,
  });
  return true;
}

function closeDetailOnly() {
  detailId.value = null;
  checklistDraft.value = '';
}

/** Closing always saves: X, the scrim, and the Close button all land here. */
function closeDetail() {
  applyDetail();
  closeDetailOnly();
}

function saveDetail() {
  if (applyDetail()) closeDetailOnly();
}

function deleteDetail() {
  const current = project.value;
  const id = detailId.value;
  if (!current || !id) return;
  board.deleteTask(current.id, id);
  closeDetailOnly();
}

function addChecklistItem() {
  const text = checklistDraft.value.trim();
  if (!text) return;
  detailChecklist.value.push({ text, done: false });
  checklistDraft.value = '';
}

function removeChecklistItem(index: number) {
  detailChecklist.value.splice(index, 1);
}

function openTask(task: KanbanTask) {
  openDetail(task);
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
  pressingId.value = id;
  held = false;
  window.clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => {
    held = true;
  }, 250);
  dragStart = { x: e.clientX, y: e.clientY, id, moved: false, startedAt: Date.now() };
  // The hand appears only while the button is down — hover uses the normal
  // cursor. A quick release opens details; a hold or a drag does not.
  setDragChrome(true);
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
  pressingId.value = null;
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
  }
  ghost.value = { x: e.clientX, y: e.clientY, title: taskTitle(dragStart.id) };
  overCol.value = columnAt(e.clientX, e.clientY);
}

function onPointerUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  window.clearTimeout(holdTimer);
  const start = dragStart;
  dragStart = null;
  const moved = start?.moved ?? false;
  // A quick press-and-release opens details; a hold or a drag does not.
  const quickClick =
    !!start && !moved && !held && Date.now() - start.startedAt <= 250;
  const target = moved ? columnAt(e.clientX, e.clientY) : null;
  clearDragVisuals();
  const current = project.value;
  if (moved && start?.id && target && current) {
    const task = current.tasks.find((item) => item.id === start.id);
    if (task && task.columnId !== target) board.moveTask(current.id, task.id, target);
    return;
  }
  if (quickClick && start && current) {
    const task = current.tasks.find((item) => item.id === start.id);
    if (task) openDetail(task);
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  window.clearTimeout(holdTimer);
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
        <button
          v-if="project?.filePath"
          class="rp-btn"
          type="button"
          @click="openSource"
        >{{ t('kanban.openSource') }}</button>
        <button class="rp-btn" type="button" @click="startProject">{{ t('kanban.newProject') }}</button>
        <button v-if="project" class="rp-btn" type="button" @click="removeProject">{{ t('kanban.deleteProject') }}</button>
      </span>
    </header>

    <p v-if="board.lastError" class="kanban__error">{{ board.lastError }}</p>

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

    <div v-if="board.loading" class="kanban__empty">
      <p class="kanban__empty-body">{{ t('kanban.loading') }}</p>
    </div>

    <div v-else-if="!project && !creatingProject" class="kanban__empty">
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
            <span
              class="kanban__count"
              :class="{ 'kanban__count--over': isOverLimit(col.title, tasksIn(col.id).length) }"
            >
              {{ tasksIn(col.id).length }}<template v-if="wipLimit(col.title) !== null">/{{ wipLimit(col.title) }}</template>
            </span>
            <button class="kanban__icon" type="button" :title="t('kanban.deleteColumn')" :aria-label="t('kanban.deleteColumn')" @click="removeColumn(col.id)">
              <Icons name="close" :size="14" />
            </button>
          </header>
          <div class="kanban__cards">
            <article
              v-for="task in tasksIn(col.id)"
              :key="task.id"
              class="kanban__card"
              :class="{
                'kanban__card--dragging': dragging === task.id,
                'kanban__card--pressing': pressingId === task.id,
                'kanban__card--done': task.checked,
              }"
              tabindex="0"
              @pointerdown="onCardPointerDown($event, task.id)"
              @keydown.enter.prevent="openTask(task)"
            >
              <span class="kanban__card-line">
                <span class="kanban__card-title" :class="{ 'kanban__card-title--done': task.checked }">{{ task.title }}</span>
              </span>
              <span
                v-if="task.priority || task.due || (task.checklist && task.checklist.length)"
                class="kanban__card-meta"
              >
                <span
                  v-if="task.priority"
                  class="kanban__prio"
                  :class="`kanban__prio--${task.priority}`"
                >{{ task.priority }}</span>
                <span
                  v-if="task.due"
                  class="kanban__due"
                  :class="{ 'kanban__due--overdue': isOverdue(task.due) }"
                >{{ task.due.slice(5) }}</span>
                <span v-if="task.checklist && task.checklist.length" class="kanban__progress">
                  <Icons name="check" :size="10" /> {{ checklistDone(task) }}/{{ task.checklist.length }}
                </span>
              </span>
              <div
                v-if="task.checklist && task.checklist.length"
                class="kanban__progressbar"
                role="progressbar"
                :aria-valuenow="checklistDone(task)"
                aria-valuemin="0"
                :aria-valuemax="task.checklist.length"
              >
                <span
                  class="kanban__progressbar-fill"
                  :style="{ width: `${checklistPercent(task)}%` }"
                />
              </div>
              <span v-if="task.notes" class="kanban__card-notes">{{ task.notes }}</span>
              <!-- Opens the detail drawer; a single click on this control is
                   unambiguous, unlike a click on the card itself. -->
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

    <!-- Task detail drawer with a modal scrim; closing saves. -->
    <Teleport to="body">
      <div v-if="detailId" class="kanban__detail-backdrop" @click.self="closeDetail">
        <aside class="kanban__detail" role="dialog" aria-modal="true" @pointerdown.stop>
        <header class="kanban__detail-head">
            <h2 class="kanban__detail-title">{{ t('kanban.taskDetails') }}</h2>
            <button class="kanban__icon" type="button" :aria-label="t('kanban.cancel')" @click="closeDetail">
              <Icons name="close" :size="14" />
            </button>
          </header>
          <div class="kanban__detail-body">
            <label class="kanban__field">
              <span>{{ t('kanban.title') }}</span>
              <input v-model="detailTitle" class="kanban__input" type="text" />
            </label>
            <label class="kanban__field">
              <span>{{ t('kanban.description') }}</span>
              <textarea v-model="detailNotes" class="kanban__notes" rows="4" />
            </label>
            <label class="kanban__field kanban__field--check">
              <input v-model="detailChecked" type="checkbox" />
              <span>{{ t('kanban.taskDone') }}</span>
            </label>
            <div class="kanban__field-row">
              <label class="kanban__field">
                <span>{{ t('kanban.priority') }}</span>
                <select v-model="detailPriority" class="kanban__select">
                  <option value="">{{ t('kanban.noPriority') }}</option>
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                </select>
              </label>
              <label class="kanban__field">
                <span>{{ t('kanban.status') }}</span>
                <select v-model="detailColumnId" class="kanban__select">
                  <option v-for="col in project?.columns || []" :key="col.id" :value="col.id">{{ col.title }}</option>
                </select>
              </label>
            </div>
            <div class="kanban__field">
              <span>{{ t('kanban.due') }}</span>
              <div class="kanban__due-row">
                <input v-model="detailDue" class="kanban__input" type="date" />
                <button v-if="detailDue" class="rp-btn rp-btn--sm" type="button" @click="detailDue = ''">
                  {{ t('kanban.clear') }}
                </button>
              </div>
            </div>
            <div class="kanban__field">
              <span>{{ t('kanban.checklist') }}</span>
              <p v-if="!detailChecklist.length" class="kanban__detail-hint">{{ t('kanban.noChecklist') }}</p>
              <div v-for="(item, index) in detailChecklist" :key="index" class="kanban__check-row">
                <input v-model="item.done" type="checkbox" />
                <input v-model="item.text" class="kanban__input" type="text" />
                <button
                  class="kanban__icon"
                  type="button"
                  :aria-label="t('kanban.deleteTask')"
                  @click="removeChecklistItem(index)"
                >
                  <Icons name="close" :size="12" />
                </button>
              </div>
              <input
                v-model="checklistDraft"
                class="kanban__input"
                type="text"
                :placeholder="t('kanban.addChecklistItem')"
                @keydown.enter.prevent="addChecklistItem"
              />
            </div>
          </div>
          <footer class="kanban__detail-foot">
            <button class="rp-btn" type="button" @click="deleteDetail">{{ t('kanban.deleteTask') }}</button>
            <span class="pg-spacer" />
            <button class="rp-btn" type="button" @click="closeDetail">{{ t('kanban.close') }}</button>
            <button class="rp-btn" type="button" :disabled="!detailTitle.trim()" @click="saveDetail">
              {{ t('kanban.save') }}
            </button>
          </footer>
        </aside>
      </div>
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
  cursor: default;
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
.kanban__card--pressing {
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
.kanban__card-line {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.kanban__check {
  flex: 0 0 auto;
  margin: 3px 0 0;
  cursor: pointer;
  accent-color: var(--accent);
}
.kanban__card-title--done {
  color: var(--text-3);
  text-decoration: line-through;
}
.kanban__error {
  margin: 0;
  padding: 6px 16px;
  color: var(--danger);
  font-size: 12px;
}
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
.kanban__card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-3);
}
.kanban__prio {
  padding: 1px 5px;
  border-radius: 4px;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.kanban__prio--P0 { background: #e5484d; }
.kanban__prio--P1 { background: #e07b39; }
.kanban__prio--P2 { background: #5b8def; }
.kanban__due { font-variant-numeric: tabular-nums; }
.kanban__due--overdue { color: var(--danger); font-weight: 600; }
.kanban__progress {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--fill-1);
  font-variant-numeric: tabular-nums;
}
.kanban__progressbar {
  width: 100%;
  height: 4px;
  margin-top: 2px;
  border-radius: 999px;
  background: var(--fill-2);
  overflow: hidden;
}
.kanban__progressbar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 180ms var(--ease);
}
.kanban__count--over { color: var(--danger); font-weight: 700; }

/* Task detail drawer — modal scrim, closing saves. */
.kanban__detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.28);
}
.kanban__detail {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 360px;
  max-width: 100%;
  height: 100%;
  background: var(--bg);
  border-left: var(--bd-hair);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.16);
}
.kanban__detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: var(--bd-hair);
}
.kanban__detail-title { margin: 0; font-size: 15px; }
.kanban__detail-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px;
  overflow: auto;
}
.kanban__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-2);
}
.kanban__field-row { display: flex; gap: 12px; }
.kanban__field-row .kanban__field { flex: 1; min-width: 0; }
.kanban__field--check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.kanban__due-row { display: flex; align-items: center; gap: 8px; }
.kanban__detail-hint { margin: 0; font-size: 11px; color: var(--text-3); }
.kanban__check-row { display: flex; align-items: center; gap: 6px; }
.kanban__detail-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: var(--bd-hair);
}
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
