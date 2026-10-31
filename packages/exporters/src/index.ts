import type { MeshData } from '@huecraft/mesh';
import { strToU8, unzipSync, zipSync, type ZipOptions } from 'fflate';

/** One filament swap as written into slicer project metadata. */
export interface SlicerSwap {
  /** Z (mm) of the top of the first layer printed with the new filament. */
  topZMm: number;
  kind: 'pause' | 'color-change';
  /** Colour of the filament loaded at this swap (#rrggbb). */
  colorHex: string;
  /** Short message (shown by slicers that support it, e.g. "Load Mid Gray PLA"). */
  message: string;
}

/**
 * CustomGCode::Type values shared by PrusaSlicer, Bambu Studio and OrcaSlicer
 * (libslic3r/CustomGCode.hpp): ColorChange = 0, PausePrint = 1, ToolChange = 2,
 * Template = 3, Custom = 4.
 */
export const CUSTOM_GCODE_TYPE = { ColorChange: 0, PausePrint: 1, ToolChange: 2, Template: 3, Custom: 4 } as const;

/** Bambu Studio / OrcaSlicer: Metadata/custom_gcode_per_layer.xml */
export const BAMBU_CUSTOM_GCODE_PATH = 'Metadata/custom_gcode_per_layer.xml';
/** PrusaSlicer: Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml */
export const PRUSA_CUSTOM_GCODE_PATH = 'Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml';
/** Bambu Studio / OrcaSlicer project configuration (full flattened preset JSON). */
export const PROJECT_SETTINGS_PATH = 'Metadata/project_settings.config';

// ---------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------

/** Binary STL written straight into one preallocated buffer. */
export function exportBinaryStl(mesh: MeshData, name = 'huecraft'): ArrayBuffer {
  const { positions, indices, triangleCount } = mesh;
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const header = strToU8(`hueCraft ${name}`.slice(0, 80));
  new Uint8Array(buffer, 0, header.length).set(header);
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(offset, nx / len, true);
    view.setFloat32(offset + 4, ny / len, true);
    view.setFloat32(offset + 8, nz / len, true);
    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Byte writer: ASCII XML without building giant JS strings.
// ---------------------------------------------------------------------------

class ByteWriter {
  buf: Uint8Array;
  len = 0;

  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(1024, capacity));
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  /** Append bytes of an ASCII-only string. */
  ascii(s: string): void {
    this.ensure(s.length);
    const b = this.buf;
    let l = this.len;
    for (let i = 0; i < s.length; i++) b[l++] = s.charCodeAt(i);
    this.len = l;
  }

  bytes(u: Uint8Array): void {
    this.ensure(u.length);
    this.buf.set(u, this.len);
    this.len += u.length;
  }

  /** Non-negative integer. */
  uint(v: number): void {
    this.ensure(16);
    const b = this.buf;
    if (v === 0) {
      b[this.len++] = 48;
      return;
    }
    let digits = 0;
    for (let t = v; t > 0; t = Math.floor(t / 10)) digits++;
    let p = this.len + digits;
    this.len = p;
    for (let t = v; t > 0; t = Math.floor(t / 10)) b[--p] = 48 + (t % 10);
  }

  /** Number rounded to 4 decimals, trailing zeros trimmed (e.g. 12.5, -0.0801, 3). */
  fixed4(v: number): void {
    let s = Math.round(v * 10000);
    if (s < 0) {
      this.ensure(1);
      this.buf[this.len++] = 45;
      s = -s;
    }
    const int = Math.floor(s / 10000);
    let frac = s - int * 10000;
    this.uint(int);
    if (frac === 0) return;
    let digits = 4;
    while (frac % 10 === 0) {
      frac /= 10;
      digits--;
    }
    this.ensure(8);
    const b = this.buf;
    b[this.len++] = 46;
    let p = this.len + digits;
    this.len = p;
    for (let i = 0; i < digits; i++) {
      b[--p] = 48 + (frac % 10);
      frac = Math.floor(frac / 10);
    }
  }

  result(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);
}

function fmtZ(z: number): string {
  return String(Math.round(z * 10000) / 10000);
}

// ---------------------------------------------------------------------------
// Custom G-code (filament swaps) metadata
// ---------------------------------------------------------------------------

