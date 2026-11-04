/**
 * `.excalidraw` scene files: the official Excalidraw JSON envelope, stored one
 * file per drawing under `<workspace>/drawings/`.
 */
export interface ExcalidrawScene {
  type: 'excalidraw';
  version: number;
  source?: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export function emptyExcalidrawScene(): ExcalidrawScene {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'solomd',
    elements: [],
    appState: {},
    files: {},
  };
}

/** Accepts a real `.excalidraw` file or a damaged one; never throws. */
export function parseExcalidrawScene(text: string): ExcalidrawScene {
  try {
    const raw = JSON.parse(text) as Partial<ExcalidrawScene> | null;
    if (!raw || typeof raw !== 'object') return emptyExcalidrawScene();
    return {
      ...raw,
      type: 'excalidraw',
      version: typeof raw.version === 'number' ? raw.version : 2,
      source: typeof raw.source === 'string' ? raw.source : 'solomd',
      elements: Array.isArray(raw.elements) ? raw.elements : [],
      appState:
        raw.appState && typeof raw.appState === 'object'
          ? (raw.appState as Record<string, unknown>)
          : {},
      files:
        raw.files && typeof raw.files === 'object'
          ? (raw.files as Record<string, unknown>)
          : {},
    };
  } catch {
    return emptyExcalidrawScene();
  }
}

export function serializeExcalidrawScene(scene: ExcalidrawScene): string {
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: scene.version || 2,
      source: scene.source || 'solomd',
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files,
    },
    null,
    2,
  ) + '\n';
}

export function drawingTitle(fileName: string): string {
  return fileName.replace(/\.excalidraw(\.md)?$/i, '');
}

export type DrawingFormat = 'markdown' | 'json';

/** `.excalidraw.md` is the Obsidian plugin format; legacy `.excalidraw` is JSON. */
export function drawingFormat(filePath: string): DrawingFormat {
  return /\.excalidraw\.md$/i.test(filePath) ? 'markdown' : 'json';
}

const INVALID = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Filesystem-safe, collision-free `<name>.excalidraw.md`. `taken` is mutated. */
export function safeDrawingFileName(name: string, taken: Set<string>): string {
  let base = name
    .trim()
    .replace(INVALID, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  if (!base) base = 'drawing';
  let candidate = `${base}.excalidraw.md`;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${n}.excalidraw.md`;
    n++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
