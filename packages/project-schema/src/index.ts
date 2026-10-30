export type ReliefMode = 'luminance' | 'contrast' | 'palette' | 'reference';

export interface ReliefParams {
  mode: ReliefMode;
  contrast: number;
  gamma: number;
  paletteColors: string[];
  referenceAnchors: Array<{ color: string; height: number }>;
}

export interface PrintParams {
  layerHeightMm: number;
  baseThicknessMm: number;
  maxHeightMm: number;
  mmPerPixel: number;
}

export interface StackEntry {
  filamentId: string;
  layerCount: number;
}

export interface HueCraftProject {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  relief: ReliefParams;
  print: PrintParams;
  stack: StackEntry[];
  imageRef?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export const PROJECT_SCHEMA_VERSION = 1 as const;

export function createEmptyProject(name = 'Untitled'): HueCraftProject {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    relief: {
      mode: 'luminance',
      contrast: 1,
      gamma: 1,
      paletteColors: [],
      referenceAnchors: [],
    },
    print: {
      layerHeightMm: 0.08,
      baseThicknessMm: 0.4,
      maxHeightMm: 3.2,
      mmPerPixel: 0.25,
    },
    stack: [],
  };
}

export function validateProject(data: unknown): HueCraftProject {
  if (!data || typeof data !== 'object') throw new Error('Invalid project');
  const p = data as HueCraftProject;
  if (p.schemaVersion !== 1) throw new Error(`Unsupported schema version`);
  if (!p.id || !p.name) throw new Error('Missing id or name');
  return p;
}
