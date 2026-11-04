/**
 * Obsidian Excalidraw plugin format (`.excalidraw.md`).
 *
 * The plugin stores the standard Excalidraw JSON inside a `## Drawing` section
 * as either a ```json block or an LZ-String base64 ```compressed-json block,
 * surrounded by the plugin's frontmatter and `%%` markers. This module reads
 * both and writes the compressed form the plugin produces by default.
 */
import LZString from 'lz-string';
import {
  emptyExcalidrawScene,
  parseExcalidrawScene,
  serializeExcalidrawScene,
  type ExcalidrawScene,
} from './excalidraw-file';

const COMPRESSED_BLOCK = /```compressed-json\r?\n([\s\S]*?)```/;
const JSON_BLOCK = /```json\r?\n([\s\S]*?)```/;

export function isExcalidrawMarkdown(text: string): boolean {
  return /excalidraw-plugin\s*:/i.test(text) && /##?\s*Drawing/i.test(text);
}

export function parseExcalidrawMarkdown(text: string): ExcalidrawScene {
  const compressed = COMPRESSED_BLOCK.exec(text);
  if (compressed) {
    try {
      const cleaned = compressed[1].replace(/[\r\n]/g, '');
      const json = LZString.decompressFromBase64(cleaned);
      if (json) return parseExcalidrawScene(json);
    } catch {
      /* fall through to the uncompressed block */
    }
  }
  const plain = JSON_BLOCK.exec(text);
  if (plain) return parseExcalidrawScene(plain[1]);
  return emptyExcalidrawScene();
}

/** LZ-String base64, chunked every 256 chars exactly like the plugin. */
function compressScene(json: string): string {
  const compressed = LZString.compressToBase64(json);
  const chunks: string[] = [];
  for (let i = 0; i < compressed.length; i += 256) {
    chunks.push(compressed.slice(i, i + 256));
  }
  return chunks.join('\n\n');
}

export function serializeExcalidrawMarkdown(scene: ExcalidrawScene): string {
  const json = serializeExcalidrawScene(scene).trimEnd();
  const body = compressScene(json);
  return [
    '---',
    'excalidraw-plugin: parsed',
    'tags: [excalidraw]',
    '---',
    '',
    '==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==',
    '',
    '# Excalidraw Data',
    '',
    '## Text Elements',
    '%%',
    '## Drawing',
    '```compressed-json',
    body,
    '```',
    '%%',
    '',
  ].join('\n');
}
