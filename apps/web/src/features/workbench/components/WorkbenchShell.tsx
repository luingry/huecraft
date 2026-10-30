import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FilamentRecord } from '@huecraft/filament-db';
import { listFilaments, upsertFilament, createFilamentFromHex } from '@huecraft/filament-db';
import { createEmptyProject, type HueCraftProject } from '@huecraft/project-schema';
import { Button, Panel, tokens } from '@huecraft/design-system';
import { downloadBlob, saveProject } from '../../project/storage';
import { useEnginePipeline } from '../hooks/useEnginePipeline';
import { FilamentStackPanel } from './FilamentStackPanel';
import { PreviewCanvas } from './PreviewCanvas';
import { MeshPreview } from './MeshPreview';
import { LoadingOverlay } from './LoadingOverlay';
import { SwapTimeline } from './SwapTimeline';
import { PropertiesRail, FilamentEditorModal, CalibrationAssistant } from './PropertiesRail';
import { createStackSlot, type StackSlot } from '../stack';

export function WorkbenchShell() {
  const [project, setProject] = useState<HueCraftProject>(() => createEmptyProject());
  const [filaments, setFilaments] = useState<FilamentRecord[]>([]);
  const [stackSlots, setStackSlots] = useState<StackSlot[]>([]);
  const [image, setImage] = useState<{ width: number; height: number; rgba: Uint8ClampedArray } | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const [editSlot, setEditSlot] = useState<StackSlot | null>(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { result, loading, stage, error, run, runFull } = useEnginePipeline();

  useEffect(() => {
    listFilaments().then((f) => {
      setFilaments(f);
      if (stackSlots.length === 0 && f.length >= 2) {
        setStackSlots([createStackSlot(f[0]), createStackSlot(f[1])]);
      }
    });
  }, []);

  const stackFilaments = stackSlots.map((slot) => slot.filament);

  const pipelineInput = useMemo(
    () => (image && stackFilaments.length > 0 ? { project, image, filaments: stackFilaments } : null),
    [image, stackSlots, project],
  );

  const triggerPipeline = useCallback(
    (fast = false) => {
      if (!pipelineInput) return;
      run(pipelineInput, fast);
    },
    [pipelineInput, run],
  );

  const stackFilamentKey = stackSlots
    .map((slot) => `${slot.slotId}:${slot.filament.colorHex}:${slot.filament.tdMm}:${slot.filament.lab.l},${slot.filament.lab.a},${slot.filament.lab.b}`)
    .join('|');

  useEffect(() => {
    triggerPipeline(true);
  }, [project.relief, project.print, stackFilamentKey, image]);

  const handleImageFile = async (file: File) => {
    setImageLoading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const w = bitmap.width;
      const h = bitmap.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, w, h);
      setImage({ width: w, height: h, rgba: data.data });
      setProject((p) => ({ ...p, name: file.name.replace(/\.[^.]+$/, '') }));
      bitmap.close();
    } finally {
      setImageLoading(false);
    }
  };

  const ensureExport = async () => {
    if (!pipelineInput) return null;
    if (result?.stl && result?.threeMf) return result;
    return runFull(pipelineInput);
  };

  const handleSave = async () => {
    await saveProject(
      project,
      image ? new Blob([new Uint8Array(image.rgba)]) : undefined,
    );
  };

  const handleExportStl = async () => {
    const res = await ensureExport();
    if (!res?.stl) return;
    downloadBlob(new Blob([res.stl]), `${project.name}.stl`);
  };

  const handleExport3mf = async () => {
    const res = await ensureExport();
    if (!res?.threeMf) return;
    downloadBlob(new Blob([new Uint8Array(res.threeMf)]), `${project.name}.3mf`);
  };

  const handleExportSwap = () => {
    if (!result) return;
    downloadBlob(
      new Blob([JSON.stringify(result.swapManifest, null, 2)], { type: 'application/json' }),
      `${project.name}.hcswap.json`,
    );
    downloadBlob(new Blob([result.swapText], { type: 'text/plain' }), `${project.name}.hcswap.txt`);
  };

  const meshGeometry = useMemo(
    () =>
      result
        ? {
            positions: result.meshPositions,
            indices: result.meshIndices,
            colors: result.meshColors,
          }
        : null,
    [result?.meshPositions, result?.meshIndices, result?.meshColors],
  );

  const overlayStage = imageLoading ? 'decoding' : stage;

  const updateRelief = (patch: Partial<typeof project.relief>) =>
    setProject((p) => ({ ...p, relief: { ...p.relief, ...patch } }));
  const updatePrint = (patch: Partial<typeof project.print>) =>
    setProject((p) => ({ ...p, print: { ...p.print, ...patch } }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: `1px solid ${tokens.color.border}`,
          background: tokens.color.surface,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>hueCraft</span>
        <span style={{ color: tokens.color.textMuted, fontSize: 13 }}>{project.name}</span>
        {imageLoading && (
          <span style={{ fontSize: 11, color: tokens.color.accent, fontFamily: tokens.font.mono }}>decoding…</span>
        )}
        {!imageLoading && loading && (
          <span
            style={{
              fontSize: 11,
              color: tokens.color.accent,
              fontFamily: tokens.font.mono,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                border: `2px solid ${tokens.color.border}`,
                borderTopColor: tokens.color.accent,
                borderRadius: '50%',
                display: 'inline-block',
                animation: 'huecraft-spin 0.75s linear infinite',
              }}
            />
            {stage === 'exporting' ? 'exporting…' : 'computing…'}
          </span>
        )}
        {error && (
          <span style={{ fontSize: 11, color: tokens.color.accent, fontFamily: tokens.font.mono }}>{error}</span>
        )}
        <div style={{ flex: 1 }} />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && handleImageFile(e.target.files[0])} />
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>Import</Button>
        <Button variant="ghost" onClick={() => setCalibrationOpen(true)}>Calibrate TD</Button>
        <Button variant="subtle" onClick={handleSave}>Save</Button>
        <Button onClick={handleExportStl} disabled={!result || loading || imageLoading}>STL</Button>
        <Button variant="subtle" onClick={handleExport3mf} disabled={!result || loading || imageLoading}>3MF</Button>
        <Button variant="subtle" onClick={handleExportSwap} disabled={!result}>Swaps</Button>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <FilamentStackPanel
          library={filaments}
          stackSlots={stackSlots}
          onReorder={setStackSlots}
          onAdd={(libraryFilament) => {
            setStackSlots((slots) => [...slots, createStackSlot(libraryFilament)]);
          }}
          onRemove={(slotId) => setStackSlots((slots) => slots.filter((s) => s.slotId !== slotId))}
          onEdit={setEditSlot}
        />

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: 12, gap: 12 }}>
          <Panel
            title="Preview"
            style={{ flex: 1, minHeight: 360 }}
          >
            <div
              style={{
                position: 'relative',
                display: 'flex',
                gap: 12,
                padding: 12,
                height: '100%',
                minHeight: 340,
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleImageFile(f);
              }}
            >
              <LoadingOverlay stage={overlayStage} />

              {!image ? (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 12,
                    color: tokens.color.textMuted,
                  }}
                >
                  <p style={{ fontFamily: tokens.font.mono, fontSize: 13 }}>Drop an image or import</p>
                  <Button onClick={() => fileRef.current?.click()}>Import image</Button>
                </div>
              ) : (
                <>
                  <PreviewCanvas
                    label="Predicted"
                    rgba={result?.previewRgba ?? null}
                    width={result?.previewWidth ?? image.width}
                    height={result?.previewHeight ?? image.height}
                    dimmed={imageLoading || loading}
                  />
                  <div
                    style={{
                      flex: 1.4,
                      minWidth: 280,
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: tokens.color.textMuted,
                        }}
                      >
                        Geometry
                      </span>
                      <span style={{ fontSize: 10, color: tokens.color.textMuted, fontFamily: tokens.font.mono }}>
                        drag rotate · right-drag pan · scroll zoom
                      </span>
                    </div>
                    <MeshPreview geometry={meshGeometry} />
                    {result && (
                      <p style={{ fontSize: 10, fontFamily: tokens.font.mono, color: tokens.color.textMuted, marginTop: 8 }}>
                        {result.meshTriangleCount.toLocaleString()} tris · {result.timings.totalMs.toFixed(0)} ms
                        {result.timings.exportMs > 0 ? ` · export ${result.timings.exportMs.toFixed(0)} ms` : ''}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </Panel>

          <SwapTimeline
            manifest={result?.swapManifest ?? null}
            layerHeightMm={project.print.layerHeightMm}
            selectedLayer={selectedLayer}
            onSelectLayer={setSelectedLayer}
          />
        </main>

        <PropertiesRail
          mode={project.relief.mode}
          contrast={project.relief.contrast}
          gamma={project.relief.gamma}
          layerHeightMm={project.print.layerHeightMm}
          maxHeightMm={project.print.maxHeightMm}
          mmPerPixel={project.print.mmPerPixel}
          onModeChange={(mode) => updateRelief({ mode })}
          onContrastChange={(contrast) => updateRelief({ contrast })}
          onGammaChange={(gamma) => updateRelief({ gamma })}
          onLayerHeightChange={(layerHeightMm) => updatePrint({ layerHeightMm })}
          onMaxHeightChange={(maxHeightMm) => updatePrint({ maxHeightMm })}
          onMmPerPixelChange={(mmPerPixel) => updatePrint({ mmPerPixel })}
        />
      </div>

      <FilamentEditorModal
        filament={editSlot?.filament ?? null}
        onSave={(f) => {
          if (!editSlot) return;
          setStackSlots((slots) =>
            slots.map((slot) =>
              slot.slotId === editSlot.slotId ? { ...slot, filament: f } : slot,
            ),
          );
        }}
        onClose={() => setEditSlot(null)}
      />

      <CalibrationAssistant
        open={calibrationOpen}
        onClose={() => setCalibrationOpen(false)}
        onSave={async (name, brand, colorHex, tdMm) => {
          const f = createFilamentFromHex(name, brand, colorHex, tdMm);
          await upsertFilament(f);
          setFilaments(await listFilaments());
          setStackSlots((slots) => [...slots, createStackSlot(f)]);
        }}
      />
    </div>
  );
}
