import { buildToolpaths, type ToolpathInput } from './toolpath';

self.onmessage = (ev: MessageEvent<{ id: number; input: ToolpathInput }>) => {
  const { id, input } = ev.data;
  try {
    const t = buildToolpaths(input);
    self.postMessage({ id, toolpaths: t }, { transfer: [t.segments.buffer, t.z.buffer, t.layer.buffer, t.kind.buffer, t.layerStart.buffer] });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
