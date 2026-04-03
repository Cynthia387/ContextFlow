'use strict';

/**
 * CommonJS entry only uses Node builtins — never loads esbuild before npm install.
 * Then spawns build.impl.mjs (ESM + esbuild).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const marker = path.join(root, 'node_modules', 'esbuild', 'package.json');

if (!fs.existsSync(marker)) {
  console.log('[ContextFlow] Installing dependencies (first run)...');
  const inst = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (inst.status !== 0) {
    process.exit(inst.status ?? 1);
  }
}

const args = process.argv.slice(2);
const impl = path.join(root, 'build.impl.mjs');
const run = spawnSync(process.execPath, [impl, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
process.exit(run.status === null ? 1 : run.status);
