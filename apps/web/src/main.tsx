import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { globalStyles } from '@huecraft/design-system';
import { App } from './app/App';
import './styles.css';

// Inject the design-system sheet before first paint so there is no unstyled flash.
const style = document.createElement('style');
style.id = 'huecraft-global-styles';
style.textContent = globalStyles;
document.head.prepend(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
