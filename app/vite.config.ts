import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// `@vscode/markdown-it-katex` does a top-level `require("katex")` even though
// we hand it KaTeX through `options.katex` (lib/markdown.ts), and that one
// require would pull the whole typesetter back into the entry chunk. Give that
// importer — only that one — an empty module; everything else gets the real
// KaTeX, loaded on demand by lib/render-deps.ts. Build-only: the dev server
// pre-bundles the plugin with esbuild and never asks us.
const KATEX_STUB = '\0solomd-katex-stub';
const katexPluginStub: Plugin = {
  name: 'solomd-katex-plugin-stub',
  apply: 'build',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === 'katex' && importer && /[\\/]@vscode[\\/]markdown-it-katex[\\/]/.test(importer)) {
      return KATEX_STUB;
    }
    return null;
  },
  load(id) {
    return id === KATEX_STUB ? 'export default null;' : null;
  },
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [katexPluginStub, vue()],

  // Excalidraw reads process.env.IS_PREACT at runtime; Vite strips process
  // otherwise. We use the React build, so false (not "true").
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  optimizeDeps: {
    esbuildOptions: {
      // Excalidraw ships locale modules with arbitrary module namespace
      // identifiers (export { english as "en-us" }), which needs ES2022.
      target: 'es2022',
      treeShaking: true,
    },
  },
  build: {
    target: 'es2022',
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
