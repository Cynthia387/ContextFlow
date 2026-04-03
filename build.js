/**
 * Thin shim: forwards to build.cjs so `node build.js` never parses esbuild.
 * npm run build uses build.cjs directly (see package.json).
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [join(root, 'build.cjs'), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: false,
});
process.exit(r.status === null ? 1 : r.status);
