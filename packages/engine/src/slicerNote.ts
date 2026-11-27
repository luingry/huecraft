import { buildTextMesh } from '@huecraft/mesh';
import type { SlicerNote } from '@huecraft/exporters';

/** Pixel size range of the note font (mm); the text uses about 40 % of the model width at most. */
const MIN_PIXEL_MM = 0.16;
const MAX_PIXEL_MM = 0.4;
const DEPTH_MM = 0.4;
const MAX_CHARS = 34;

function clip(s: string): string {
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1)}.` : s;
}

/**
 * Note as 3D pixel text, written as its own non-printable object so it is
 * visible in the slicer but never printed. Built with its top-left corner at
 * the origin; the exporter moves it to the back-left corner of the bed. The
 * font size follows the model width, within readable limits.
 */
export function buildSlicerNote(lines: string[], modelWidthMm: number): SlicerNote {
  const text = lines.map(clip);
  const cols = Math.max(1, ...text.map((l) => l.length));
  const pixelMm = Math.min(MAX_PIXEL_MM, Math.max(MIN_PIXEL_MM, (0.4 * modelWidthMm) / (cols * 6)));
  return {
    name: 'hueCraft - note (not printed)',
    mesh: buildTextMesh(text, { pixelMm, depthMm: DEPTH_MM, x: 0, y: 0 }),
  };
}

const MODE_LABEL = { pause: 'pause and swap by hand', 'color-change': 'M600', ams: 'AMS automatic' } as const;

/** Face-up note: start filament, then each swap with its slicer layer and Z. */
export function swapNoteLines(input: {
  name: string;
  mode: keyof typeof MODE_LABEL;
  firstFilament: string;
  swaps: { slicerLayer: number; topZMm: number; filamentName: string; slot?: number }[];
}): string[] {
  const slot = (n?: number) => (n ? ` [${n}]` : '');
  return [
    `hueCraft: ${input.name}`,
    `Swaps: ${MODE_LABEL[input.mode]}`,
    `Layer 1: ${input.firstFilament}`,
    ...input.swaps.map((s) => `Layer ${s.slicerLayer} Z${s.topZMm.toFixed(2)}: ${s.filamentName}${slot(s.slot)}`),
    ...(input.swaps.length === 0 ? ['No swaps'] : []),
  ];
}

/** Face-down note: which filament goes on each slot. */
export function faceDownNoteLines(name: string, filaments: { extruder: number; name: string }[]): string[] {
  return [`hueCraft: ${name} (face down)`, ...filaments.map((f) => `Filament ${f.extruder}: ${f.name}`)];
}
