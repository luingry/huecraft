import { layerTopZ, type PrintParams, type StackEntry, type StackFilament } from '@huecraft/project-schema';
import { buildTerracedSolidMesh, type MeshData } from '@huecraft/mesh';
import type { MeshVolume } from '@huecraft/exporters';
import { FALLBACK_FILAMENT } from './stack.js';

/**
 * Face-down printing (the image faces the build plate).
 *
 * The face-up relief is turned over (mirrored in x, so the image reads right
 * from the plate side) and the empty space in front of each column is filled
 * with clear filament: the print becomes a flat slab whose plate side is the
 * image. Seen from the front every column holds the same filaments in the same
 * order as the face-up print seen from above, behind a clear window instead of
 * air, so the predicted colours stay the same. Each layer now mixes clear with
 * one colour, so the slab is split into one part per filament for a
 * multi-material printer.
 *
 * Layers are re-indexed rather than mirrored in z: face-up layer k becomes
 * layer T-1-k from the plate, so the slicer's first layer (which may be
 * thicker) is again the first one printed.
 */

export const CLEAR_FILAMENT: StackFilament = { name: 'Clear (transparent)', brand: '', colorHex: '#e4ecf0', tdMm: 100 };

/** z of the plateau of a column with m layers counted from the plate. */
function plateau(print: PrintParams, m: number): number {
  return m <= 0 ? 0 : layerTopZ(print, m - 1);
}

/** Face-down z for every face-up plateau z (index = face-up layer count). */
function flipTable(print: PrintParams, totalLayers: number): { up: Float32Array; down: Float32Array; index: Map<number, number> } {
  const up = new Float32Array(totalLayers + 1);
  const down = new Float32Array(totalLayers + 1);
  const index = new Map<number, number>();
  for (let k = 0; k <= totalLayers; k++) {
    up[k] = plateau(print, k);
    down[k] = plateau(print, totalLayers - k);
    index.set(zKey(up[k]), k);
  }
  return { up, down, index };
}

const zKey = (z: number) => Math.round(z * 1e4);

/** Turns face-up positions over in place: x mirrored, plateau z re-indexed from the plate. */
function turnOver(positions: Float32Array, widthMm: number, table: ReturnType<typeof flipTable>): void {
  for (let o = 0; o < positions.length; o += 3) {
    positions[o] = widthMm - positions[o];
    const k = table.index.get(zKey(positions[o + 2]));
    if (k === undefined) throw new Error(`Face-down: z ${positions[o + 2]} is not a layer top`);
    positions[o + 2] = table.down[k];
  }
}

function mirrorX(positions: Float32Array, widthMm: number): void {
  for (let o = 0; o < positions.length; o += 3) positions[o] = widthMm - positions[o];
}

function flipWinding(indices: Uint32Array): void {
  for (let o = 0; o < indices.length; o += 3) {
    const b = indices[o + 1];
    indices[o + 1] = indices[o + 2];
    indices[o + 2] = b;
  }
}

export interface FaceDownFilament {
  /** 1-based filament slot in the export. */
  extruder: number;
  name: string;
  colorHex: string;
  clear: boolean;
}

export interface FaceDownModel {
  /** Every part, concatenated in `volumes` order. */
  mesh: MeshData;
  volumes: MeshVolume[];
  /** Slot 1 is the clear filler (printed first), then colours front to back. */
  filaments: FaceDownFilament[];
  /** One mesh per filament (several parts may share one), for STL. */
  perFilament: { filament: FaceDownFilament; mesh: MeshData }[];
  heightMm: number;
}

export interface FaceDownInput {
  /** Face-up layer count per sample (snapped), row-major, row 0 = top of the image. */
  field: Uint16Array;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  print: PrintParams;
  totalLayers: number;
  /** Normalised stack. */
  stack: StackEntry[];
}

/** Layers of its own colour every column keeps at the face: one layer is too translucent to read sharply. */
export const FACE_DOWN_MIN_COLOUR_LAYERS = 2;

/**
 * Layer count each count becomes so the colour on top of the column is at
 * least `minLayers` thick (index = face-up layer count). A column ending
 * fewer layers into its band is raised within the band, keeping its colour;
 * bands thinner than `minLayers` are left as they are.
 */
