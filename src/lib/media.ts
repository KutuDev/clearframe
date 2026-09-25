import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

type Progress = (stage: string, value: number, message: string) => void;
const readU32 = (view: DataView, offset: number) => view.getUint32(offset, true);
const ownedBuffer = (bytes: Uint8Array) => { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); return copy.buffer; };

function wavSamples(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4));
    const length = readU32(view, offset + 4);
    if (id === 'data') return new Float32Array(view.buffer.slice(view.byteOffset + offset + 8, view.byteOffset + offset + 8 + length));
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

function neural(samples: Float32Array, progress: (value: number) => void): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/neural.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') progress(data.value);
      if (data.type === 'complete') { worker.terminate(); resolve(new Float32Array(data.samples)); }
      if (data.type === 'error') { worker.terminate(); reject(new Error(data.error)); }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('The neural worker stopped unexpectedly.')); };
    worker.postMessage({ samples: samples.buffer }, [samples.buffer]);
  });
}

// DeepFilterNet intentionally prioritizes suppression over program loudness.
// The paid benchmark restores approximately +5 dB after suppression. Apply
// that makeup gain, bounded by a -0.1 dBFS ceiling so arbitrary user files can
// never clip simply because they were already loud.
function restoreProgramLevel(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const targetGain = 10 ** (5 / 20);
  const safeGain = peak > 0 ? Math.min(targetGain, 0.99 / peak) : 1;
  const restored = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) restored[i] = samples[i] * safeGain;
  return restored;
}

export async function processMedia(file: File, report: Progress): Promise<File> {
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => console.debug(`[ffmpeg] ${message}`));
  ffmpeg.on('progress', ({ progress }) => report('preparing', 8 + Math.round(progress * 17), 'Preparing audio locally…'));
  report('checking', 2, 'Loading local media engine…');
  // Blob URLs keep Vite from treating public runtime assets as source modules
  // and allow FFmpeg's internal worker to load the self-hosted core in dev and
  // in the immutable Vercel deployment.
  await ffmpeg.load({
    coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
    wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
  });
  await ffmpeg.writeFile('source', await fetchFile(file));
  await ffmpeg.exec(['-i', 'source', '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', 'source.wav']);
  const extracted = await ffmpeg.readFile('source.wav');
  report('enhancing', 26, 'Enhancing voice with DeepFilterNet…');
  const cleaned = restoreProgramLevel(await neural(wavSamples(extracted as Uint8Array), value => report('enhancing', 26 + Math.round(value * 58), 'Enhancing voice with DeepFilterNet…')));
  await ffmpeg.writeFile('cleaned.wav', wavFile(cleaned));
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'wav') {
    report('packaging', 96, 'Preparing lossless audio…');
    const encoded = wavFile(cleaned);
    return new File([ownedBuffer(encoded)], `${file.name.replace(/\.wav$/i, '')}-clear.wav`, { type: 'audio/wav' });
  }
  const hasVideo = extension === 'mp4';
  const output = hasVideo ? 'clear.mp4' : 'clear.m4a';
  report('packaging', 86, hasVideo ? 'Packaging untouched video…' : 'Packaging enhanced audio…');
  await ffmpeg.exec(['-i', 'source', '-i', 'cleaned.wav', '-map', ...(hasVideo ? ['0:v:0'] : []), '-map', '1:a:0', ...(hasVideo ? ['-c:v', 'copy'] : []), '-c:a', 'aac', '-b:a', '192k', '-shortest', output]);
  const result = await ffmpeg.readFile(output) as Uint8Array;
  ffmpeg.terminate();
  report('complete', 100, 'Your enhanced file is ready.');
  return new File([ownedBuffer(result)], `${file.name.replace(/\.[^.]+$/, '')}-clear.${hasVideo ? 'mp4' : 'm4a'}`, { type: hasVideo ? 'video/mp4' : 'audio/mp4' });
}
