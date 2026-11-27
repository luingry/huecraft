import * as THREE from 'three';
import type { Toolpaths } from './toolpath';

/**
 * Extrusion lines as instanced tubes, like a slicer's G-code preview: one
 * instance per segment, a flattened hexagon (line width × layer height) swept
 * along it, with pointed caps that fill the joints between segments.
 */

const SIDES = 6;

/** Unit tube: position.x = t along the segment (0..1), (y, z) = profile on the unit circle; normal.x = cap extension (-1, 0, +1). */
function unitTube(): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let end = 0; end < 2; end++) {
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2;
      pos.push(end, Math.cos(a), Math.sin(a));
      nrm.push(0, Math.cos(a), Math.sin(a));
    }
  }
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    idx.push(i, j, SIDES + j, i, SIDES + j, SIDES + i);
  }
  // Caps: a tip half a line width beyond each end.
  const tip0 = pos.length / 3;
  pos.push(0, 0, 0);
  nrm.push(-1, 0, 0);
  const tip1 = tip0 + 1;
  pos.push(1, 0, 0);
  nrm.push(1, 0, 0);
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    idx.push(tip0, j, i);
    idx.push(tip1, SIDES + i, SIDES + j);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export interface TubeUniforms {
  uHalfW: { value: number };
}

export function buildTubes(tp: Toolpaths, lineWidthMm: number): { mesh: THREE.Mesh; uniforms: TubeUniforms } {
  const g = unitTube();
  g.setAttribute('aSeg', new THREE.InstancedBufferAttribute(tp.segments, 4));
  g.setAttribute('aZ', new THREE.InstancedBufferAttribute(tp.z, 2));
  g.setAttribute('color', new THREE.InstancedBufferAttribute(new Float32Array(tp.count * 3), 3));
  g.instanceCount = tp.count;
  const uniforms: TubeUniforms = { uHalfW: { value: lineWidthMm / 2 } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSeg;\nattribute vec2 aZ;\nuniform float uHalfW;')
      .replace(
        '#include <beginnormal_vertex>',
        `vec2 tpD = aSeg.zw - aSeg.xy;
        float tpL = length(tpD);
        vec2 tpU = tpL > 1e-6 ? tpD / tpL : vec2(1.0, 0.0);
        vec2 tpN = vec2(-tpU.y, tpU.x);
        float tpHalfH = aZ.y * 0.5;
        // Ellipse normal ∝ (cos/a, sin/b); caps point along the segment.
        vec3 objectNormal = normalize(vec3(tpU * normal.x + tpN * (normal.y / uHalfW), normal.z / tpHalfH));`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec2 tpXY = mix(aSeg.xy, aSeg.zw, position.x) + tpU * (normal.x * uHalfW) + tpN * (position.y * uHalfW);
        vec3 transformed = vec3(tpXY, aZ.x - tpHalfH + position.z * tpHalfH);`,
      );
  };
  const mesh = new THREE.Mesh(g, mat);
  // The unit geometry's bounds say nothing about the instances.
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/** Colours each segment by its layer from an sRGB LUT indexed by layer count (layer k → entry k + 1). */
export function colorTubes(mesh: THREE.Mesh, tp: Toolpaths, lut: Uint8Array, srgbToLinear: Float32Array): void {
  const attr = mesh.geometry.getAttribute('color') as THREE.InstancedBufferAttribute;
  const c = attr.array as Float32Array;
  const entries = lut.length / 3;
  for (let i = 0; i < tp.count; i++) {
    const e = Math.min(entries - 1, tp.layer[i] + 1) * 3;
    // Outer walls a touch darker, like the slight shading between lines in a slicer.
    const shade = tp.kind[i] === 0 ? 0.88 : 1;
    c[i * 3] = srgbToLinear[lut[e]] * shade;
    c[i * 3 + 1] = srgbToLinear[lut[e + 1]] * shade;
    c[i * 3 + 2] = srgbToLinear[lut[e + 2]] * shade;
  }
  attr.needsUpdate = true;
}
