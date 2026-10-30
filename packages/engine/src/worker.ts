import { runPipeline, type PipelineInput } from './pipeline.js';

export type WorkerRequest =
  | { type: 'run'; id: string; input: PipelineInput }
  | { type: 'bench'; id: string };

export type WorkerResponse =
  | { type: 'result'; id: string; result: ReturnType<typeof runPipeline> }
  | { type: 'bench'; id: string; ms: number }
  | { type: 'error'; id: string; message: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'run') {
      const result = runPipeline(msg.input);
      const response: WorkerResponse = { type: 'result', id: msg.id, result };
      const transfer: Transferable[] = [
        result.meshPositions.buffer,
        result.meshIndices.buffer,
        result.meshColors.buffer,
        result.previewRgba.buffer,
      ];
      if (result.stl) transfer.push(result.stl);
      if (result.threeMf) transfer.push(result.threeMf.buffer);
      self.postMessage(response, { transfer });
    } else if (msg.type === 'bench') {
      const start = performance.now();
      const w = 128;
      const h = 128;
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const v = (i % w) / w;
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = Math.floor(v * 255);
        rgba[i * 4 + 3] = 255;
      }
      runPipeline({
        project: {
          schemaVersion: 1,
          id: 'bench',
          name: 'bench',
          createdAt: '',
          updatedAt: '',
          relief: { mode: 'luminance', contrast: 1, gamma: 1, paletteColors: [], referenceAnchors: [] },
          print: { layerHeightMm: 0.08, baseThicknessMm: 0.4, maxHeightMm: 3.2, mmPerPixel: 0.25 },
          stack: [],
        },
        image: { width: w, height: h, rgba },
        filaments: [
          {
            id: 'a',
            name: 'Black',
            brand: 'G',
            colorHex: '#111',
            lab: { l: 8, a: 0, b: 0 },
            tdMm: 0.3,
            source: 'builtin',
          },
          {
            id: 'b',
            name: 'White',
            brand: 'G',
            colorHex: '#eee',
            lab: { l: 94, a: 0, b: 0 },
            tdMm: 6,
            source: 'builtin',
          },
        ],
        previewMaxEdge: 128,
      });
      const ms = performance.now() - start;
      self.postMessage({ type: 'bench', id: msg.id, ms } satisfies WorkerResponse);
    }
  } catch (e) {
    self.postMessage({
      type: 'error',
      id: msg.id,
      message: e instanceof Error ? e.message : String(e),
    } satisfies WorkerResponse);
  }
};
