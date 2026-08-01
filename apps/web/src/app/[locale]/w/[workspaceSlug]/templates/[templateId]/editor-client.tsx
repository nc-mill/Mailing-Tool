'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { EditorShellProps } from '@/features/editor';
import { createHttpPorts } from '@/features/editor/ports/http-ports';

/** Editor není v základním balíku, kritérium 82 části 6. */
const EditorShell = dynamic(
  () => import('@/features/editor').then((module) => module.EditorShell),
  {
    ssr: false,
    loading: () => <div className="h-dvh animate-pulse bg-surface-muted" aria-busy="true" />,
  },
);

type Props = Omit<EditorShellProps, 'ports'>;

/**
 * Klientská validace se tady nesestavuje. Skládá si ji `useValidation` uvnitř
 * skořápky z katalogu polí, který stejně dostává propem, takže obal nemá co předávat.
 */
export function EditorClient(props: Props) {
  const ports = useMemo(() => createHttpPorts({}), []);
  return <EditorShell {...props} ports={ports} />;
}
