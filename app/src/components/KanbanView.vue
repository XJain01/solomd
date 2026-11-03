<script setup lang="ts">
/**
 * Center-pane kanban. Notes are cards grouped by frontmatter `status`
 * (or `state` / `stage` / `phase` when that's the key already on the note).
 * Dragging a card to another column writes that field back.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import Icons from './Icons.vue';
import '../styles/panels.css';
import { useI18n } from '../i18n';
import { useFiles } from '../composables/useFiles';
import { useTabsStore } from '../stores/tabs';
import { useToastsStore } from '../stores/toasts';
import { useWorkspaceIndexStore, type IndexEntry } from '../stores/workspaceIndex';
import { useWorkspaceStore } from '../stores/workspace';
import { noteOwnWrite } from '../lib/external-change';
import {
  UNSORTED_COLUMN,
  columnForNote,
  kanbanColumns,
  moveNoteStatus,
  type KanbanColumn,
} from '../lib/kanban';
import { KANBAN_CLOSE_EVENT } from '../composables/useKanbanView';

const { t } = useI18n();
const files = useFiles();
const tabs = useTabsStore();
const toasts = useToastsStore();
const idx = useWorkspaceIndexStore();
const workspace = useWorkspaceStore();

const notes = computed(() =>
  idx.entries.filter((e) => {
    if (/[/\\]\.solomd[/\\]/.test(e.path)) return false;
    return /\.(md|markdown|mdown|mkd)$/i.test(e.name);
  }),
);

const columns = computed(() => kanbanColumns(notes.value));

function cardsIn(col: KanbanColumn): IndexEntry[] {
  return notes.value.filter((n) => columnForNote(n, columns.value) === col.id);
}

function columnLabel(col: KanbanColumn): string {
  if (col.id === UNSORTED_COLUMN) return t('kanban.unsorted');
  if (col.id === 'todo') return t('kanban.todo');
  if (col.id === 'doing') return t('kanban.doing');
  if (col.id === 'done') return t('kanban.done');
  return col.writeValue ?? col.id;
}

function titleFor(entry: IndexEntry): string {
  return entry.title || entry.stem || entry.name;
}

function close() {
  window.dispatchEvent(new CustomEvent(KANBAN_CLOSE_EVENT));
}

async function openCard(entry: IndexEntry) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  await files.openPath(entry.path, { bypassNewWindow: true });
  close();
}

const dragging = ref<{ path: string } | null>(null);
const overCol = ref<string | null>(null);
let suppressClick = false;
let dragStart: { x: number; y: number; path: string; moved: boolean } | null = null;

function columnAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  const col = el?.closest<HTMLElement>('[data-kanban-col]');
  return col?.dataset.kanbanCol ?? null;
}

function onCardPointerDown(e: PointerEvent, path: string) {
  if (e.button !== 0) return;
  dragStart = { x: e.clientX, y: e.clientY, path, moved: false };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e: PointerEvent) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (!dragStart.moved && dx * dx + dy * dy < 36) return;
  dragStart.moved = true;
  dragging.value = { path: dragStart.path };
  overCol.value = columnAt(e.clientX, e.clientY);
}

async function onPointerUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  const start = dragStart;
  dragStart = null;
  const path = start?.path;
  if (start?.moved) {
    suppressClick = true;
    queueMicrotask(() => { suppressClick = false; });
  }
  const target = start?.moved ? columnAt(e.clientX, e.clientY) : null;
  dragging.value = null;
  overCol.value = null;
  if (!start?.moved || !path || !target) return;
  const entry = notes.value.find((n) => n.path === path);
  const col = columns.value.find((c) => c.id === target);
  if (!entry || !col) return;
  if (columnForNote(entry, columns.value) === col.id) return;
  await moveCard(entry, col);
}

async function moveCard(entry: IndexEntry, col: KanbanColumn) {
  const prev = entry.frontmatter ? { ...entry.frontmatter } : null;
  applyOptimistic(entry, col);
  try {
    const open = tabs.tabs.find((tab) => tab.filePath === entry.path);
    if (open) {
      const next = moveNoteStatus(open.content || '', col);
      tabs.setContent(open.id, next);
      const ok = await files.saveTab(open, { silent: true });
      if (!ok) throw new Error('save failed');
      return;
    }
    const read = await invoke<{ content: string; encoding?: string }>('read_file', { path: entry.path });
    const next = moveNoteStatus(read.content, col);
    const payload = next;
    noteOwnWrite(entry.path, payload);
    await invoke('write_file', {
      path: entry.path,
      content: payload,
      encoding: read.encoding || 'UTF-8',
      workspace: workspace.currentFolder ?? undefined,
    });
    window.dispatchEvent(new CustomEvent('solomd:saved', { detail: { filePath: entry.path } }));
  } catch (e) {
    entry.frontmatter = prev;
    toasts.error(t('kanban.moveFailed', { error: String(e) }));
  }
}

function applyOptimistic(entry: IndexEntry, col: KanbanColumn) {
  const fm: Record<string, unknown> = { ...(entry.frontmatter ?? {}) };
  const existing = Object.keys(fm).find((k) => /^(status|state|stage|phase)$/i.test(k));
  const key = existing ?? 'status';
  if (col.writeValue == null) delete fm[key];
  else fm[key] = col.writeValue;
  entry.frontmatter = Object.keys(fm).length ? fm : null;
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
      <span class="pg-subtitle">{{ notes.length }}</span>
      <span class="pg-spacer" />
      <span class="kanban__hint">{{ t('kanban.hint') }}</span>
    </header>

    <div v-if="notes.length === 0" class="kanban__empty">
      <p class="kanban__empty-title">{{ t('kanban.emptyTitle') }}</p>
      <p class="kanban__empty-body">{{ t('kanban.emptyBody') }}</p>
    </div>

    <div v-else class="kanban__board pg-body" role="list">
      <section
        v-for="col in columns"
        :key="col.id"
        class="kanban__col"
        :class="{ 'kanban__col--over': overCol === col.id }"
        :data-kanban-col="col.id"
        role="list"
        :aria-label="columnLabel(col)"
      >
        <header class="kanban__col-head">
          <span>{{ columnLabel(col) }}</span>
          <span class="kanban__count">{{ cardsIn(col).length }}</span>
        </header>
        <div class="kanban__cards">
          <button
            v-for="card in cardsIn(col)"
            :key="card.path"
            type="button"
            class="kanban__card"
            :class="{ 'kanban__card--dragging': dragging?.path === card.path }"
            @pointerdown="onCardPointerDown($event, card.path)"
            @click="openCard(card)"
          >
            <span class="kanban__card-title">{{ titleFor(card) }}</span>
            <span class="kanban__card-path">{{ card.name }}</span>
          </button>
          <p v-if="cardsIn(col).length === 0" class="kanban__drop">{{ t('kanban.dropHere') }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.kanban__hint {
  font-size: 12px;
  color: var(--text-3);
  max-width: 420px;
}
.kanban__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
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
  max-width: 420px;
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
  min-width: 200px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  min-height: 240px;
  border: var(--bd-hair);
  border-radius: var(--r-lg);
  background: var(--fill-1);
}
.kanban__col--over {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.kanban__col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}
.kanban__count {
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
  font-weight: 500;
}
.kanban__cards {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 10px;
  min-height: 80px;
}
.kanban__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: var(--bd-hair);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: grab;
  touch-action: none;
}
.kanban__card:hover {
  background: var(--bg-elev, var(--bg));
}
.kanban__card--dragging {
  opacity: 0.45;
}
.kanban__card-title {
  font-weight: 560;
  line-height: 1.4;
}
.kanban__card-path {
  font-size: 11px;
  color: var(--text-3);
}
.kanban__drop {
  margin: 8px 4px;
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
}
</style>
