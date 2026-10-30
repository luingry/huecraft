import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PreviewResult } from '@huecraft/engine';

export type MeshColorMode = 'printed' | 'slicer';

export interface MeshBrush {
  /** Diameter in mm. */
  sizeMm: number;
  softness: number;
  /** Ring colour (the painted filament). */
  colorHex: string;
  erase: boolean;
}

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

const RING_SEGMENTS = 64;

/** Unit circle in the XY plane, drawn on top of the model. */
function makeRing(): THREE.LineLoop {
  const pts = new Float32Array(RING_SEGMENTS * 3);
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    pts[i * 3] = Math.cos(a);
    pts[i * 3 + 1] = Math.sin(a);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false });
  const ring = new THREE.LineLoop(geo, mat);
  ring.renderOrder = 999;
  return ring;
}

interface Hit {
  u: number;
  v: number;
  z: number;
  /** Layer count of the column hit. */
  layer: number;
}

interface Viewer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  mesh: THREE.Mesh | null;
  cut: { uCutZ: { value: number }; uCutColor: { value: THREE.Color } };
  cursor: { group: THREE.Group; outer: THREE.LineLoop; inner: THREE.LineLoop };
  framedFor: string;
  frame: () => void;
}

/**
 * Terraced 3D preview, like the slicer's layer view. `cutLayers` cuts the
 * model at the top of that layer (`maxLayerZ`) so swaps can be inspected one by one.
 * With a `brush`, left-drag paints strokes on the surface and right-click asks
 * for the brush menu; orbiting moves to the middle button or Alt + left.
 */
