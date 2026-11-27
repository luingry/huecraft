import type { Toolpaths, ToolpathInput } from './toolpath';

/** Latest-wins wrapper around the toolpath worker: an older pending answer is dropped. */
export class ToolpathClient {
  private worker = new Worker(new URL('./toolpath.worker.ts', import.meta.url), { type: 'module' });
  private next = 1;
  private latest = 0;
  private waiting = new Map<number, { resolve: (t: Toolpaths | null) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<{ id: number; toolpaths?: Toolpaths; error?: string }>) => {
      const { id, toolpaths, error } = ev.data;
      const w = this.waiting.get(id);
      this.waiting.delete(id);
      if (!w) return;
      if (error) w.reject(new Error(error));
      else w.resolve(id === this.latest ? toolpaths! : null);
    };
  }

  /** Resolves null when a newer request superseded this one. */
  build(input: ToolpathInput): Promise<Toolpaths | null> {
    const id = this.next++;
    this.latest = id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ id, input });
    });
  }

  dispose(): void {
    this.worker.terminate();
    for (const w of this.waiting.values()) w.resolve(null);
    this.waiting.clear();
  }
}
