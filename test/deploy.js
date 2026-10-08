import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = value => spawnSync(process.execPath, ['scripts/build-vercel.mjs'], {
  cwd: root, env: { ...process.env, PUBLIC_WS_URL: value }, encoding: 'utf8',
});
for (const value of ['', 'invalid', 'https://example.com', 'ws://example.com', 'wss://user:password@example.com', 'wss://example.com/#fragment']) {
  const result = build(value);
  assert.notEqual(result.status, 0, 'reject invalid or insecure endpoint');
  assert.match(result.stderr, /PUBLIC_WS_URL/);
}
const endpoint = 'wss://example.com/socket?room=public';
const result = build(endpoint);
assert.equal(result.status, 0, result.stderr);
const output = path.join(root, 'public');
assert.deepEqual(fs.readdirSync(output).sort(), ['config.js', 'icons.svg', 'index.html', 'main.js', 'shared', 'style.css']);
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(output, 'config.js'), 'utf8'), context);
assert.equal(context.window.CFG.wsUrl, endpoint);
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
for (const [, asset] of html.matchAll(/(?:src|href)="\/([^"#]+)(?:#[^"]*)?"/g)) {
  assert.ok(fs.existsSync(path.join(output, asset)), `published asset exists: ${asset}`);
}
assert.equal(fs.readFileSync(path.join(output, 'shared/game.js'), 'utf8'), fs.readFileSync(path.join(root, 'shared/game.js'), 'utf8'));
// Rebuilding must discard stale output, and invalid settings must preserve the last build.
fs.writeFileSync(path.join(output, 'stale.txt'), 'stale');
assert.equal(build(endpoint).status, 0);
assert.ok(!fs.existsSync(path.join(output, 'stale.txt')));
assert.notEqual(build('').status, 0);
assert.ok(fs.existsSync(path.join(output, 'index.html')));
console.log('PASS Vercel endpoint validation, generated config, assets, shared code and clean rebuild');
