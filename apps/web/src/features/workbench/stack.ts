import type { FilamentRecord } from '@huecraft/filament-db';

export interface StackSlot {
  slotId: string;
  filament: FilamentRecord;
}

export function cloneFilamentForStack(source: FilamentRecord): FilamentRecord {
  return {
    ...source,
    id: crypto.randomUUID(),
    lab: { ...source.lab },
    metadata: source.metadata ? { ...source.metadata } : undefined,
  };
}

export function createStackSlot(source: FilamentRecord): StackSlot {
  return {
    slotId: crypto.randomUUID(),
    filament: cloneFilamentForStack(source),
  };
}
