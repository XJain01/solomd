import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerById } from '../lib/ai-providers';

const storage = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};
g.window = {
  localStorage: g.localStorage,
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
};
const { createPinia, setActivePinia } = await import('pinia');
const { useSettingsStore } = await import('./settings');

test('loading MiniMax settings keeps explicit M3, legacy and custom models', () => {
  for (const model of ['MiniMax-M3', 'MiniMax-M2.7', 'my-custom-model', '']) {
    storage.set('solomd.settings.v1', JSON.stringify({ aiProvider: 'minimax', aiModel: model }));
    setActivePinia(createPinia());
    const settings = useSettingsStore();
    assert.equal(settings.aiModel, model);
    assert.equal(settings.aiProvider, 'minimax');
    assert.equal(settings.aiModel || providerById(settings.aiProvider)?.defaultModel,
      model || 'MiniMax-M3.1-Flash');
  }
});

test('an untouched 8-turn agent cap migrates to 20, an explicit choice does not', () => {
  storage.set('solomd.settings.v1', JSON.stringify({ agentToolLoopCap: 8 }));
  setActivePinia(createPinia());
  assert.equal(useSettingsStore().agentToolLoopCap, 20);

  storage.set(
    'solomd.settings.v1',
    JSON.stringify({ agentToolLoopCap: 6, agentToolLoopCapRaised: true }),
  );
  setActivePinia(createPinia());
  assert.equal(useSettingsStore().agentToolLoopCap, 6);
});

test('agent personas can be added, edited, selected, and removed', () => {
  storage.set('solomd.settings.v1', JSON.stringify({}));
  setActivePinia(createPinia());
  const settings = useSettingsStore();

  settings.addAgentPersona('Editor');
  assert.equal(settings.agentPersonas.length, 1);
  const id = settings.agentPersonas[0].id;
  assert.equal(settings.agentPersonas[0].name, 'Editor');

  settings.updateAgentPersona(id, { prompt: 'Be terse.' });
  assert.equal(settings.agentPersonas[0].prompt, 'Be terse.');

  settings.setAgentPersonaId(id);
  assert.equal(settings.agentPersonaId, id);

  settings.removeAgentPersona(id);
  assert.equal(settings.agentPersonas.length, 0);
  assert.equal(settings.agentPersonaId, '');
});
