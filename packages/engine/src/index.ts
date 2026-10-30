import { runPipeline, loadImageFromRgba } from './pipeline.js';

export { runPipeline, loadImageFromRgba };
export type { PipelineInput, PipelineResult } from './pipeline.js';
export type { WorkerRequest, WorkerResponse } from './worker.js';

export function createEngineWorker(): Worker {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

export function runInWorker(
  worker: Worker,
  input: import('./pipeline.js').PipelineInput,
): Promise<import('./pipeline.js').PipelineResult> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const handler = (ev: MessageEvent) => {
      const data = ev.data;
      if (data.id !== id) return;
      worker.removeEventListener('message', handler);
      if (data.type === 'result') resolve(data.result);
      else if (data.type === 'error') reject(new Error(data.message));
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ type: 'run', id, input });
  });
}
