import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const assets = [
  ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'public/ffmpeg/ffmpeg-core.js'],
  ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'public/ffmpeg/ffmpeg-core.wasm'],
];
for (const [, target] of assets) await mkdir(dirname(resolve(target)), { recursive: true });
for (const [source, target] of assets) await cp(resolve(source), resolve(target));
