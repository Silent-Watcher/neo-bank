import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

// The dev index.html always defines #root; a missing element is a broken
// document, not an empty render target.
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
