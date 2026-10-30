import { useEffect, useRef, useState } from 'react';
import { readPref, writePref } from '../../project/storage';
import { t } from '../../../i18n';
import { useWorkbench } from '../useWorkbench';
import { ControlPanel } from './ControlPanel';
import { Stage, STAGE_TABS, type StageTab } from './Stage';
import { TopBar } from './TopBar';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function Workbench() {
  const wb = useWorkbench();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTabState] = useState<StageTab>(() => {
    const saved = readPref('huecraft:tab') as StageTab | null;
    return saved && STAGE_TABS.includes(saved) ? saved : 'printed';
  });
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const setTab = (next: StageTab) => {
    setTabState(next);
    writePref('huecraft:tab', next);
  };
  const pickImage = () => fileRef.current?.click();

  const wbRef = useRef(wb);
  wbRef.current = wb;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const w = wbRef.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z' && !isTyping(e.target)) {
        e.preventDefault();
        if (e.shiftKey) w.redo();
        else w.undo();
      } else if (mod && key === 'y' && !isTyping(e.target)) {
        e.preventDefault();
        w.redo();
      } else if (mod && key === 'e') {
        e.preventDefault();
        w.exportFile('3mf');
      } else if (mod && key === 'o') {
        e.preventDefault();
        fileRef.current?.click();
      } else if (mod && key === 's') {
        // Autosave already runs; swallow the browser "save page" dialog.
        e.preventDefault();
      } else if (!mod && !e.altKey && !isTyping(e.target) && /^[1-5]$/.test(e.key)) {
        setTab(STAGE_TABS[Number(e.key) - 1]);
      } else if (!mod && !e.altKey && !isTyping(e.target) && key === 'b' && !e.repeat) {
        // The brush paints on the 3D view: turning it on from another tab goes there.
        if (tabRef.current !== '3d') {
          setTab('3d');
          w.setBrushActive(true);
        } else {
          w.setBrushActive(!w.brushActive);
        }
      } else if (key === 'escape' && w.brushActive && !isTyping(e.target)) {
        w.setBrushActive(false);
      }
    };
    // Ctrl+V with an image on the clipboard (screenshot, copied image or file).
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(
        (i) => i.kind === 'file' && i.type.startsWith('image/'),
      );
      const blob = item?.getAsFile();
      if (!blob) return;
      e.preventDefault();
      // Screenshots arrive as "image.png"; give them a readable project name.
      const name = blob.name && blob.name !== 'image.png' ? blob.name : `${t.stage.pastedName}.png`;
      wbRef.current.openImageFile(new File([blob], name, { type: blob.type }));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  return (
    <div
      className="wb"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragOver(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) wb.openImageFile(f);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) wb.openImageFile(f);
          e.target.value = '';
        }}
      />
      <TopBar wb={wb} onPickImage={pickImage} />
      <div className="wb-body">
        <ControlPanel wb={wb} onPickImage={pickImage} />
        <Stage wb={wb} tab={tab} onTab={setTab} onPickImage={pickImage} />
      </div>
      {dragOver && (
        <div className="wb-drop-overlay">
          <span>{t.stage.dropOverlay}</span>
        </div>
      )}
      {wb.toast && (
        <div key={wb.toast.id} className={`hc-toast${wb.toast.kind === 'error' ? ' hc-toast--error' : ''}`} onClick={wb.dismissToast}>
          {wb.toast.sticky && <span className="wb-spinner" />}
          {wb.toast.text}
        </div>
      )}
    </div>
  );
}
