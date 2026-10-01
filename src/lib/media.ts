import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { preflightMedia } from './capabilities';

type Progress = (stage: string, value: number, message: string) => void;
const cancelled = () => new DOMException('Job cancelled', 'AbortError');
const check = (signal: AbortSignal) => { if (signal.aborted) throw cancelled(); };
const ownedBuffer = (bytes: Uint8Array) => { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); return copy.buffer; };

async function assetURL(path: string, type: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`Could not load local media engine (${response.status}).`);
  const blob = await response.blob();
  if (signal.aborted) throw cancelled();
  return URL.createObjectURL(new Blob([blob], { type }));
}

function wavSamples(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4));
    const length = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const start = view.byteOffset + offset + 8;
      if (length % 4 || start + length > view.byteOffset + view.byteLength) break;
      // FFmpeg may emit a header whose data chunk is not four-byte aligned.
      // Copy only in that case; aligned data can transfer to the neural worker.
      return start % 4
        ? new Float32Array(view.buffer.slice(start, start + length))
        : new Float32Array(view.buffer, start, length / 4);
    }
    offset += 8 + length + (length & 1);
  }
  throw new Error('The browser could not read the extracted audio stream.');
}

function wavFile(samples: Float32Array, rate = 48000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.byteLength), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.byteLength, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 32, true); text(36, 'data'); view.setUint32(40, samples.byteLength, true);
  bytes.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 44); return bytes;
}

function neural(samples: Float32Array, progress: (value: number) => void, signal: AbortSignal): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(cancelled()); return; }
    const worker = new Worker(new URL('../workers/neural.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { signal.removeEventListener('abort', onAbort); worker.terminate(); };
    const onAbort = () => { cleanup(); reject(cancelled()); };
    signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') progress(data.value);
      if (data.type === 'complete') { cleanup(); resolve(new Float32Array(data.samples)); }
      if (data.type === 'error') { cleanup(); reject(new Error(data.error)); }
    };
    worker.onerror = () => { cleanup(); reject(new Error('The neural worker stopped unexpectedly.')); };
    try {
      worker.postMessage({ samples: samples.buffer, offset: samples.byteOffset, length: samples.length }, [samples.buffer]);
    } catch (error) {
      cleanup(); reject(error);
    }
  });
}

function restoreProgramLevel(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const targetGain = 10 ** (5 / 20);
  const safeGain = peak > 0 ? Math.min(targetGain, 0.99 / peak) : 1;
  for (let i = 0; i < samples.length; i++) samples[i] *= safeGain;
  return samples;
}

export async function processMedia(file: File, report: Progress, signal: AbortSignal): Promise<File> {
  const ffmpeg = new FFmpeg();
  const urls: string[] = [];
  const onAbort = () => ffmpeg.terminate();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    report('checking', 2, 'Checking recording size and duration…');
    await preflightMedia(file, signal);
    check(signal);
    ffmpeg.on('log', ({ message }) => console.debug(`[ffmpeg] ${message}`));
    ffmpeg.on('progress', ({ progress }) => report('preparing', 8 + Math.round(progress * 17), 'Preparing audio locally…'));
    report('checking', 4, 'Loading local media engine…');
    const coreURL = await assetURL('/ffmpeg/ffmpeg-core.js', 'text/javascript', signal); urls.push(coreURL);
    check(signal);
    const wasmURL = await assetURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm', signal); urls.push(wasmURL);
    check(signal);
    await ffmpeg.load({ coreURL, wasmURL }, { signal });
    check(signal);
    await ffmpeg.writeFile('source', await fetchFile(file));
    check(signal);
    await ffmpeg.exec(['-i', 'source', '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', 'source.wav']);
    check(signal);
    const extracted = await ffmpeg.readFile('source.wav') as Uint8Array;
    check(signal);
    report('enhancing', 26, 'Enhancing voice with DeepFilterNet…');
    const cleaned = restoreProgramLevel(await neural(wavSamples(extracted), value => report('enhancing', 26 + Math.round(value * 58), 'Enhancing voice with DeepFilterNet…'), signal));
    check(signal);
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'wav') {
      report('packaging', 96, 'Preparing lossless audio…');
      return new File([ownedBuffer(wavFile(cleaned))], `${file.name.replace(/\.wav$/i, '')}-clear.wav`, { type: 'audio/wav' });
    }
    await ffmpeg.writeFile('cleaned.wav', wavFile(cleaned));
    check(signal);
    const hasVideo = extension === 'mp4';
    const output = hasVideo ? 'clear.mp4' : 'clear.m4a';
    report('packaging', 86, hasVideo ? 'Packaging untouched video…' : 'Packaging enhanced audio…');
    await ffmpeg.exec(['-i', 'source', '-i', 'cleaned.wav', '-map', ...(hasVideo ? ['0:v:0'] : []), '-map', '1:a:0', ...(hasVideo ? ['-c:v', 'copy'] : []), '-c:a', 'aac', '-b:a', '192k', '-shortest', output]);
    check(signal);
    const result = await ffmpeg.readFile(output) as Uint8Array;
    check(signal);
    return new File([ownedBuffer(result)], `${file.name.replace(/\.[^.]+$/, '')}-clear.${hasVideo ? 'mp4' : 'm4a'}`, { type: hasVideo ? 'video/mp4' : 'audio/mp4' });
  } finally {
    signal.removeEventListener('abort', onAbort);
    ffmpeg.terminate();
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
