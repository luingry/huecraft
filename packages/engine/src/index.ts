import type {
  ExportRequestParams,
  ExportResult,
  PreviewParams,
  PreviewResult,
  SourceImage,
  WorkerRequest,
  WorkerResponse,
} from './protocol.js';
import { LatestWinsQueue } from './scheduler.js';

export * from './protocol.js';
export { EngineCore, runExport, runPreview, layerModelFor, physicalSize, plateauZ } from './core.js';
export { buildFaceDownModel, faceDownPreview, formatFaceDownPlan, CLEAR_FILAMENT, type FaceDownPreview } from './faceDown.js';
export { PaintCanvas, applyPaint, paintTargetLayer, resolvePaintLayers } from './paint.js';
export { autoDistributeStack, computeSwaps, formatSwapPlan, normalizeStack, type SwapPlanInput } from './stack.js';
export { LatestWinsQueue, abortError, isAbortError } from './scheduler.js';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (e: unknown) => void;
}

type RequestBody =
  | { type: 'setImage'; image: SourceImage }
  | { type: 'preview'; params: PreviewParams }
  | { type: 'export'; params: ExportRequestParams };

/**
 * Main-thread handle to the engine worker.
 * - setImage: sends a copy of the pixels once (the copy's buffer is transferred).
 * - preview: latest-wins; superseded calls reject with an Error named 'AbortError'.
 * - export: queued in order with the other requests.
 * Result buffers are transferred from the worker, never copied.
 */
export class EngineClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly calls = new Map<number, PendingCall>();
  private readonly previews: LatestWinsQueue<PreviewParams, PreviewResult>;
  private disposed = false;

  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
    this.worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault?.();
      this.failAll(new Error(ev.message || 'Engine worker crashed'));
    };
    this.previews = new LatestWinsQueue((params) => this.call<PreviewResult>({ type: 'preview', params }));
  }

  setImage(image: SourceImage): Promise<void> {
    const rgba = new Uint8ClampedArray(image.rgba);
    return this.call<void>({ type: 'setImage', image: { width: image.width, height: image.height, rgba } }, [rgba.buffer]);
  }

  preview(params: PreviewParams): Promise<PreviewResult> {
    if (this.disposed) return Promise.reject(new Error('Engine disposed'));
    return this.previews.request(params);
  }

  export(params: ExportRequestParams): Promise<ExportResult> {
    return this.call<ExportResult>({ type: 'export', params });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.failAll(new Error('Engine disposed'));
  }

  private call<T>(body: RequestBody, transfer: Transferable[] = []): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Engine disposed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        this.worker.postMessage({ ...body, id } as WorkerRequest, transfer);
      } catch (e) {
        this.calls.delete(id);
        reject(e);
      }
    });
  }

  private onMessage(msg: WorkerResponse): void {
    const call = this.calls.get(msg.id);
    if (!call) return;
    this.calls.delete(msg.id);
    switch (msg.type) {
      case 'ok':
        call.resolve(undefined);
        break;
      case 'preview':
        call.resolve(msg.result);
        break;
      case 'export':
        call.resolve(msg.result);
        break;
      case 'error':
        call.reject(new Error(msg.message));
        break;
    }
  }

  private failAll(e: Error): void {
    this.previews.cancelPending(e);
    for (const c of this.calls.values()) c.reject(e);
    this.calls.clear();
  }
}
