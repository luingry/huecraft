import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PreviewResult } from '@huecraft/engine';

export type MeshColorMode = 'printed' | 'slicer';

/** Engine colours are sRGB; three.js expects linear vertex colours. */
const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

function toLinear(src: Float32Array): Float32Array {
  const lut = SRGB_TO_LINEAR;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = lut[Math.max(0, Math.min(255, Math.round(src[i] * 255)))];
  return out;
}

interface Viewer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  mesh: THREE.Mesh | null;
  cut: { uCutZ: { value: number }; uCutColor: { value: THREE.Color } };
  framedFor: string;
  frame: () => void;
}

/**
 * Terraced 3D preview, like the slicer's layer view. `cutLayers` cuts the
 * model at the top of that layer (`maxLayerZ`) so swaps can be inspected one by one.
 */
export function MeshView({
  result,
  colorMode,
  cutLayers,
  maxLayerZ,
  background,
  resetToken,
}: {
  result: PreviewResult;
  colorMode: MeshColorMode;
  cutLayers: number;
  maxLayerZ: number;
  background: string;
  resetToken: number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    mount.appendChild(renderer.domElement);
    renderer.domElement.className = 'wb-mesh-canvas';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-0.6, -1, 1.4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(1, 0.6, 0.8);
    scene.add(fill);

    const group = new THREE.Group();
    scene.add(group);
    const cut = { uCutZ: { value: 1e6 }, uCutColor: { value: new THREE.Color() } };

    const v: Viewer = {
      renderer,
      scene,
      camera,
      controls,
      group,
      mesh: null,
      cut,
      framedFor: '',
      frame: () => {
        if (!v.mesh) return;
        const box = new THREE.Box3().setFromObject(v.mesh);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        // Fit both extents: vertical against the fov, horizontal against fov × aspect.
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const dist = Math.max((size.y * 0.6) / tanHalf, (size.x * 0.6) / (tanHalf * camera.aspect));
        controls.target.copy(center);
        // Slightly from below and to the side, like looking at a framed print on a desk.
        camera.position.set(center.x + dist * 0.18, center.y - dist * 0.72, center.z + dist * 0.72);
        camera.near = dist / 100;
        camera.far = dist * 20;
        camera.updateProjectionMatrix();
        controls.update();
      },
    };
    viewer.current = v;

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      if (v.mesh) {
        v.mesh.geometry.dispose();
        (v.mesh.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      viewer.current = null;
    };
  }, []);

  // Geometry + colours.
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const m = result.mesh;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(toLinear(colorMode === 'printed' ? m.printedColors : m.slicerColors), 3),
    );
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeVertexNormals();

    if (v.mesh) {
      v.group.remove(v.mesh);
      v.mesh.geometry.dispose();
      (v.mesh.material as THREE.Material).dispose();
    }
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    // Layer cut: everything above the cut is flattened onto it, so the model shows a
    // solid layer instead of a hollow shell. Flattened tops take the cut layer's
    // colour; walls just get shorter and keep theirs.
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, v.cut);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uCutZ;\nuniform vec3 uCutColor;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          if (transformed.z > uCutZ) {
            transformed.z = uCutZ;
            if (objectNormal.z > 0.5) vColor = uCutColor;
          }`,
        );
    };
    v.mesh = new THREE.Mesh(geo, mat);
    v.group.add(v.mesh);

    const key = `${result.sizeMm.width.toFixed(2)}x${result.sizeMm.height.toFixed(2)}`;
    if (v.framedFor !== key) {
      v.framedFor = key;
      v.frame();
    }
  }, [result, colorMode]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const active = cutLayers < result.totalLayers;
    v.cut.uCutZ.value = active ? maxLayerZ + 1e-4 : 1e6;
    const lut = colorMode === 'printed' ? result.printedLut : result.slicerLut;
    const n = Math.max(0, Math.min(cutLayers, lut.length / 3 - 1)) * 3;
    v.cut.uCutColor.value.setRGB(SRGB_TO_LINEAR[lut[n]], SRGB_TO_LINEAR[lut[n + 1]], SRGB_TO_LINEAR[lut[n + 2]]);
  }, [maxLayerZ, cutLayers, result, colorMode]);

  useEffect(() => {
    const v = viewer.current;
    if (v) v.scene.background = new THREE.Color(background);
  }, [background]);

  useEffect(() => {
    if (resetToken > 0) viewer.current?.frame();
  }, [resetToken]);

  return <div ref={mountRef} className="wb-mesh" />;
}
