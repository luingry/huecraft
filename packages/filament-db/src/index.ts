import Dexie, { type Table } from 'dexie';
import type { FilamentRecord } from './types.js';
import { STARTER_FILAMENTS } from './types.js';

export class FilamentDatabase extends Dexie {
  filaments!: Table<FilamentRecord, string>;

  constructor(name = 'huecraft-filaments') {
    super(name);
    this.version(1).stores({
      filaments: 'id, name, brand, source',
    });
  }
}

let db: FilamentDatabase | null = null;

export function getFilamentDb(): FilamentDatabase {
  if (!db) db = new FilamentDatabase();
  return db;
}

export async function seedFilamentDbIfEmpty(): Promise<void> {
  const database = getFilamentDb();
  const count = await database.filaments.count();
  if (count === 0) {
    await database.filaments.bulkAdd(STARTER_FILAMENTS);
  }
}

export async function listFilaments(): Promise<FilamentRecord[]> {
  await seedFilamentDbIfEmpty();
  return getFilamentDb().filaments.toArray();
}

export async function upsertFilament(f: FilamentRecord): Promise<void> {
  await getFilamentDb().filaments.put(f);
}

export async function deleteFilament(id: string): Promise<void> {
  await getFilamentDb().filaments.delete(id);
}

export async function getFilament(id: string): Promise<FilamentRecord | undefined> {
  return getFilamentDb().filaments.get(id);
}

export * from './types.js';
