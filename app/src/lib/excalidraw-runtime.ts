/**
 * React-in-Vue mount adapter for the official Excalidraw component.
 *
 * Excalidraw is React-only; Vue never imports it directly. The whole React +
 * Excalidraw stack is dynamically imported here so the rest of the app starts
 * without paying for it, and the view only sees the small handle below.
 */
import type { ExcalidrawScene } from './excalidraw-file';

export interface MountExcalidrawOptions {
  initialScene: ExcalidrawScene;
  dark: boolean;
  langCode?: string;
  onChange: (scene: ExcalidrawScene) => void;
}

export interface ExcalidrawHandle {
  setTheme(dark: boolean): void;
  destroy(): void;
}

interface Runtime {
  React: any;
  createRoot: (el: Element) => { render(node: unknown): void; unmount(): void };
  Excalidraw: any;
}

let runtimePromise: Promise<Runtime> | null = null;

async function loadRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      // Self-hosted fonts/locales copied from the package into public/.
      (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/';
      const React = await import('react');
      const { createRoot } = await import('react-dom/client');
      const mod: any = await import('@excalidraw/excalidraw');
      await import('@excalidraw/excalidraw/index.css');
      return {
        React: (React as any).default ?? React,
        createRoot,
        Excalidraw: mod.Excalidraw,
      };
    })();
  }
  return runtimePromise;
}

export async function mountExcalidraw(
  el: HTMLElement,
  opts: MountExcalidrawOptions,
): Promise<ExcalidrawHandle> {
  const { React, createRoot, Excalidraw } = await loadRuntime();
  const initial = opts.initialScene;

  function onChange(elements: unknown[], appState: unknown, files: unknown) {
    opts.onChange({
      type: 'excalidraw',
      version: 2,
      source: 'solomd',
      elements: Array.isArray(elements) ? elements : [],
      appState:
        appState && typeof appState === 'object'
          ? (appState as Record<string, unknown>)
          : {},
      files:
        files && typeof files === 'object' ? (files as Record<string, unknown>) : {},
    });
  }

  function App(props: { theme: 'light' | 'dark' }) {
    return React.createElement(Excalidraw, {
      initialData: {
        elements: initial.elements,
        appState: initial.appState,
        files: initial.files,
        scrollToContent: true,
      },
      theme: props.theme,
      langCode: opts.langCode,
      onChange,
    });
  }

  const root = createRoot(el);
  const render = (dark: boolean) =>
    root.render(React.createElement(App, { theme: dark ? 'dark' : 'light' }));
  render(opts.dark);

  return {
    setTheme(dark: boolean) {
      render(dark);
    },
    destroy() {
      try {
        root.unmount();
      } catch {
        /* already unmounted */
      }
      el.innerHTML = '';
    },
  };
}
