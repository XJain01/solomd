/**
 * Copy Excalidraw's self-hosted fonts + locale chunks into `public/`.
 *
 * They are generated from node_modules (not committed) so the repo does not
 * carry ~14 MB of binary font files. Run from `app/`; called by dev/build.
 */
import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod');
const target = path.resolve('public');

for (const name of ['fonts', 'locales']) {
  const from = path.join(source, name);
  const to = path.join(target, name);
  if (!fs.existsSync(from)) {
    console.warn(`[excalidraw] missing ${from}; skipping`);
    continue;
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}
