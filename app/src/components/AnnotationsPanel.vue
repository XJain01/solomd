<script setup lang="ts">
/**
 * Right-sidebar list of `==highlight==` and `==highlight==^{note}` in the
 * open Markdown note. A click jumps the editor to that line.
 */
import { computed } from 'vue';
import PanelHeader from './panel/PanelHeader.vue';
import { useI18n } from '../i18n';
import { useTabsStore } from '../stores/tabs';
import { useTilesStore } from '../stores/tiles';
import { parseAnnotations } from '../lib/annotations';
import '../styles/panels.css';

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const tabs = useTabsStore();
const tiles = useTilesStore();

const items = computed(() => {
  const tab = tabs.activeTab;
  if (!tab || tab.language !== 'markdown') return [];
  return parseAnnotations(tab.content || '');
});

function jump(line: number) {
  window.dispatchEvent(
    new CustomEvent('solomd:outline-goto', {
      detail: { line, paneId: tiles.focusedPaneId },
    }),
  );
}
</script>

<template>
  <div class="ann-panel rp">
    <PanelHeader :title="t('annotations.heading')" :count="items.length || null" @close="emit('close')" />
    <p v-if="!tabs.activeTab || tabs.activeTab.language !== 'markdown'" class="rp-empty">
      {{ t('annotations.noNote') }}
    </p>
    <p v-else-if="items.length === 0" class="rp-empty">{{ t('annotations.empty') }}</p>
    <ul v-else class="ann-panel__list">
      <li v-for="(item, i) in items" :key="item.from + ':' + i">
        <button type="button" class="ann-panel__row" @click="jump(item.line)">
          <span class="ann-panel__text">{{ item.text }}</span>
          <span v-if="item.comment" class="ann-panel__note">{{ item.comment }}</span>
          <span class="ann-panel__line">{{ item.line }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ann-panel__list {
  list-style: none;
  margin: 0;
  padding: 0 8px 12px;
  overflow: auto;
  min-height: 0;
  flex: 1 1 auto;
}
.ann-panel__row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  margin: 0 0 4px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ann-panel__row:hover {
  background: var(--fill-1);
}
.ann-panel__text {
  background: color-mix(in srgb, var(--accent) 24%, transparent);
  border-radius: 2px;
  padding: 0 0.2em;
  line-height: 1.5;
}
.ann-panel__note {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.45;
}
.ann-panel__line {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
</style>