/**
 * Bambu Studio / OrcaSlicer per-plate custom G-code list (bbs_3mf.cpp,
 * `_add_custom_gcode_per_print_z_file_to_archive`). `top_z` is the print_z of the
 * first layer printed with the new filament; the slicer emits the command before
 * that layer. Pause → type 1 (PausePrint, Bambu `machine_pause_gcode` = "M400 U1").
 * Colour change → type 0 (ColorChange → `color_change_gcode`, M600). Note that
 * Bambu Studio's own G-code generator ignores ColorChange items on single-nozzle
 * printers; use "pause" for Bambu printers.
 */
export function buildBambuCustomGcodeXml(swaps: SlicerSwap[]): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<custom_gcodes_per_layer>', '<plate>', '<plate_info id="1"/>'];
  for (const s of swaps) {
    const pause = s.kind === 'pause';
    lines.push(
      `<layer top_z="${fmtZ(s.topZMm)}" type="${pause ? CUSTOM_GCODE_TYPE.PausePrint : CUSTOM_GCODE_TYPE.ColorChange}" extruder="1" color="${escapeXml(s.colorHex)}" extra="${pause ? escapeXml(s.message) : ''}" gcode="${pause ? 'M400 U1' : 'M600'}"/>`,
    );
  }
  lines.push('<mode value="SingleExtruder"/>', '</plate>', '</custom_gcodes_per_layer>', '');
  return lines.join('\n');
}

/** PrusaSlicer custom G-code list (Format/3mf.cpp, `custom_gcodes_per_print_z`). */
export function buildPrusaCustomGcodeXml(swaps: SlicerSwap[]): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<custom_gcodes_per_print_z>'];
  for (const s of swaps) {
    const pause = s.kind === 'pause';
    lines.push(
      `<code print_z="${fmtZ(s.topZMm)}" type="${pause ? CUSTOM_GCODE_TYPE.PausePrint : CUSTOM_GCODE_TYPE.ColorChange}" extruder="1" color="${escapeXml(s.colorHex)}" extra="${pause ? escapeXml(s.message) : ''}" gcode="${pause ? 'M601' : 'M600'}"/>`,
    );
  }
  lines.push('<mode value="SingleExtruder"/>', '</custom_gcodes_per_print_z>', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Slicer project template (Bambu Studio / OrcaSlicer)
// ---------------------------------------------------------------------------

export interface SlicerProjectTemplate {
  /** Generator string, e.g. "BambuStudio-02.08.03.66" or "OrcaSlicer-2.3.1". */
  application: string;
  /** Parsed Metadata/project_settings.config. */
  settings: Record<string, unknown>;
}

/**
 * Read the parts of a Bambu Studio / OrcaSlicer project 3MF needed to make our
 * export a "project" for that slicer. Both slicers only apply custom G-code
 * (the swaps) when the 3MF carries a complete project configuration; a partial
 * one is either rejected or, worse, crashes the Bambu Studio CLI. Borrowing the
 * user's own project keeps their printer, process and filament settings.
 * Returns null when the file is not such a project.
 */
export function readSlicerProjectTemplate(data: Uint8Array): SlicerProjectTemplate | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.name === PROJECT_SETTINGS_PATH || f.name === '3D/3dmodel.model' });
  } catch {
    return null;
  }
  const cfg = files[PROJECT_SETTINGS_PATH];
  const model = files['3D/3dmodel.model'];
  if (!cfg || !model) return null;
  const head = new TextDecoder().decode(model.subarray(0, Math.min(model.length, 65536)));
  const app = /<metadata\s+name="Application"\s*>([^<]*)<\/metadata>/.exec(head)?.[1]?.trim();
  if (!app || !/^(BambuStudio|OrcaSlicer)-/.test(app)) return null;
  try {
    const settings = JSON.parse(new TextDecoder().decode(cfg)) as Record<string, unknown>;
    if (!settings || typeof settings !== 'object' || Object.keys(settings).length < 20) return null;
    return { application: app, settings };
  } catch {
    return null;
  }
}

