import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExcalidrawMarkdown,
  parseExcalidrawMarkdown,
  serializeExcalidrawMarkdown,
} from './excalidraw-markdown.ts';
import { emptyExcalidrawScene } from './excalidraw-file.ts';

test('writes the Obsidian plugin frontmatter and compressed drawing block', () => {
  const scene = emptyExcalidrawScene();
  scene.elements.push({ id: 'r1', type: 'rectangle', x: 10, y: 20 });
  const md = serializeExcalidrawMarkdown(scene);
  assert.match(md, /^---\nexcalidraw-plugin: parsed\n/);
  assert.match(md, /# Excalidraw Data/);
  assert.match(md, /## Drawing/);
  assert.match(md, /```compressed-json\n/);
  assert.match(md, /```\n%%\n$/);
  assert.equal(isExcalidrawMarkdown(md), true);
});

test('round-trips elements through the compressed block', () => {
  const scene = emptyExcalidrawScene();
  scene.elements.push({ id: 'r1', type: 'rectangle', x: 10, y: 20 });
  scene.appState = { viewBackgroundColor: '#ffffff' };
  const parsed = parseExcalidrawMarkdown(serializeExcalidrawMarkdown(scene));
  assert.deepEqual(parsed.elements, scene.elements);
  assert.equal(parsed.appState.viewBackgroundColor, '#ffffff');
});

test('reads an uncompressed json block written by the plugin', () => {
  const md = `---
excalidraw-plugin: parsed
---
# Excalidraw Data
## Drawing
\`\`\`json
{"type":"excalidraw","version":2,"elements":[{"id":"a","type":"ellipse"}],"appState":{},"files":{}}
\`\`\`
%%
`;
  const parsed = parseExcalidrawMarkdown(md);
  assert.equal(parsed.elements.length, 1);
  assert.equal((parsed.elements[0] as { type: string }).type, 'ellipse');
});

test('a broken or empty markdown file degrades to an empty scene', () => {
  assert.deepEqual(parseExcalidrawMarkdown('not a drawing').elements, []);
  assert.deepEqual(parseExcalidrawMarkdown('').elements, []);
  assert.equal(isExcalidrawMarkdown('plain note'), false);
});
