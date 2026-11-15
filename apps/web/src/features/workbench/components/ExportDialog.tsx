import { useEffect, useState } from 'react';
import type { PrintOrientation } from '@huecraft/project-schema';
import { Button, Modal } from '@huecraft/design-system';
import { t } from '../../../i18n';
import type { Workbench } from '../useWorkbench';

/** Asks how the print lies on the bed before a 3MF / STL export. */
export function ExportDialog({ wb }: { wb: Workbench }) {
  const kind = wb.exportRequest;
  const [choice, setChoice] = useState<PrintOrientation>(wb.orientation);
  // Each time it opens, start from the orientation the 3D view shows.
  useEffect(() => {
    if (kind) setChoice(wb.orientation);
  }, [kind, wb.orientation]);

  const options: { value: PrintOrientation; title: string; desc: string }[] = [
    { value: 'faceUp', title: t.exportDialog.faceUpTitle, desc: t.exportDialog.faceUpDesc },
    { value: 'faceDown', title: t.exportDialog.faceDownTitle, desc: t.exportDialog.faceDownDesc },
  ];

  return (
    <Modal
      open={kind !== null}
      title={t.exportDialog.title}
      subtitle={t.exportDialog.subtitle(kind === 'stl' ? 'STL' : '3MF')}
      onClose={wb.cancelExport}
      footer={
        <>
          <Button variant="ghost" onClick={wb.cancelExport}>
            {t.exportDialog.cancel}
          </Button>
          <Button variant="primary" onClick={() => wb.confirmExport(choice)}>
            {t.exportDialog.confirm}
          </Button>
        </>
      }
    >
      <div className="wb-orient" role="radiogroup" aria-label={t.stage.orientation}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={choice === o.value}
            className="wb-orient__card"
            onClick={() => setChoice(o.value)}
            onDoubleClick={() => wb.confirmExport(o.value)}
          >
            <OrientationGlyph value={o.value} />
            <span className="wb-orient__text">
              <span className="wb-orient__title">{o.title}</span>
              <span className="wb-orient__desc">{o.desc}</span>
            </span>
          </button>
        ))}
      </div>
      {choice === 'faceDown' && (
        <p className="wb-orient__note">
          {kind === 'stl' ? t.exportDialog.faceDownStl : wb.slicerTemplate ? t.exportDialog.faceDownTemplate : t.exportDialog.faceDownNoTemplate}
        </p>
      )}
    </Modal>
  );
}

/** Side view: bed line, coloured layers and (face down) the clear window against the bed. */
function OrientationGlyph({ value }: { value: PrintOrientation }) {
  const up = value === 'faceUp';
  return (
    <svg className="wb-orient__glyph" viewBox="0 0 64 40" aria-hidden="true">
      <line x1="2" y1="34" x2="62" y2="34" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
      {up ? (
        <>
          <rect x="8" y="26" width="48" height="8" fill="#2b2b2b" />
          <path d="M8 26 V20 H18 V14 H28 V20 H38 V10 H48 V18 H56 V26 Z" fill="#c23b3b" />
          <path d="M28 14 V20 H38 V10 H48 V14 Z" fill="#f2f2f2" />
          <path d="M14 6 l4 -3 l4 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      ) : (
        <>
          <rect x="8" y="12" width="48" height="22" fill="#cfe3ec" fillOpacity="0.45" stroke="#cfe3ec" strokeOpacity="0.7" />
          <path d="M8 12 V18 H18 V24 H28 V18 H38 V28 H48 V20 H56 V12 Z" fill="#c23b3b" />
          <path d="M28 24 V18 H38 V28 H48 V24 Z" fill="#f2f2f2" />
          <rect x="8" y="6" width="48" height="6" fill="#2b2b2b" />
          <path d="M14 36 l4 3 l4 -3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}