function bedCentre(settings: Record<string, unknown>): [number, number] | null {
  const area = settings['printable_area'];
  if (!Array.isArray(area) || area.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of area) {
    const m = /^\s*(-?[\d.]+)\s*x\s*(-?[\d.]+)\s*$/.exec(String(p));
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// ---------------------------------------------------------------------------
// 3MF
// ---------------------------------------------------------------------------

export interface ThreeMfOptions {
  name?: string;
  swaps?: SlicerSwap[];
  /** Extra files to embed, path → UTF-8 text (e.g. 'Metadata/hueCraft_swap_plan.txt'). */
  attachments?: Record<string, string>;
  /** Slicer project to borrow the configuration from (see readSlicerProjectTemplate). */
  template?: SlicerProjectTemplate | null;
  /** Written into the borrowed configuration so the slicer layers match the relief. */
  layerHeightMm?: number;
  firstLayerHeightMm?: number;
  /** Colour of the first filament, written into the borrowed configuration. */
  firstFilamentHex?: string;
  /** Model extent, used to centre it on the template's bed. */
  sizeMm?: { width: number; height: number };
  /** Deflate level 0..9. Default 1: ~3x faster than 6 on a 2M-triangle model, ~5 % larger. */
  compressionLevel?: ZipOptions['level'];
  /**
   * Parts of the mesh printed with different filaments (multi-material), as
   * consecutive triangle ranges. Each is written as its own object, assembled by
   * a components object, which Bambu Studio (checked with its CLI), OrcaSlicer
   * and PrusaSlicer load as one object with one named part per range. Filaments
   * are assigned in the slicer; triangle-range volumes in
   * Slic3r_PE_model.config are not used, as Bambu Studio merges them into one part.
   */
  volumes?: MeshVolume[];
}

export interface MeshVolume {
  name: string;
  /** 1-based filament slot the part is meant for (shown in its name by the caller). */
  extruder: number;
  /** Inclusive triangle range. */
  firstTriangle: number;
  lastTriangle: number;
}

/** Zip of binary STLs (one per part) plus text attachments. */
export function exportStlZip(parts: { fileName: string; mesh: MeshData }[], attachments: Record<string, string> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const p of parts) files[p.fileName] = new Uint8Array(exportBinaryStl(p.mesh, p.fileName));
  for (const [path, text] of Object.entries(attachments)) files[path] = strToU8(text);
  return zipSync(files, { level: 1 });
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="application/xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Default Extension="txt" ContentType="text/plain"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** Build the 3D/3dmodel.model XML as bytes. */
export function build3mfModel(mesh: MeshData, opts: ThreeMfOptions = {}): Uint8Array {
  const { positions, indices, triangleCount } = mesh;
  const vertexCount = positions.length / 3;
  const w = new ByteWriter(vertexCount * 56 + triangleCount * 50 + 4096);
  const tpl = opts.template ?? null;
  const name = escapeXml(opts.name ?? 'hueCraft');
  const app = escapeXml(tpl ? tpl.application : 'hueCraft');
  w.ascii('<?xml version="1.0" encoding="UTF-8"?>\n');
  w.ascii('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"');
  if (tpl) w.ascii(' xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"');
  w.ascii('>\n');
  w.bytes(strToU8(` <metadata name="Application">${app}</metadata>\n`));
  if (tpl) w.ascii(' <metadata name="BambuStudio:3mfVersion">1</metadata>\n');
  w.bytes(strToU8(` <metadata name="Title">${name}</metadata>\n`));
  w.ascii(' <resources>\n');
  const volumes = opts.volumes ?? [];
  let itemId = 1;
  if (volumes.length === 0) {
    writeMeshObject(w, 1, name, positions, indices, 0, triangleCount - 1, null);
  } else {
    // One mesh object per part, assembled by a components object: slicers load
    // that as one object with one part per component.
    const remap = new Int32Array(vertexCount);
    volumes.forEach((v, i) => writeMeshObject(w, i + 1, escapeXml(v.name), positions, indices, v.firstTriangle, v.lastTriangle, remap));
    itemId = volumes.length + 1;
    w.bytes(strToU8(`  <object id="${itemId}" type="model" name="${name}">\n   <metadata name="name">${name}</metadata>\n   <components>\n`));
    for (let i = 0; i < volumes.length; i++) w.ascii(`    <component objectid="${i + 1}"/>\n`);
    w.ascii('   </components>\n  </object>\n');
  }
  w.ascii(` </resources>\n <build>\n  <item objectid="${itemId}"`);
  if (tpl && opts.sizeMm) {
    const c = bedCentre(tpl.settings);
    if (c) {
      w.ascii(' transform="1 0 0 0 1 0 0 0 1 ');
      w.fixed4(c[0] - opts.sizeMm.width / 2);
      w.ascii(' ');
      w.fixed4(c[1] - opts.sizeMm.height / 2);
      w.ascii(' 0"');
    }
  }
  w.ascii(' printable="1"/>\n </build>\n</model>\n');
  return w.result();
}

/**
 * One <object> with the triangles first..last (inclusive). With `remap`, only
 * the vertices those triangles use are written (renumbered); `remap` is scratch
 * space of one entry per vertex.
 */
function writeMeshObject(
  w: ByteWriter,
  id: number,
  escapedName: string,
  positions: Float32Array,
  indices: Uint32Array,
  first: number,
  last: number,
  remap: Int32Array | null,
): void {
  const attr = remap ? ` name="${escapedName}"` : '';
  w.bytes(strToU8(`  <object id="${id}" type="model"${attr}>\n   <metadata name="name">${escapedName}</metadata>\n`));
  w.ascii('   <mesh>\n    <vertices>\n');
  const vertex = (v: number) => {
    const o = v * 3;
    w.ascii('<vertex x="');
    w.fixed4(positions[o]);
    w.ascii('" y="');
    w.fixed4(positions[o + 1]);
    w.ascii('" z="');
    w.fixed4(positions[o + 2]);
    w.ascii('"/>\n');
  };
  if (remap) {
    remap.fill(-1);
    let next = 0;
    for (let k = first * 3; k < (last + 1) * 3; k++) {
      const v = indices[k];
      if (remap[v] < 0) {
        remap[v] = next++;
        vertex(v);
      }
    }
  } else {
    for (let v = 0; v < positions.length / 3; v++) vertex(v);
  }
  w.ascii('    </vertices>\n    <triangles>\n');
  for (let t = first; t <= last; t++) {
    const o = t * 3;
    const id0 = remap ? remap[indices[o]] : indices[o];
    const id1 = remap ? remap[indices[o + 1]] : indices[o + 1];
    const id2 = remap ? remap[indices[o + 2]] : indices[o + 2];
    w.ascii('<triangle v1="');
    w.uint(id0);
    w.ascii('" v2="');
    w.uint(id1);
    w.ascii('" v3="');
    w.uint(id2);
    w.ascii('"/>\n');
  }
  w.ascii('    </triangles>\n   </mesh>\n  </object>\n');
}

function patchedSettings(opts: ThreeMfOptions): string {
  const s: Record<string, unknown> = { ...(opts.template as SlicerProjectTemplate).settings };
  if (opts.layerHeightMm) s['layer_height'] = fmtZ(opts.layerHeightMm);
  if (opts.firstLayerHeightMm) s['initial_layer_print_height'] = fmtZ(opts.firstLayerHeightMm);
  if (opts.firstFilamentHex && Array.isArray(s['filament_colour']) && s['filament_colour'].length > 0) {
    const colours = [...(s['filament_colour'] as unknown[])];
    colours[0] = opts.firstFilamentHex.toUpperCase();
    s['filament_colour'] = colours;
  }
  return JSON.stringify(s, null, 4);
}

/**
 * 3MF package: core-spec model plus filament-swap metadata for Bambu Studio /
 * OrcaSlicer and PrusaSlicer. Without a template the file is a plain geometry
 * 3MF (generator "hueCraft"); PrusaSlicer applies the swaps when it is opened as
 * a project, Bambu Studio / OrcaSlicer ignore them. With a template it becomes a
 * project of that slicer and both apply the swaps automatically.
 */
export function export3mf(mesh: MeshData, opts: ThreeMfOptions = {}): Uint8Array {
  const swaps = opts.swaps ?? [];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': build3mfModel(mesh, opts),
  };
  if (swaps.length > 0) {
    files[BAMBU_CUSTOM_GCODE_PATH] = strToU8(buildBambuCustomGcodeXml(swaps));
    files[PRUSA_CUSTOM_GCODE_PATH] = strToU8(buildPrusaCustomGcodeXml(swaps));
  }
  if (opts.template) files[PROJECT_SETTINGS_PATH] = strToU8(patchedSettings(opts));
  for (const [path, text] of Object.entries(opts.attachments ?? {})) files[path] = strToU8(text);
  return zipSync(files, { level: opts.compressionLevel ?? 1 });
}

/** Decode every entry of a zip/3MF archive as UTF-8 text (inspection and tests). */
export function readArchiveText(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(unzipSync(data))) out[path] = new TextDecoder().decode(bytes);
  return out;
}