export function MeshView({
  result,
  colorMode,
  cutLayers,
  maxLayerZ,
  layerZ,
  background,
  resetToken,
  brush,
  onStroke,
  onBrushMenu,
}: {
  result: PreviewResult;
  colorMode: MeshColorMode;
  cutLayers: number;
  maxLayerZ: number;
  /** Z of the top of layer `index` (0-based). */
  layerZ: (index: number) => number;
  background: string;
  resetToken: number;
  brush: MeshBrush | null;
  /**
   * Stroke in image space (u, v pairs, v down); `done` on release.
   * `sampleLayer` is the layer count under the brush centre when it began.
   */
  onStroke: (id: string, points: number[], done: boolean, sampleLayer: number) => void;
  onBrushMenu: (x: number, y: number) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  // Latest props for the native event handlers, which are registered once.
  const live = useRef({ result, brush, onStroke, onBrushMenu, layerZ, cutZ: 1e6 });
  live.current = { ...live.current, result, brush, onStroke, onBrushMenu, layerZ };

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
    const cursor = { group: new THREE.Group(), outer: makeRing(), inner: makeRing() };
    cursor.group.add(cursor.outer, cursor.inner);
    cursor.group.visible = false;
    scene.add(cursor.group);

    const v: Viewer = {
      renderer,
      scene,
      camera,
      controls,
      group,
      mesh: null,
      cut,
      cursor,
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

    /* ---------- brush ---------- */

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    /** Ray-marches the layer field: far cheaper than raycasting a million triangles. */
    const hitTest = (clientX: number, clientY: number): Hit | null => {
      const { result: r, layerZ: zOf, cutZ } = live.current;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const { origin: o, direction: d } = raycaster.ray;
      const W = r.sizeMm.width;
      const H = r.sizeMm.height;
      // Slab test against the model's bounding box.
      const lo = [0, 0, 0];
      const hi = [W, H, Math.min(r.sizeMm.z, cutZ) + 1e-3];
      const oa = [o.x, o.y, o.z];
      const da = [d.x, d.y, d.z];
      let t0 = 0;
      let t1 = Infinity;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(da[k]) < 1e-12) {
          if (oa[k] < lo[k] || oa[k] > hi[k]) return null;
          continue;
        }
        let a = (lo[k] - oa[k]) / da[k];
        let b = (hi[k] - oa[k]) / da[k];
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (t0 > t1) return null;

      const gw = r.width;
      const gh = r.height;
      const layerAt = (x: number, y: number) => {
        const cx = Math.min(gw - 1, Math.max(0, Math.floor((x / W) * gw)));
        const cy = Math.min(gh - 1, Math.max(0, Math.floor(((H - y) / H) * gh)));
        return r.layerField[cy * gw + cx];
      };
      const surface = (x: number, y: number) => {
        const n = layerAt(x, y);
        return n > 0 ? Math.min(zOf(n - 1), cutZ) : 0;
      };
      const below = (t: number) => o.z + d.z * t <= surface(o.x + d.x * t, o.y + d.y * t);
      // Half a cell horizontally per step; bisect the crossing afterwards.
      const step = (Math.min(W / gw, H / gh) * 0.5) / Math.max(1e-3, Math.hypot(d.x, d.y));
      let prev = t0;
      for (let t = t0; ; t += step) {
        const tc = Math.min(t, t1);
        if (below(tc)) {
          let a = prev;
          let b = tc;
          for (let i = 0; i < 12; i++) {
            const m = (a + b) / 2;
            if (below(m)) b = m;
            else a = m;
          }
          const x = o.x + d.x * b;
          const y = o.y + d.y * b;
          return {
            u: Math.min(1, Math.max(0, x / W)),
            v: Math.min(1, Math.max(0, (H - y) / H)),
            z: o.z + d.z * b,
            layer: layerAt(x, y),
          };
        }
        if (tc >= t1) return null;
        prev = tc;
      }
    };

    const placeCursor = (hit: Hit | null) => {
      const b = live.current.brush;
      if (!hit || !b) {
        cursor.group.visible = false;
        return;
      }
      const r = live.current.result;
      const radius = b.sizeMm / 2;
      const inner = radius * (1 - b.softness);
      cursor.group.visible = true;
      cursor.group.position.set(hit.u * r.sizeMm.width, (1 - hit.v) * r.sizeMm.height, hit.z + 0.02);
      cursor.outer.scale.setScalar(radius);
      cursor.inner.visible = b.softness > 0.02 && inner > 0.05;
      cursor.inner.scale.setScalar(Math.max(0.01, inner));
      (cursor.outer.material as THREE.LineBasicMaterial).color.set(b.erase ? '#ff6b6b' : '#ffffff');
      (cursor.inner.material as THREE.LineBasicMaterial).color.set(b.erase ? '#ff6b6b' : b.colorHex);
    };

    let stroke: { id: string; points: number[]; pointerId: number; sampleLayer: number } | null = null;

    const addPoint = (hit: Hit) => {
      if (!stroke) return;
      const { brush: b, result: r } = live.current;
      const pts = stroke.points;
      if (pts.length >= 2 && b) {
        // Space points at 1/16 of the diameter (in mm) to keep strokes small.
        const du = (hit.u - pts[pts.length - 2]) * r.sizeMm.width;
        const dv = (hit.v - pts[pts.length - 1]) * r.sizeMm.height;
        if (Math.hypot(du, dv) < Math.max(0.05, b.sizeMm / 16)) return;
      }
      pts.push(hit.u, hit.v);
      live.current.onStroke(stroke.id, pts.slice(), false, stroke.sampleLayer);
    };

    // Capture phase on the wrapper runs before OrbitControls (on the canvas), so
    // painting and the brush menu can swallow the events it would act on.
    const onPointerDown = (e: PointerEvent) => {
      if (!live.current.brush || spaceHeld) return;
      if (e.button === 2) {
        e.stopPropagation();
        return;
      }
      if (e.button !== 0 || e.altKey) return;
      e.stopPropagation();
      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) return;
      mount.setPointerCapture(e.pointerId);
      stroke = { id: crypto.randomUUID(), points: [], pointerId: e.pointerId, sampleLayer: hit.layer };
      addPoint(hit);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!live.current.brush) return;
      if (spaceHeld && !stroke) {
        cursor.group.visible = false;
        return;
      }
      const hit = hitTest(e.clientX, e.clientY);
      placeCursor(hit);
      if (stroke && stroke.pointerId === e.pointerId && hit) addPoint(hit);
    };
    const endStroke = (e: PointerEvent) => {
      if (!stroke || stroke.pointerId !== e.pointerId) return;
      live.current.onStroke(stroke.id, stroke.points.slice(), true, stroke.sampleLayer);
      stroke = null;
    };
    const onLeave = () => {
      hovered = false;
      if (!stroke) cursor.group.visible = false;
    };
    const onEnter = () => {
      hovered = true;
    };

    /* ---------- hold Space to pan ---------- */

    // While Space is held, a left drag pans instead of orbiting or painting.
    let hovered = false;
    let spaceHeld = false;
    const setSpace = (on: boolean) => {
      if (spaceHeld === on) return;
      spaceHeld = on;
      controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      mount.dataset.pan = String(on);
      if (on) cursor.group.visible = false;
    };
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return;
      if (!hovered && !spaceHeld) return;
      // Keep the page from scrolling and focused buttons from clicking.
      e.preventDefault();
      setSpace(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    const onBlur = () => setSpace(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    mount.addEventListener('pointerenter', onEnter);
    const onContextMenu = (e: MouseEvent) => {
      if (!live.current.brush) return;
      e.preventDefault();
      e.stopPropagation();
      live.current.onBrushMenu(e.clientX, e.clientY);
    };
    mount.addEventListener('pointerdown', onPointerDown, true);
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerup', endStroke);
    mount.addEventListener('pointercancel', endStroke);
    mount.addEventListener('pointerleave', onLeave);
    mount.addEventListener('contextmenu', onContextMenu, true);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      mount.removeEventListener('pointerdown', onPointerDown, true);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerup', endStroke);
      mount.removeEventListener('pointercancel', endStroke);
      mount.removeEventListener('pointerleave', onLeave);
      mount.removeEventListener('contextmenu', onContextMenu, true);
      mount.removeEventListener('pointerenter', onEnter);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      if (v.mesh) {
        v.mesh.geometry.dispose();
        (v.mesh.material as THREE.Material).dispose();
      }
      for (const ring of [cursor.outer, cursor.inner]) {
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
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
    live.current.cutZ = v.cut.uCutZ.value;
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

  // Brush mode: the left button paints, so orbiting moves to the middle button
  // (Alt + left also orbits: the capture handler lets it through).
  const brushOn = brush !== null;
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.controls.mouseButtons.MIDDLE = brushOn ? THREE.MOUSE.ROTATE : THREE.MOUSE.DOLLY;
    if (!brushOn) v.cursor.group.visible = false;
  }, [brushOn]);

  return <div ref={mountRef} className="wb-mesh" data-brush={brushOn} />;
}
