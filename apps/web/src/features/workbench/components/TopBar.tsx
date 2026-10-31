import { useEffect, useState } from 'react';
import {
  Button,
  IconButton,
  IconChevronDown,
  IconDownload,
  IconFile,
  IconFolder,
  IconImage,
  IconLayers,
  IconPlus,
  IconRedo,
  IconUndo,
  LogoMark,
  Menu,
  MenuItem,
  Segmented,
} from '@huecraft/design-system';
import { t } from '../../../i18n';
import type { Workbench } from '../useWorkbench';

export function TopBar({ wb, onPickImage }: { wb: Workbench; onPickImage: () => void }) {
  const [name, setName] = useState(wb.project.name);
  useEffect(() => setName(wb.project.name), [wb.project.name]);
  const hasResult = !!wb.result && !!wb.image;

  return (
    <header className="wb-topbar">
      <div className="wb-brand">
        <LogoMark size={24} className="wb-brand__mark" />
        <span className="wb-brand__name">{t.appName}</span>
      </div>

      <Menu
        align="left"
        trigger={({ toggle, open }) => (
          <IconButton label={t.topbar.projects} onClick={toggle} aria-pressed={open}>
            <IconFolder />
          </IconButton>
        )}
      >
        {(close) => (
          <>
            <MenuItem icon={<IconPlus />} onClick={() => (close(), wb.newBlankProject())}>
              {t.topbar.newProject}
            </MenuItem>
            <MenuItem icon={<IconImage />} onClick={() => (close(), onPickImage())}>
              {t.topbar.openImage} <span className="hc-kbd">Ctrl+O</span>
            </MenuItem>
            <div className="hc-menu__sep" />
            <div className="hc-menu__label">{t.topbar.recent}</div>
            {wb.recent.length === 0 && <div className="wb-menu-empty">{t.topbar.noRecent}</div>}
            {wb.recent.map((r) => (
              <button
                key={r.id}
                type="button"
                className="hc-menu__item wb-recent-item"
                onClick={() => (close(), wb.openProject(r.id))}
                aria-current={r.id === wb.project.id}
              >
                {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <span className="wb-recent-item__blank" />}
                <span>
                  {r.project.name}
                  <small>{new Date(r.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>
                </span>
              </button>
            ))}
          </>
        )}
      </Menu>

      <input
        className="wb-project-name"
        aria-label={t.topbar.renameProject}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== wb.project.name && wb.rename(name.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        spellCheck={false}
      />
      <span className="wb-save-state" data-state={wb.saveState}>
        {wb.saveState === 'saving' ? t.topbar.saving : wb.saveState === 'saved' ? t.topbar.saved : ''}
      </span>

      <div className="wb-topbar__spacer" />

      <div className="wb-topbar__group">
        <IconButton label={t.topbar.undo} onClick={wb.undo} disabled={!wb.canUndo}>
          <IconUndo />
        </IconButton>
        <IconButton label={t.topbar.redo} onClick={wb.redo} disabled={!wb.canRedo}>
          <IconRedo />
        </IconButton>
      </div>

      <div title={t.topbar.profileHint}>
        <Segmented
          ariaLabel={t.topbar.profileHint}
          value={wb.profile}
          onChange={wb.setProfile}
          options={[
            { value: 'basic', label: t.topbar.basic },
            { value: 'advanced', label: t.topbar.advanced },
          ]}
        />
      </div>

      <Menu
        trigger={({ toggle }) => (
          <div className="hc-split">
            <Button variant="primary" onClick={() => wb.requestExport('3mf')} disabled={!hasResult || wb.exporting}>
              <IconDownload />
              {t.topbar.export3mf}
            </Button>
            <Button variant="primary" onClick={toggle} disabled={!hasResult || wb.exporting} aria-label={t.topbar.exportMenu}>
              <IconChevronDown />
            </Button>
          </div>
        )}
      >
        {(close) => (
          <>
            <MenuItem icon={<IconLayers />} hint={t.topbar.export3mfHint} onClick={() => (close(), wb.requestExport('3mf'))}>
              3MF
            </MenuItem>
            <MenuItem icon={<IconFile />} hint={t.topbar.exportStlHint} onClick={() => (close(), wb.requestExport('stl'))}>
              {t.topbar.exportStl}
            </MenuItem>
            <MenuItem icon={<IconFile />} hint={t.topbar.exportSwapsHint} onClick={() => (close(), wb.requestExport('txt'))}>
              {t.topbar.exportSwaps}
            </MenuItem>
          </>
        )}
      </Menu>
    </header>
  );
}
