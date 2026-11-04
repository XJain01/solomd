import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawingTitle,
  emptyExcalidrawScene,
  parseExcalidrawScene,
  safeDrawingFileName,
  serializeExcalidrawScene,
} from './excalidraw-file.ts';

test('a broken or non-scene file falls back to an empty scene', () => {
  assert.deepEqual(parseExcalidrawScene('not json').elements, []);
  assert.deepEqual(parseExcalidrawScene('{}').appState, {});
  assert.deepEqual(parseExcalidrawScene('{"elements":"nope"}').elements, []);
});

test('a real scene keeps its elements, appState, files, and extra keys', () => {
  const scene = parseExcalidrawScene(
    JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: [{ id: 'r1', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#fff' },
      files: { f1: { id: 'f1' } },
      custom: 'kept',
    }),
  );
  assert.equal(scene.elements.length, 1);
  assert.equal(scene.appState.viewBackgroundColor, '#fff');
  assert.equal(scene.files.f1 !== undefined, true);
  assert.equal((scene as unknown as { custom: string }).custom, 'kept');
});

test('serialization round-trips and ends with a newline', () => {
  const scene = emptyExcalidrawScene();
  scene.elements.push({ id: 'a', type: 'ellipse' });
  const text = serializeExcalidrawScene(scene);
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(parseExcalidrawScene(text).elements, scene.elements);
});

test('drawing file names are titled, safe, and collision-free', () => {
  assert.equal(drawingTitle('Work.excalidraw'), 'Work');
  const taken = new Set<string>();
  assert.equal(safeDrawingFileName('Work', taken), 'Work.excalidraw');
  assert.equal(safeDrawingFileName('Work', taken), 'Work-2.excalidraw');
  assert.equal(safeDrawingFileName('a/b:c', taken), 'a-b-c.excalidraw');
  assert.equal(safeDrawingFileName('  ', taken), 'drawing.excalidraw');
});
