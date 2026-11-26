import { EngineCore } from './core.js';
import type { ExportResult, PreviewResult, WorkerRequest, WorkerResponse } from './protocol.js';

const core = new EngineCore();

function previewTransfer(r: PreviewResult): Transferable[] {
  return [
    ...(r.selection ? [r.selection.buffer] : []),
    r.printedRgba.buffer,
    r.slicerRgba.buffer,
    r.layerField.buffer,
    r.layerHistogram.buffer,
    r.printedLut.buffer,
    r.slicerLut.buffer,
    r.mesh.positions.buffer,
    r.mesh.indices.buffer,
    r.mesh.printedColors.buffer,
    r.mesh.slicerColors.buffer,
  ] as Transferable[];
}

function exportTransfer(r: ExportResult): Transferable[] {
  return [r.bytes.buffer] as Transferable[];
}

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  // Deduplicate: transferring the same buffer twice throws a DataCloneError.
  self.postMessage(msg, { transfer: [...new Set(transfer)] });
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'setImage':
        core.setImage(msg.image);
        post({ type: 'ok', id: msg.id });
        break;
      case 'preview': {
        const result = core.preview(msg.params);
        post({ type: 'preview', id: msg.id, result }, previewTransfer(result));
        break;
      }
      case 'autoTune':
        post({ type: 'autoTune', id: msg.id, result: core.autoTune(msg.params) });
        break;
      case 'export': {
        const result = core.export(msg.params);
        post({ type: 'export', id: msg.id, result }, exportTransfer(result));
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
};
