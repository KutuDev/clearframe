export type Stage = 'idle' | 'checking' | 'preparing' | 'enhancing' | 'packaging' | 'complete' | 'error' | 'cancelled';
export type JobProgress = { stage: Stage; value: number; message: string; output?: File; error?: string };

import { processMedia } from './media';

export class DenoiseJob {
  private cancelled = false;
  constructor(private readonly update: (next: JobProgress) => void) {}
  async start(file: File) {
    try {
      const output = await processMedia(file, (stage, value, message) => !this.cancelled && this.update({ stage: stage as Stage, value, message }));
      if (!this.cancelled) this.update({ stage: 'complete', value: 100, message: 'Your enhanced file is ready.', output });
    } catch (error) {
      console.error('ClearFrame processing failure:', error);
      const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error) || 'Unknown error';
      if (!this.cancelled) this.update({ stage: 'error', value: 0, message: 'Could not complete this job.', error: detail });
    }
  }
  cancel() { this.cancelled = true; this.update({ stage: 'cancelled', value: 0, message: 'Job cancelled. Refresh to release local processing memory.' }); }
  dispose() { this.cancelled = true; }
}
