import { describe, expect, it } from 'vitest';
import { buildHeightfieldMesh } from '@huecraft/mesh';
import { exportBinaryStl } from './index.js';

describe('exportBinaryStl', () => {
  it('produces valid header and triangle count', () => {
    const field = {
      width: 4,
      height: 4,
      heights: new Float32Array(16).fill(1),
    };
    const mesh = buildHeightfieldMesh(field, 0.25, 0.4);
    const buf = exportBinaryStl(mesh);
    const view = new DataView(buf);
    expect(view.getUint32(80, true)).toBe(mesh.triangleCount);
    expect(buf.byteLength).toBe(84 + mesh.triangleCount * 50);
  });
});
