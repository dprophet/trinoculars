import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { BrowserRouter } from 'react-router-dom';
import '@mantine/core/styles.css';
import { theme } from '@/theme';
import { StoreProvider } from '@/store';
import { App } from '@/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <BrowserRouter>
        <StoreProvider>
          <App />
        </StoreProvider>
      </BrowserRouter>
    </MantineProvider>
  </StrictMode>,
);
