# ClearFrame PWA

## Development

```powershell
npm install
npm run dev
```

Production output is written to `dist/` with `npm run build`.

## Vercel deployment

1. Import this repository into Vercel.
2. Select the Node 24 runtime (also declared in `.nvmrc` and `package.json`).
3. Deploy with the default build command, `npm run build`.

`vercel.json` configures `dist/` as the static output, caches immutable build
and neural assets, and enables cross-origin isolation for the high-performance
WebAssembly route. No environment variables, server functions, database, or
media upload bucket are required: files remain in the browser.

## Processing behavior

DeepFilterNet3 is bundled into the build as a self-contained WASM asset. The
worker never falls back to the prior FFT algorithm: a failed model initialization
is surfaced to the user rather than producing lower-quality output.

The browser-side pipeline accepts MP4, M4A, and WAV up to 500 MB. FFmpeg.wasm
extracts 48 kHz mono PCM, the DeepFilterNet worker processes it in fixed-size
frames, and FFmpeg.wasm emits a single AAC encode. MP4 video packets are copied
without re-encoding. WAV exports remain lossless.

After neural cleanup, a peak-safe 5 dB makeup-gain stage restores the program
level used by the benchmark without clipping already-loud recordings.

The 500 MB limit is intentional: the current FFmpeg.wasm file-system adapter
needs encoded and decoded audio in browser memory. It is a production safety
limit, not an upload limit—media is never sent to Vercel. A future streaming
WebCodecs/OPFS exporter can raise it without changing the neural model.
