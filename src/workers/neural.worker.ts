/// <reference lib="webworker" />
import { DeepFilter } from '@lofcz/deepfilternet-web';
import neuralWasmUrl from '@lofcz/deepfilternet-web/df_bg.wasm?url';

type Request = { samples: ArrayBuffer };
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    const input = new Float32Array(data.samples);
    const filter = await DeepFilter.create({ wasmUrl: neuralWasmUrl, attenuationLimit: 100 });
    filter.setPostFilterBeta(0.02);
    const output = new Float32Array(input.length);
    const frame = new Float32Array(filter.frameLength);
    for (let offset = 0; offset < input.length; offset += frame.length) {
      const count = Math.min(frame.length, input.length - offset);
      frame.fill(0); frame.set(input.subarray(offset, offset + count));
      output.set(filter.process(frame).subarray(0, count), offset);
      if (offset % (frame.length * 200) === 0) postMessage({ type: 'progress', value: offset / input.length });
    }
    filter.destroy();
    postMessage({ type: 'complete', samples: output.buffer }, [output.buffer]);
  } catch (error) {
    postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Neural processing failed.' });
  }
};
