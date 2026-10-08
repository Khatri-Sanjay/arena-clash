import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const rawUrl = process.env.PUBLIC_WS_URL?.trim();
let endpoint;
try {
  endpoint = new URL(rawUrl);
} catch {
  console.error('Set PUBLIC_WS_URL in Vercel to your multiplayer server URL, e.g. wss://arena-server.onrender.com');
  process.exit(1);
}
if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.hash) {
  console.error('PUBLIC_WS_URL must use wss:// and contain no credentials or fragment.');
  process.exit(1);
}

// This generated directory contains only browser assets, never server files or .env.
const output = path.resolve(root, 'public');
if (output !== path.join(root, 'public')) throw new Error('Unexpected build output path');
if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) {
  throw new Error('Build output must not be a symbolic link');
}
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'shared'), { recursive: true });
for (const asset of ['index.html', 'style.css', 'main.js', 'icons.svg']) {
  fs.copyFileSync(path.join(root, 'client', asset), path.join(output, asset));
}
fs.copyFileSync(path.join(root, 'shared/game.js'), path.join(output, 'shared/game.js'));
fs.writeFileSync(path.join(output, 'config.js'), `window.CFG=${JSON.stringify({ wsUrl: endpoint.href })};\n`);
console.log('Vercel UI built in public/. Multiplayer uses PUBLIC_WS_URL.');
