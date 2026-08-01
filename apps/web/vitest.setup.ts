// Registruje matchery jest-dom (toBeInTheDocument a další) a úklid po každém
// testu. Bez cleanup() zůstává předchozí render v dokumentu a getByRole najde
// víc prvků téže role. Explicitní afterEach je zvolený schválně místo
// globals: true, aby se testy nepsaly proti implicitním globálům.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
