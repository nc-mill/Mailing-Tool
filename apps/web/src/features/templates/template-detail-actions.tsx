'use client';

import { useRouter } from '@mlain/i18n/navigation';
import { DeleteTemplateButton } from './delete-template-button';

/**
 * Akce nad celou šablonou na jejím detailu. Dnes jediná: smazání.
 *
 * PROČ JE TO VLASTNÍ PRUH NAD EDITOREM a ne tlačítko v hlavičce editoru:
 * hlavička patří skořápce editoru (`features/editor`), která je společná pro
 * šablonu i pro obsah kampaně. Obsah kampaně se mazat nesmí, ten patří kampani,
 * takže by tlačítko muselo být podmíněné uvnitř cizí komponenty. Pruh nad
 * editorem vykresluje stránka šablony, tedy právě to místo, které ví, že
 * otevřená věc je samostatná šablona.
 *
 * Po smazání se odchází do knihovny, a to S ADRESOU NESOUCÍ nabídku vrácení:
 * bez ní by se uživatel po smazání ocitl v seznamu bez jakékoli cesty zpět
 * a slib z potvrzovacího okna by platil jen na jedné ze dvou obrazovek.
 */
export function TemplateDetailActions({
  workspaceSlug,
  workspaceId,
  templateId,
  name,
}: {
  workspaceSlug: string;
  workspaceId: string;
  templateId: string;
  name: string;
}) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2">
      <DeleteTemplateButton
        workspaceId={workspaceId}
        templateId={templateId}
        name={name}
        size="sm"
        onDeleted={(template) => {
          const query = new URLSearchParams({ undo: template.id, undo_name: template.name });
          router.push(`/w/${workspaceSlug}/templates?${query.toString()}`);
        }}
      />
    </div>
  );
}
