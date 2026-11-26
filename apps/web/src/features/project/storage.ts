import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_PRINT,
  validateProject,
  type HueCraftProject,
  type PrintParams,
  type SwapCommand,
} from '@huecraft/project-schema';

export interface StoredProject {
  id: string;
  project: HueCraftProject;
  /** Original image file (PNG/JPG/WebP), decoded on open. */
  imageBlob?: Blob;
  /** Small JPEG data URL for the recent-projects list. */
  thumbnail?: string;
  updatedAt: string;
}

/** A Bambu Studio / OrcaSlicer project used to make exports open as slicer projects. */
export interface SlicerTemplate {
  fileName: string;
  application: string;
  bytes: Uint8Array;
}

interface StoredSetting {
  key: string;
  value: unknown;
}

class ProjectDatabase extends Dexie {
  projects!: Table<StoredProject, string>;
  settings!: Table<StoredSetting, string>;

  constructor() {
    super('huecraft-projects');
    this.version(1).stores({ projects: 'id, updatedAt' });
    // v2: imageBlob is the original encoded file; v1 stored raw RGBA without dimensions.
    this.version(2)
      .stores({ projects: 'id, updatedAt' })
      .upgrade((tx) =>
        tx
          .table('projects')
          .toCollection()
          .modify((row: StoredProject) => {
            row.project = validateProject(row.project);
            delete row.imageBlob;
          }),
      );
    this.version(3).stores({ projects: 'id, updatedAt', settings: 'key' });
  }
}

const db = new ProjectDatabase();
const LAST_KEY = 'huecraft:last-project';

export async function saveProject(
  project: HueCraftProject,
  imageBlob: Blob | undefined,
  thumbnail: string | undefined,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db.projects.put({
    id: project.id,
    project: { ...project, updatedAt },
    imageBlob,
    thumbnail,
    updatedAt,
  });
  writePref(LAST_KEY, project.id);
}

export async function loadProject(id: string): Promise<StoredProject | undefined> {
  const row = await db.projects.get(id);
  if (!row) return undefined;
  return { ...row, project: validateProject(row.project) };
}

export async function loadLastProject(): Promise<StoredProject | undefined> {
  const id = readPref(LAST_KEY);
  return id ? loadProject(id) : undefined;
}

export async function listProjects(limit = 12): Promise<StoredProject[]> {
  return db.projects.orderBy('updatedAt').reverse().limit(limit).toArray();
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}

/* ---------- Slicer template ---------- */

const TEMPLATE_KEY = 'slicer-template';
/** Disk copy served by the dev server (vite.config.ts); absent on a static host. */
const TEMPLATE_DISK_URL = '/__huecraft/slicer-template';
const HAS_DISK_STORE = import.meta.env.DEV;

async function loadTemplateFromDisk(): Promise<SlicerTemplate | null> {
  if (!HAS_DISK_STORE) return null;
  try {
    const res = await fetch(TEMPLATE_DISK_URL);
    const fileName = res.headers.get('X-File-Name');
    if (res.status !== 200 || !fileName) return null;
    return {
      fileName: decodeURIComponent(fileName),
      application: decodeURIComponent(res.headers.get('X-Application') ?? ''),
      bytes: new Uint8Array(await res.arrayBuffer()),
    };
  } catch {
    return null;
  }
}

async function saveTemplateToDisk(t: SlicerTemplate | null): Promise<void> {
  if (!HAS_DISK_STORE) return;
  try {
    if (!t) {
      await fetch(TEMPLATE_DISK_URL, { method: 'DELETE' });
      return;
    }
    const q = new URLSearchParams({ fileName: t.fileName, application: t.application });
    await fetch(`${TEMPLATE_DISK_URL}?${q}`, { method: 'PUT', body: t.bytes as BlobPart });
  } catch {
    /* no local server: the IndexedDB copy is all there is */
  }
}

/** Asks the browser not to evict our storage (the template lives there). */
function requestPersistentStorage(): void {
  navigator.storage?.persist?.().catch(() => undefined);
}

/**
 * The template used by every project. Read from IndexedDB first, then from the
 * disk copy (another origin, cleared storage), which is written back to IndexedDB.
 */
export async function loadSlicerTemplate(): Promise<SlicerTemplate | null> {
  const row = await db.settings.get(TEMPLATE_KEY).catch(() => undefined);
  const stored = (row?.value as SlicerTemplate | undefined) ?? null;
  if (stored) {
    requestPersistentStorage();
    // Templates chosen before the disk copy existed: back them up once.
    void loadTemplateFromDisk().then((disk) => (disk ? undefined : saveTemplateToDisk(stored)));
    return stored;
  }
  const disk = await loadTemplateFromDisk();
  if (disk) await db.settings.put({ key: TEMPLATE_KEY, value: disk }).catch(() => undefined);
  return disk;
}

export async function saveSlicerTemplate(t: SlicerTemplate | null): Promise<void> {
  if (t) {
    await db.settings.put({ key: TEMPLATE_KEY, value: t });
    requestPersistentStorage();
  } else await db.settings.delete(TEMPLATE_KEY);
  await saveTemplateToDisk(t);
}

/* ---------- UI preferences (per browser, best effort) ---------- */

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preferences are optional */
  }
}

const PRINT_DEFAULTS_KEY = 'huecraft:print-defaults';

export interface PrinterDefaults {
  print: PrintParams;
  swapCommand: SwapCommand;
}

export function readPrinterDefaults(): PrinterDefaults | null {
  const raw = readPref(PRINT_DEFAULTS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PrinterDefaults>;
    return {
      print: { ...DEFAULT_PRINT, ...parsed.print },
      swapCommand: parsed.swapCommand === 'color-change' || parsed.swapCommand === 'ams' ? parsed.swapCommand : 'pause',
    };
  } catch {
    return null;
  }
}

export function writePrinterDefaults(d: PrinterDefaults): void {
  writePref(PRINT_DEFAULTS_KEY, JSON.stringify(d));
}

/* ---------- Files ---------- */

export async function saveFile(bytes: Uint8Array | string, fileName: string, mimeType: string): Promise<boolean> {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const picker = (window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  if (picker) {
    const ext = fileName.slice(fileName.lastIndexOf('.'));
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [{ description: ext.slice(1).toUpperCase(), accept: { [mimeType]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      // Fall through to a plain download when the picker is blocked.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
