import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildSolidHeightfieldMesh } from '@huecraft/mesh';
import {
  BAMBU_CUSTOM_GCODE_PATH,
  build3mfModel,
  buildBambuCustomGcodeXml,
  export3mf,
  exportBambuPartsProject,
  settingsWithFilaments,
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

  it('writes AMS swaps as per-layer filament changes with one filament per slot', () => {
    const settings: Record<string, unknown> = { filament_settings_id: ['PLA'], filament_colour: ['#00AE42'], printable_area: ['0x0', '256x0', '256x256', '0x256'] };
    for (let i = 0; i < 30; i++) settings[`k${i}`] = String(i);
    const template = { application: 'BambuStudio-02.08.03.66', settings };
    const ams: SlicerSwap[] = [
      { topZMm: 0.64, kind: 'ams', extruder: 2, colorHex: '#7a7a7a', message: 'Load Gray' },
      { topZMm: 1.2, kind: 'ams', extruder: 3, colorHex: '#ffffff', message: 'Load White' },
    ];
    const files = unzipSync(export3mf(mesh, { swaps: ams, template, filamentColours: ['#000000', '#7a7a7a', '#ffffff'], firstFilamentHex: '#000000' }));
    const bambu = strFromU8(files[BAMBU_CUSTOM_GCODE_PATH]);
    expect(bambu).toContain('<layer top_z="0.64" type="2" extruder="2" color="#7a7a7a" extra="" gcode="tool_change"/>');
    expect(bambu).toContain('<layer top_z="1.2" type="2" extruder="3" color="#ffffff" extra="" gcode="tool_change"/>');
    expect(bambu).toContain('<mode value="MultiAsSingle"/>');
    expect(strFromU8(files[PRUSA_CUSTOM_GCODE_PATH])).toContain('<code print_z="0.64" type="2" extruder="2"');
    const cfg = JSON.parse(strFromU8(files[PROJECT_SETTINGS_PATH]));
    expect(cfg.filament_colour).toEqual(['#000000', '#7A7A7A', '#FFFFFF']);
    expect(cfg.filament_settings_id).toEqual(['PLA', 'PLA', 'PLA']);
  });

  it('escapes swap messages', () => {
    expect(buildBambuCustomGcodeXml([{ ...swaps[0], message: '<a&b>' }])).toContain('extra="&lt;a&amp;b&gt;"');
  });
});

describe('Bambu parts project', () => {
  const settings: Record<string, unknown> = {
    filament_settings_id: ['PLA'],
    filament_type: ['PLA'],
    filament_colour: ['#00AE42'],
    nozzle_temperature: ['220'],
    nozzle_diameter: ['0.4'],
    filament_self_index: ['1'],
    inherits_group: ['p', 'f', 'm'],
    flush_volumes_matrix: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? '0' : '280')),
    flush_volumes_vector: Array(8).fill('1'),
    printable_area: ['0x0', '256x0', '256x256', '0x256'],
  };

  it('grows every per-filament setting to the filaments needed', () => {
    const s = settingsWithFilaments(settings, ['#ffffff', '#ff0000', '#000000', '#00ff00', '#0000ff']);
    expect(s.filament_colour).toEqual(['#FFFFFF', '#FF0000', '#000000', '#00FF00', '#0000FF']);
    expect(s.filament_settings_id).toEqual(Array(5).fill('PLA'));
    expect(s.nozzle_temperature).toEqual(Array(5).fill('220'));
    expect(s.filament_self_index).toEqual(['1', '2', '3', '4', '5']);
    expect(s.inherits_group).toEqual(['p', 'f', 'f', 'f', 'f', 'f', 'm']);
    expect(s.nozzle_diameter).toEqual(['0.4']);
    expect(s.printable_area).toEqual(settings.printable_area);
    expect((s.flush_volumes_matrix as string[]).length).toBe(25);
    expect((s.flush_volumes_vector as string[]).length).toBe(10);
  });

  it('sizes the flush matrix to exactly the filament count once filaments are added', () => {
    // A 4×4 matrix for 3 filaments makes Bambu Studio fail slicing (-100).
    const s = settingsWithFilaments(settings, ['#000000', '#ff0000', '#ffffff']);
    expect(s.flush_volumes_matrix).toEqual(['0', '280', '280', '280', '0', '280', '280', '280', '0']);
    expect((s.flush_volumes_vector as string[]).length).toBe(6);
    // A single filament keeps the template's own matrix.
    expect(settingsWithFilaments(settings, ['#000000']).flush_volumes_matrix).toBe(settings.flush_volumes_matrix);
  });

  it('writes one part per filament with its extruder', () => {
    const two = { positions: new Float32Array([...mesh.positions, ...mesh.positions]), indices: new Uint32Array([...mesh.indices, ...Array.from(mesh.indices, (i) => i + mesh.positions.length / 3)]), triangleCount: mesh.triangleCount * 2 };
    const bytes = exportBambuPartsProject(two, {
      name: 'fd',
      template: { application: 'BambuStudio-02.08.03.66', settings: { ...settings, filament_settings_id: Array(30).fill('x').slice(0, 30) } },
      volumes: [
        { name: '1 · Clear', extruder: 1, firstTriangle: 0, lastTriangle: mesh.triangleCount - 1 },
        { name: '2 · Red', extruder: 2, firstTriangle: mesh.triangleCount, lastTriangle: 2 * mesh.triangleCount - 1 },
      ],
      filamentColours: ['#e4ecf0', '#ff0000'],
      layerHeightMm: 0.08,
      firstLayerHeightMm: 0.16,
      sizeMm: { width: 40, height: 40 },
    });
    const files = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
    expect(files['3D/3dmodel.model']).toContain('<metadata name="Application">BambuStudio-02.08.03.66</metadata>');
    expect(files['3D/3dmodel.model'].match(/p:path="\/3D\/Objects\/object_1.model"/g)).toHaveLength(2);
    expect(files['3D/Objects/object_1.model'].match(/<object id=/g)).toHaveLength(2);
    expect(files['Metadata/model_settings.config']).toMatch(/<part id="2" subtype="normal_part">\s*<metadata key="name" value="2 · Red"\/>[\s\S]*?<metadata key="extruder" value="2"\/>/);
    const project = JSON.parse(files[PROJECT_SETTINGS_PATH]);
    expect(project.filament_colour.slice(0, 2)).toEqual(['#E4ECF0', '#FF0000']);
    expect(project.layer_height).toBe('0.08');
  });
});
