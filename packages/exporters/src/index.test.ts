import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildSolidHeightfieldMesh } from '@huecraft/mesh';
import {
  BAMBU_CUSTOM_GCODE_PATH,
  build3mfModel,
  buildBambuCustomGcodeXml,
  export3mf,
  exportBinaryStl,
  PRUSA_CUSTOM_GCODE_PATH,
  PROJECT_SETTINGS_PATH,
  readSlicerProjectTemplate,
  type SlicerSwap,
} from './index.js';

const mesh = buildSolidHeightfieldMesh({ heights: new Float32Array(16).fill(1.2345678), width: 4, height: 4, widthMm: 40.123456, heightMm: 40 });
const swaps: SlicerSwap[] = [
  { topZMm: 0.64, kind: 'pause', colorHex: '#7a7a7a', message: 'Load Mid Gray "PLA"' },
  { topZMm: 1.2000000001, kind: 'color-change', colorHex: '#ffffff', message: 'Load White' },
];

describe('exportBinaryStl', () => {
  it('produces a valid header and triangle count', () => {
    const buf = exportBinaryStl(mesh);
    const view = new DataView(buf);
    expect(view.getUint32(80, true)).toBe(mesh.triangleCount);
    expect(buf.byteLength).toBe(84 + mesh.triangleCount * 50);
  });
});

describe('export3mf', () => {
  it('contains the model and the swap metadata with exact top_z', () => {
    const files = unzipSync(export3mf(mesh, { name: 'Test & co', swaps, attachments: { 'Metadata/plan.txt': 'hello' } }));
    expect(Object.keys(files).sort()).toEqual(
      ['3D/3dmodel.model', BAMBU_CUSTOM_GCODE_PATH, PRUSA_CUSTOM_GCODE_PATH, '[Content_Types].xml', '_rels/.rels', 'Metadata/plan.txt'].sort(),
    );
    const bambu = strFromU8(files[BAMBU_CUSTOM_GCODE_PATH]);
    expect(bambu).toContain('<plate_info id="1"/>');
    expect(bambu).toContain('<layer top_z="0.64" type="1" extruder="1" color="#7a7a7a" extra="Load Mid Gray &quot;PLA&quot;" gcode="M400 U1"/>');
    expect(bambu).toContain('<layer top_z="1.2" type="0" extruder="1" color="#ffffff" extra="" gcode="M600"/>');
    expect(bambu).toContain('<mode value="SingleExtruder"/>');
    const prusa = strFromU8(files[PRUSA_CUSTOM_GCODE_PATH]);
    expect(prusa).toContain('<code print_z="0.64" type="1"');
    expect(prusa).toContain('gcode="M601"');
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('<metadata name="Application">hueCraft</metadata>');
    expect(model).toContain('Test &amp; co');
    expect(model).not.toContain('BambuStudio');
    expect((model.match(/<triangle /g) ?? []).length).toBe(mesh.triangleCount);
    expect((model.match(/<vertex /g) ?? []).length).toBe(mesh.positions.length / 3);
  });

  it('writes compact numbers rounded to 4 decimals', () => {
    const model = strFromU8(build3mfModel(mesh));
    expect(model).toContain('z="1.2346"');
    expect(model).toContain('x="40.1235"');
    expect(model).toContain('<vertex x="0" y="40" z="1.2346"/>');
    expect(model).not.toMatch(/\d\.\d{5,}/);
  });

  it('omits swap files when there are no swaps', () => {
    const files = unzipSync(export3mf(mesh, {}));
    expect(files[BAMBU_CUSTOM_GCODE_PATH]).toBeUndefined();
  });

  it('borrows a slicer project configuration from a template', () => {
    const settings: Record<string, unknown> = { layer_height: '0.2', initial_layer_print_height: '0.2', filament_colour: ['#00AE42'], printable_area: ['0x0', '256x0', '256x256', '0x256'] };
    for (let i = 0; i < 30; i++) settings[`k${i}`] = String(i);
    const tplZip = zipSync({
      '3D/3dmodel.model': strToU8('<?xml version="1.0"?><model><metadata name="Application">BambuStudio-02.08.03.66</metadata></model>'),
      [PROJECT_SETTINGS_PATH]: strToU8(JSON.stringify(settings)),
    });
    const template = readSlicerProjectTemplate(tplZip);
    expect(template?.application).toBe('BambuStudio-02.08.03.66');
    const files = unzipSync(
      export3mf(mesh, { swaps, template, layerHeightMm: 0.08, firstLayerHeightMm: 0.16, firstFilamentHex: '#1a1a1a', sizeMm: { width: 40, height: 40 } }),
    );
    const cfg = JSON.parse(strFromU8(files[PROJECT_SETTINGS_PATH]));
    expect(cfg.layer_height).toBe('0.08');
    expect(cfg.initial_layer_print_height).toBe('0.16');
    expect(cfg.filament_colour).toEqual(['#1A1A1A']);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('<metadata name="Application">BambuStudio-02.08.03.66</metadata>');
    expect(model).toContain('<metadata name="BambuStudio:3mfVersion">1</metadata>');
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 108 108 0"');
  });

  it('rejects files that are not slicer projects', () => {
    expect(readSlicerProjectTemplate(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readSlicerProjectTemplate(zipSync({ '3D/3dmodel.model': strToU8('<model/>') }))).toBeNull();
  });

  it('escapes swap messages', () => {
    expect(buildBambuCustomGcodeXml([{ ...swaps[0], message: '<a&b>' }])).toContain('extra="&lt;a&amp;b&gt;"');
  });
});
