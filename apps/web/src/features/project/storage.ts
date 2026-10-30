import Dexie, { type Table } from 'dexie';
import type { HueCraftProject } from '@huecraft/project-schema';

export interface StoredProject {
  id: string;
  project: HueCraftProject;
  imageBlob?: Blob;
  updatedAt: string;
}

class ProjectDatabase extends Dexie {
  projects!: Table<StoredProject, string>;

  constructor() {
    super('huecraft-projects');
    this.version(1).stores({ projects: 'id, updatedAt' });
  }
}

const db = new ProjectDatabase();

export async function saveProject(
  project: HueCraftProject,
  imageBlob?: Blob,
): Promise<void> {
  project.updatedAt = new Date().toISOString();
  await db.projects.put({
    id: project.id,
    project,
    imageBlob,
    updatedAt: project.updatedAt,
  });
}

export async function loadProject(id: string): Promise<StoredProject | undefined> {
  return db.projects.get(id);
}

export async function listProjects(): Promise<StoredProject[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}

export async function saveImageToOpfs(projectId: string, blob: Blob): Promise<string> {
  if (!('storage' in navigator && navigator.storage.getDirectory)) {
    return `idb:${projectId}`;
  }
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('huecraft-images', { create: true });
  const file = await dir.getFileHandle(`${projectId}.bin`, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
  return `opfs:${projectId}`;
}

export async function loadImageFromOpfs(projectId: string): Promise<Blob | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('huecraft-images');
    const file = await dir.getFileHandle(`${projectId}.bin`);
    const f = await file.getFile();
    return f;
  } catch {
    return null;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
