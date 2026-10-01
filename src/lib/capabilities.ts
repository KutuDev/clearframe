export type Capabilities = { webCodecs: boolean; opfs: boolean; wasmSimd: boolean; isolated: boolean; supported: boolean };

export function detectCapabilities(): Capabilities {
  const webCodecs = typeof window !== 'undefined' && 'AudioDecoder' in window && 'VideoDecoder' in window;
  const opfs = typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  // A small SIMD instruction sequence; invalid modules are rejected by WebAssembly.validate.
  const wasmSimd = typeof WebAssembly !== 'undefined' && WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123]));
  return { webCodecs, opfs, wasmSimd, isolated, supported: webCodecs && opfs && wasmSimd };
}

export function supportedMedia(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return ['mp4', 'm4a', 'wav'].includes(extension ?? '') && file.size > 0;
}

type DeviceNavigator = Navigator & { deviceMemory?: number };

export function mediaLimits() {
  const memory = typeof navigator === 'undefined' ? undefined : (navigator as DeviceNavigator).deviceMemory;
  // deviceMemory is rounded and often unavailable. Unknown devices get the safest tier.
  if (memory !== undefined && memory >= 8) return { minutes: 10, megabytes: 120 };
  if (memory !== undefined && memory >= 4) return { minutes: 4, megabytes: 60 };
  return { minutes: 2, megabytes: 25 };
}

export async function preflightMedia(file: File, signal: AbortSignal): Promise<number> {
  if (!supportedMedia(file)) throw new Error('Choose a nonempty MP4, M4A, or WAV recording.');
  const limits = mediaLimits();
  if (file.size > limits.megabytes * 1024 ** 2) {
    throw new Error(`This device is limited to ${limits.megabytes} MB and ${limits.minutes} minutes per recording. Try a shorter recording.`);
  }
  if (signal.aborted) throw new DOMException('Job cancelled', 'AbortError');
  const duration = await new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(file.name.toLowerCase().endsWith('.mp4') ? 'video' : 'audio');
    media.preload = 'metadata';
    let settled = false;
    const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); media.onloadedmetadata = null; media.onerror = null; media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); };
    const finish = (value?: number, error?: Error) => { if (settled) return; settled = true; cleanup(); if (error) reject(error); else resolve(value!); };
    const onAbort = () => finish(undefined, new DOMException('Job cancelled', 'AbortError'));
    const timeout = setTimeout(() => finish(undefined, new Error('Could not read recording duration. Try a shorter supported file.')), 10_000);
    signal.addEventListener('abort', onAbort, { once: true });
    media.onloadedmetadata = () => finish(media.duration);
    media.onerror = () => finish(undefined, new Error('Could not read recording duration. Try a supported MP4, M4A, or WAV file.'));
    media.src = url;
  });
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not verify recording duration. Try a shorter supported file.');
  if (duration > limits.minutes * 60) throw new Error(`This device is limited to ${limits.minutes} minutes and ${limits.megabytes} MB per recording. Try a shorter recording.`);
  return duration;
}
