import type { FilamentRecord } from '@huecraft/filament-db';
import {
  buildSwapManifest,
  export3mf,
  exportBinaryStl,
  formatSwapManifestText,
  type SwapEntry,
} from '@huecraft/exporters';
import {
  computeHeightField,
  decodeImageData,
  resizeImageData,
  type ImageData,
} from '@huecraft/image-core';
import { buildHeightfieldMesh, buildMeshVertexColors } from '@huecraft/mesh';
import {
  assignLayersFromHeight,
  computeOpticsPreview,
} from '@huecraft/optics';
import type { HueCraftProject } from '@huecraft/project-schema';

export interface PipelineInput {
  project: HueCraftProject;
  image: ImageData;
  filaments: FilamentRecord[];
  previewMaxEdge?: number;
  /** Skip STL/3MF export for fast interactive preview */
  skipExport?: boolean;
}

export interface PipelineResult {
  previewRgba: Uint8ClampedArray;
  previewWidth: number;
  previewHeight: number;
  meshTriangleCount: number;
  meshPositions: Float32Array;
  meshIndices: Uint32Array;
  meshColors: Float32Array;
  swapManifest: ReturnType<typeof buildSwapManifest>;
  swapText: string;
  stl: ArrayBuffer | null;
  threeMf: Uint8Array | null;
  timings: Record<string, number>;
}

export function runPipeline(input: PipelineInput): PipelineResult {
  const t0 = performance.now();
  const { project, filaments } = input;
  const maxEdge = input.previewMaxEdge ?? 512;
  const img = resizeImageData(input.image, maxEdge);

  const t1 = performance.now();
  const field = computeHeightField(img, project.relief, project.print.maxHeightMm);

  const t2 = performance.now();
  const { layerCounts, swapLayers } = assignLayersFromHeight(
    field,
    filaments,
    project.print.layerHeightMm,
    project.print.baseThicknessMm,
  );

  const preview = computeOpticsPreview(
    field,
    filaments,
    project.print.layerHeightMm,
    project.print.baseThicknessMm,
  );

  const t3 = performance.now();
  const mesh = buildHeightfieldMesh(field, project.print.mmPerPixel, project.print.baseThicknessMm);
  const meshColors = buildMeshVertexColors(field.width, field.height, preview.rgba);

  const t4 = performance.now();
  const skipExport = input.skipExport ?? false;
  const stl = skipExport ? null : exportBinaryStl(mesh, project.name);
  const threeMf = skipExport ? null : export3mf(mesh, project.name);

  const swaps: SwapEntry[] = swapLayers.map((layer) => {
    const fi = Math.min(filaments.length - 1, layer % filaments.length);
    const f = filaments[fi];
    return {
      layer,
      zMm: layer * project.print.layerHeightMm,
      filamentId: f.id,
      filamentName: f.name,
    };
  });

  const swapManifest = buildSwapManifest(swaps, project.print.layerHeightMm);
  const swapText = formatSwapManifestText(swapManifest);

  const t5 = performance.now();

  return {
    previewRgba: preview.rgba,
    previewWidth: preview.width,
    previewHeight: preview.height,
    meshTriangleCount: mesh.triangleCount,
    meshPositions: mesh.positions,
    meshIndices: mesh.indices,
    meshColors,
    swapManifest,
    swapText,
    stl,
    threeMf,
    timings: {
      resizeMs: t1 - t0,
      heightMs: t2 - t1,
      opticsMs: t3 - t2,
      meshMs: t4 - t3,
      exportMs: skipExport ? 0 : t5 - t4,
      totalMs: t5 - t0,
    },
  };
}

export async function loadImageFromRgba(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): Promise<ImageData> {
  return decodeImageData(width, height, rgba);
}

export type { ImageData, HueCraftProject, FilamentRecord };