export function colourDepthMap(stack: StackEntry[], totalLayers: number, minLayers = FACE_DOWN_MIN_COLOUR_LAYERS): Uint16Array {
  const map = new Uint16Array(totalLayers + 1);
  const starts = stack.length > 0 ? stack.map((e) => e.startLayer) : [0];
  for (let n = 0; n <= totalLayers; n++) {
    map[n] = n;
    if (n === 0) continue;
    let b = 0;
    for (let i = 1; i < starts.length; i++) if (starts[i] <= n - 1) b = i;
    const start = starts[b];
    const end = Math.min(totalLayers, b + 1 < starts.length ? starts[b + 1] : totalLayers);
    if (n - start < minLayers && end - start >= minLayers) map[n] = start + minLayers;
  }
  return map;
}

export function buildFaceDownModel(input: FaceDownInput): FaceDownModel {
  const { print, totalLayers: T, widthMm } = input;
  const depth = colourDepthMap(input.stack, T);
  const field = input.field.map((n) => depth[n]);
  const table = flipTable(print, T);
  const grid = { width: input.width, height: input.height, widthMm, heightMm: input.heightMm };
  let maxN = 0;
  for (let i = 0; i < field.length; i++) if (field[i] > maxN) maxN = field[i];

  const filaments: FaceDownFilament[] = [{ extruder: 1, name: CLEAR_FILAMENT.name, colorHex: CLEAR_FILAMENT.colorHex, clear: true }];
  const slotOf = new Map<string, FaceDownFilament>();
  const entries = input.stack.length > 0 ? input.stack : [{ slotId: 'fallback', startLayer: 0, filament: FALLBACK_FILAMENT }];
  // Slots front to back: the top of the face-up stack is the nearest to the plate.
  for (let i = entries.length - 1; i >= 0; i--) {
    const f = entries[i].filament;
    const key = `${f.colorHex.toLowerCase()}|${f.name}`;
    if (slotOf.has(key)) continue;
    const slot = { extruder: filaments.length + 1, name: f.name, colorHex: f.colorHex, clear: false };
    slotOf.set(key, slot);
    filaments.push(slot);
  }

  const parts: { filament: FaceDownFilament; name: string; mesh: MeshData }[] = [];
  // Clear filler: face-down layers [0, T - n).
  const inverse = new Uint16Array(field.length);
  let anyClear = false;
  for (let i = 0; i < field.length; i++) {
    inverse[i] = Math.max(0, T - field[i]);
    if (inverse[i] > 0) anyClear = true;
  }
  if (anyClear) {
    const mesh = buildTerracedSolidMesh({ ...grid, field: inverse, zOfCount: table.up }) as MeshData;
    mirrorX(mesh.positions, widthMm);
    flipWinding(mesh.indices);
    parts.push({ filament: filaments[0], name: CLEAR_FILAMENT.name, mesh });
  }
  // Colour bands, front to back: face-up layers [start, min(n, end)).
  for (let i = entries.length - 1; i >= 0; i--) {
    const start = entries[i].startLayer;
    const end = Math.min(T, i + 1 < entries.length ? entries[i + 1].startLayer : T);
    if (end <= start || maxN <= start) continue;
    const f = entries[i].filament;
    const mesh = buildTerracedSolidMesh({ ...grid, field, zOfCount: table.up, minCount: start, maxCount: end }) as MeshData;
    turnOver(mesh.positions, widthMm, table);
    parts.push({ filament: slotOf.get(`${f.colorHex.toLowerCase()}|${f.name}`)!, name: f.name, mesh });
  }
  parts.sort((a, b) => a.filament.extruder - b.filament.extruder);

  const combined = concatMeshes(parts.map((p) => p.mesh));
  const volumes: MeshVolume[] = [];
  let t = 0;
  for (const p of parts) {
    volumes.push({ name: `${p.filament.extruder} · ${p.name}`, extruder: p.filament.extruder, firstTriangle: t, lastTriangle: t + p.mesh.triangleCount - 1 });
    t += p.mesh.triangleCount;
  }
  const perFilament = filaments
    .map((filament) => ({ filament, mesh: concatMeshes(parts.filter((p) => p.filament === filament).map((p) => p.mesh)) }))
    .filter((e) => e.mesh.triangleCount > 0);
  return { mesh: combined, volumes, filaments: filaments.filter((f) => perFilament.some((e) => e.filament === f)), perFilament, heightMm: plateau(print, T) };
}

