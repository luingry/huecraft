import { useEffect } from 'react';
import { globalStyles, spinnerKeyframes } from '@huecraft/design-system';
import { WorkbenchShell } from '../features/workbench/components/WorkbenchShell';

export function App() {
  useEffect(() => {
    const id = 'huecraft-global-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = globalStyles + spinnerKeyframes;
    document.head.appendChild(style);
  }, []);

  return <WorkbenchShell />;
}
