'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { EditorShellProps } from '@/features/editor';
import { createHttpPorts } from '@/features/editor/ports/http-ports';

/**
 * Editor obsahu kampaně, tedy KROK 1.
 *
 * Je to vlastní obal, ne ten z obrazovky šablon, protože každá cesta má svůj
 * kus stromu a sdílet obal přes hranici dvou tras by znamenalo importovat
 * z cizí složky `app/`. Kód je krátký a jeho jediný úkol je stejný jako tam:
 * složit porty a nechat editor doběhnout mimo základní balík (kritérium 82).
 */
const EditorShell = dynamic(
  () => import('@/features/editor').then((module) => module.EditorShell),
  {
    ssr: false,
    loading: () => <div className="h-dvh animate-pulse bg-surface-muted" aria-busy="true" />,
  },
);

type Props = Omit<EditorShellProps, 'ports'> & {
  /** Bez něj chodí volání editoru bez `X-Workspace-Id` a API vrací 404. */
  workspaceId: string;
};

export function CampaignEditorClient({ workspaceId, ...props }: Props) {
  const ports = useMemo(() => createHttpPorts({ workspaceId }), [workspaceId]);
  return <EditorShell {...props} ports={ports} />;
}
