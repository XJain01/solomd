<script setup lang="ts">
/**
 * 手绘画板 — full-page Excalidraw canvas backed by `.excalidraw` files in
 * `<workspace>/drawings/`. The React component is mounted through the
 * dynamic-import adapter; Vue only owns the shell and file lifecycle.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import '../styles/panels.css';
import Icons from './Icons.vue';
import { useI18n } from '../i18n';
import { useSettingsStore } from '../stores/settings';
import { useWorkspaceStore } from '../stores/workspace';
import {
  drawingTitle,
  emptyExcalidrawScene,
  parseExcalidrawScene,
  safeDrawingFileName,
  serializeExcalidrawScene,
  type ExcalidrawScene,
} from '../lib/excalidraw-file';
import { mountExcalidraw, type ExcalidrawHandle } from '../lib/excalidraw-runtime';
import { DRAWING_CLOSE_EVENT } from '../composables/useDrawingView';

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface DrawingFile {
  name: string;
  path: string;
}

const LANG_CODE: Record<string, string> = {
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-BR',
  it: 'it-IT',
  ru: 'ru-RU',
  pl: 'pl-PL',
  nl: 'nl-NL',
  tr: 'tr-TR',
  sv: 'sv-SE',
  uk: 'uk-UA',
};

const { t } = useI18n();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();

const drawings = ref<DrawingFile[]>([]);
const activePath = ref<string | null>(null);
const activeTitle = ref('');
const loading = ref(false);
const lastError = ref<string | null>(null);
const creating = ref(false);
const nameDraft = ref('');
const canvasEl = ref<HTMLDivElement | null>(null);

let handle: ExcalidrawHandle | null = null;
let mountToken = 0;
let saveTimer = 0;
let pendingScene: ExcalidrawScene | null = null;

const hasFolder = computed(() => !!workspace.currentFolder);

function joinPath(folder: string, ...parts: string[]): string {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return [folder.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

function drawingsDir(): string {
  return joinPath(workspace.currentFolder || '', 'drawings');
}

async function ensureDir(): Promise<string> {
  const dir = drawingsDir();
  try {
    await invoke('fs_create_dir', { path: dir });
  } catch (err) {
    if (!String(err).includes('already exists')) throw err;
  }
  return dir;
}

async function listDrawings(): Promise<DrawingFile[]> {
  if (!workspace.currentFolder) return [];
  await ensureDir();
  const entries = await invoke<DirEntry[]>('list_dir', { path: drawingsDir() });
  return entries
    .filter((entry) => !entry.is_dir && /\.excalidraw$/i.test(entry.name) && entry.path)
    .map((entry) => ({ name: entry.name, path: entry.path }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function close() {
  window.dispatchEvent(new CustomEvent(DRAWING_CLOSE_EVENT));
}

async function saveNow() {
  const path = activePath.value;
  const scene = pendingScene;
  pendingScene = null;
  if (!path || !scene) return;
  try {
    await invoke('write_file', {
      path,
      content: serializeExcalidrawScene(scene),
      encoding: 'UTF-8',
    });
  } catch (err) {
    lastError.value = String(err);
  }
}

function flush() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
  }
  void saveNow();
}

function scheduleSave(scene: ExcalidrawScene) {
  pendingScene = scene;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = 0;
    void saveNow();
  }, 500);
}

async function mountActive(scene: ExcalidrawScene) {
  const token = ++mountToken;
  handle?.destroy();
  handle = null;
  await nextTick();
  if (token !== mountToken || !canvasEl.value) return;
  const mounted = await mountExcalidraw(canvasEl.value, {
    initialScene: scene,
    dark: settings.theme === 'dark',
    langCode: LANG_CODE[settings.language] || 'en',
    onChange: scheduleSave,
  });
  if (token !== mountToken) {
    mounted.destroy();
    return;
  }
  handle = mounted;
}

async function selectDrawing(path: string) {
  if (path === activePath.value && handle) return;
  flush();
  handle?.destroy();
  handle = null;
  activePath.value = path;
  activeTitle.value = drawingTitle(path.split(/[\\/]/).pop() || path);
  loading.value = true;
  lastError.value = null;
  try {
    const res = await invoke<{ content: string }>('read_file', { path });
    await mountActive(parseExcalidrawScene(res.content));
  } catch (err) {
    lastError.value = String(err);
  } finally {
    loading.value = false;
  }
}

async function refresh() {
  if (!hasFolder.value) {
    drawings.value = [];
    activePath.value = null;
    handle?.destroy();
    handle = null;
    return;
  }
  try {
    drawings.value = await listDrawings();
    if (activePath.value && !drawings.value.some((d) => d.path === activePath.value)) {
      activePath.value = null;
      handle?.destroy();
      handle = null;
    }
    if (!activePath.value && drawings.value[0]) {
      await selectDrawing(drawings.value[0].path);
    }
  } catch (err) {
    lastError.value = String(err);
  }
}

function startCreate() {
  creating.value = true;
  nameDraft.value = '';
}

async function commitCreate() {
  const folder = workspace.currentFolder;
  const name = nameDraft.value.trim();
  if (!folder || !name) return;
  try {
    const dir = await ensureDir();
    const taken = new Set(drawings.value.map((d) => d.name.toLowerCase()));
    const fileName = safeDrawingFileName(name, taken);
    const path = joinPath(dir, fileName);
    await invoke('write_file', {
      path,
      content: serializeExcalidrawScene(emptyExcalidrawScene()),
      encoding: 'UTF-8',
    });
    creating.value = false;
    drawings.value = await listDrawings();
    await selectDrawing(path);
  } catch (err) {
    lastError.value = String(err);
  }
}

async function removeDrawing() {
  const path = activePath.value;
  if (!path) return;
  if (!window.confirm(t('drawing.confirmDelete'))) return;
  try {
    flush();
    await invoke('fs_delete', { path });
    handle?.destroy();
    handle = null;
    activePath.value = null;
    drawings.value = await listDrawings();
    if (drawings.value[0]) await selectDrawing(drawings.value[0].path);
  } catch (err) {
    lastError.value = String(err);
  }
}

onMounted(refresh);
watch(() => workspace.currentFolder, refresh);
watch(
  () => settings.theme,
  () => handle?.setTheme(settings.theme === 'dark'),
);

onBeforeUnmount(() => {
  flush();
  handle?.destroy();
  handle = null;
});
</script>

<template>
  <div class="drawing pg">
    <header class="pg-head">
      <button class="pg-icon-btn" type="button" :title="t('drawing.back')" :aria-label="t('drawing.back')" @click="close">
        <Icons name="chevron-left" :size="18" />
      </button>
      <h1 class="pg-title">{{ t('drawing.heading') }}</h1>
      <span v-if="drawings.length" class="drawing__picker">
        <select
          class="kanban__select"
          :value="activePath || ''"
          :aria-label="t('drawing.heading')"
          @change="selectDrawing(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="file in drawings" :key="file.path" :value="file.path">
            {{ drawingTitle(file.name) }}
          </option>
        </select>
      </span>
      <span class="pg-spacer" />
      <span class="drawing__actions">
        <button v-if="activePath" class="rp-btn" type="button" @click="removeDrawing">
          {{ t('drawing.delete') }}
        </button>
        <button class="rp-btn" type="button" @click="startCreate">{{ t('drawing.new') }}</button>
      </span>
    </header>

    <form v-if="creating" class="drawing__create" @submit.prevent="commitCreate">
      <input
        v-model="nameDraft"
        class="kanban__input"
        type="text"
        :placeholder="t('drawing.namePlaceholder')"
        autofocus
      />
      <button class="rp-btn" type="submit">{{ t('drawing.save') }}</button>
      <button class="rp-btn" type="button" @click="creating = false">{{ t('drawing.cancel') }}</button>
    </form>

    <p v-if="lastError" class="drawing__error">{{ lastError }}</p>

    <div v-if="!hasFolder" class="drawing__empty">
      <p>{{ t('drawing.noFolder') }}</p>
    </div>
    <div v-else-if="!activePath && !creating" class="drawing__empty">
      <p class="drawing__empty-title">{{ t('drawing.emptyTitle') }}</p>
      <p class="drawing__empty-body">{{ t('drawing.emptyBody') }}</p>
      <button class="rp-btn" type="button" @click="startCreate">{{ t('drawing.new') }}</button>
    </div>
    <div v-else class="drawing__canvas-wrap">
      <div ref="canvasEl" class="drawing__canvas" />
      <p v-if="loading" class="drawing__loading">{{ t('drawing.loading') }}</p>
      <p class="drawing__title">{{ activeTitle }}</p>
    </div>
  </div>
</template>

<style scoped>
.drawing {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.drawing__picker { min-width: 0; }
.drawing__actions { display: inline-flex; gap: 6px; }
.drawing__create {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 0;
}
.drawing__error {
  margin: 0;
  padding: 6px 16px;
  color: var(--danger);
  font-size: 12px;
}
.drawing__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
}
.drawing__empty-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); }
.drawing__empty-body { margin: 0; max-width: 460px; line-height: 1.6; text-align: center; }
.drawing__canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 8px 12px 12px;
}
.drawing__canvas {
  width: 100%;
  height: 100%;
  border: var(--bd-hair);
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--bg);
}
.drawing__canvas :deep(.excalidraw) { height: 100%; }
.drawing__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--text-3);
}
.drawing__title {
  position: absolute;
  left: 24px;
  bottom: 20px;
  margin: 0;
  padding: 2px 6px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--bg) 80%, transparent);
  color: var(--text-3);
  font-size: 11px;
  pointer-events: none;
}
</style>