export function concatMeshes(meshes: MeshData[]): MeshData {
  let verts = 0;
  let tris = 0;
  for (const m of meshes) {
    verts += m.positions.length / 3;
    tris += m.triangleCount;
  }
  const positions = new Float32Array(verts * 3);
  const indices = new Uint32Array(tris * 3);
  let v = 0;
  let t = 0;
  for (const m of meshes) {
    positions.set(m.positions, v * 3);
    for (let i = 0; i < m.triangleCount * 3; i++) indices[t * 3 + i] = m.indices[i] + v;
    v += m.positions.length / 3;
    t += m.triangleCount;
  }
  return { positions, indices, triangleCount: tris };
}

export interface FaceDownPreview {
  /**
   * The preview mesh flattened to the slab: every column reaches the full
   * height, keeping its colour on top (same vertex order and colours as
   * `result.mesh`). Shown face up, as the image looks once the print is turned over.
   */
  positions: Float32Array;
  /** Colours with the export's minimum colour depth applied (see colourDepthMap). */
  printedColors: Float32Array;
  slicerColors: Float32Array;
  heightMm: number;
}

/**
 * Face-down variant of the terraced preview mesh, built on the main thread
 * from a preview result. The mesh is made of separate quads (4 vertices each),
 * each coloured by the tallest column it belongs to.
 */
export function faceDownPreview(
  result: { totalLayers: number; printedLut: Uint8Array; slicerLut: Uint8Array; mesh: { positions: Float32Array; printedColors: Float32Array; slicerColors: Float32Array } },
  print: PrintParams,
  stack: StackEntry[],
): FaceDownPreview {
  const T = result.totalLayers;
  const heightMm = plateau(print, T);
  const table = flipTable(print, T);
  const depth = colourDepthMap(stack, T);
  const src = result.mesh.positions;
  const positions = src.slice();
  const printedColors = result.mesh.printedColors.slice();
  const slicerColors = result.mesh.slicerColors.slice();
  for (let q = 0; q < src.length; q += 12) {
    let k = 0;
    for (let v = q + 2; v < q + 12; v += 3) k = Math.max(k, table.index.get(zKey(src[v])) ?? 0);
    const c = depth[k] * 3;
    for (let v = q; v < q + 12; v += 3) {
      if (positions[v + 2] > 0) positions[v + 2] = heightMm;
      if (k === 0) continue;
      for (let ch = 0; ch < 3; ch++) {
        printedColors[v + ch] = result.printedLut[c + ch] / 255;
        slicerColors[v + ch] = result.slicerLut[c + ch] / 255;
      }
    }
  }
  return { positions, printedColors, slicerColors, heightMm };
}

/** Human-readable filament plan for a face-down export. */
export function formatFaceDownPlan(input: {
  name: string;
  print: PrintParams;
  totalLayers: number;
  sizeMm: { width: number; height: number; z: number };
  filaments: FaceDownFilament[];
}): string {
  const { print } = input;
  const f3 = (v: number) => v.toFixed(3);
  const f2 = (v: number) => v.toFixed(2);
  const lines = [
    `hueCraft face-down plan: ${input.name}`,
    `Size: ${f2(input.sizeMm.width)} × ${f2(input.sizeMm.height)} × ${f2(input.sizeMm.z)} mm`,
    `Layer height: ${f3(print.layerHeightMm)} mm, first layer: ${f3(print.firstLayerHeightMm)} mm, total layers: ${input.totalLayers}`,
    'Set the same layer height and first layer height in the slicer.',
    '',
    'Printed face down: the image is on the build-plate side, mirrored so it reads',
    'right when the print is turned over. Every layer mixes filaments, so this needs',
    'a multi-material printer (AMS / MMU). The model is one object with one part per',
    'filament; check each part is on the slot below.',
    '',
  ];
  for (const f of input.filaments) {
    lines.push(`Filament ${f.extruder}: "${f.name}" ${f.colorHex}${f.clear ? ' (clear window in front of the image, printed first)' : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}
