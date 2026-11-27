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

/** Face-down note: which filament goes on each slot. */
export function faceDownNoteLines(name: string, filaments: { extruder: number; name: string }[]): string[] {
  return [`hueCraft: ${name} (face down)`, ...filaments.map((f) => `Filament ${f.extruder}: ${f.name}`)];
}
