import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { tokens } from '@huecraft/design-system';

export interface MeshGeometryData {
  positions: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
}

type ViewerContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  mesh: THREE.Mesh | null;
  framedVertexCount: number;
  applyGeometry: (data: MeshGeometryData | null) => void;
};

export function MeshPreview({ geometry }: { geometry: MeshGeometryData | null }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerContext | null>(null);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(tokens.color.surfaceRaised);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    mount.appendChild(canvas);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 1.1;
    controls.screenSpacePanning = true;
    controls.panSpeed = 0.9;

    const light = new THREE.DirectionalLight(0xffffff, 0.45);
    light.position.set(0.6, 0.8, 1.2);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.82));

    let mesh: THREE.Mesh | null = null;
    let framedVertexCount = 0;

    const frameMesh = (target: THREE.Mesh) => {
      const box = new THREE.Box3().setFromObject(target);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      target.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z, 1);
      const dist = maxDim * 2.2;
      camera.position.set(dist * 0.55, dist * 0.45, dist * 0.75);
      controls.target.set(0, 0, size.z * 0.1);
      controls.update();
    };

    const applyGeometry = (data: MeshGeometryData | null) => {
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh = null;
      }
      if (!data) return;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
      geo.computeVertexNormals();

      mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          metalness: 0,
          roughness: 0.9,
        }),
      );
      scene.add(mesh);

      if (framedVertexCount !== data.positions.length) {
        frameMesh(mesh);
        framedVertexCount = data.positions.length;
      } else if (mesh) {
        mesh.geometry.attributes.color.needsUpdate = true;
      }
    };

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    viewerRef.current = {
      scene,
      camera,
      renderer,
      controls,
      mesh,
      framedVertexCount,
      applyGeometry,
    };
    applyGeometry(geometryRef.current);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      applyGeometry(null);
      renderer.dispose();
      if (canvas.parentElement === mount) mount.removeChild(canvas);
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewerRef.current?.applyGeometry(geometry);
  }, [geometry]);

  return (
    <div
      ref={mountRef}
      title="Drag rotate · Right-drag pan · Scroll zoom"
      onPointerDown={() => {
        if (mountRef.current) mountRef.current.style.cursor = 'grabbing';
      }}
      onPointerUp={() => {
        if (mountRef.current) mountRef.current.style.cursor = 'grab';
      }}
      onPointerLeave={() => {
        if (mountRef.current) mountRef.current.style.cursor = 'grab';
      }}
      style={{
        flex: 1,
        minHeight: 320,
        width: '100%',
        borderRadius: tokens.radius.md,
        overflow: 'hidden',
        border: `1px solid ${tokens.color.border}`,
        cursor: 'grab',
        position: 'relative',
      }}
    />
  );
}
