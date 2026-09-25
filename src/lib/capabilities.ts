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
  return ['mp4', 'm4a', 'wav'].includes(extension ?? '') && file.size <= 500 * 1024 ** 2;
}
