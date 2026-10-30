import type { MeshData } from '@huecraft/mesh';
import { zipSync, strToU8 } from 'fflate';

export interface SwapEntry {
  layer: number;
  zMm: number;
  filamentId: string;
  filamentName: string;
}

export interface SwapManifest {
  schemaVersion: 1;
  generatedAt: string;
  layerHeightMm: number;
  swaps: SwapEntry[];
}

export function exportBinaryStl(mesh: MeshData, name = 'huecraft'): ArrayBuffer {
  const { positions, indices, triangleCount } = mesh;
  const bufferSize = 84 + triangleCount * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(name.padEnd(80, ' ').slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(header);
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0];
    const ay = positions[i0 + 1];
    const az = positions[i0 + 2];
    const bx = positions[i1];
    const by = positions[i1 + 1];
    const bz = positions[i1 + 2];
    const cx = positions[i2];
    const cy = positions[i2 + 1];
    const cz = positions[i2 + 2];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
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

export function export3mf(mesh: MeshData, name = 'huecraft'): Uint8Array {
  const { positions, indices, triangleCount } = mesh;
  const verts = positions.length / 3;
  let verticesXml = '';
  for (let v = 0; v < verts; v++) {
    verticesXml += `<vertex x="${positions[v * 3]}" y="${positions[v * 3 + 1]}" z="${positions[v * 3 + 2]}"/>`;
  }
  let trianglesXml = '';
  for (let t = 0; t < triangleCount; t++) {
    trianglesXml += `<triangle v1="${indices[t * 3]}" v2="${indices[t * 3 + 1]}" v3="${indices[t * 3 + 2]}"/>`;
  }

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>${verticesXml}</vertices>
        <triangles>${trianglesXml}</triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(relsXml),
    '3D/3dmodel.model': strToU8(modelXml),
  });

  void name;
  return zipped;
}

export function buildSwapManifest(
  swaps: SwapEntry[],
  layerHeightMm: number,
): SwapManifest {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    layerHeightMm,
    swaps,
  };
}

export function formatSwapManifestText(manifest: SwapManifest): string {
  const lines = [
    'hueCraft Layer Swap Plan',
    `Generated: ${manifest.generatedAt}`,
    `Layer height: ${manifest.layerHeightMm} mm`,
    '',
  ];
  for (const s of manifest.swaps) {
    lines.push(`Layer ${s.layer} @ ${s.zMm.toFixed(3)} mm → ${s.filamentName} (${s.filamentId})`);
  }
  return lines.join('\n');
}
