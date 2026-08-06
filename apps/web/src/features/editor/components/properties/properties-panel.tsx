'use client';

import { Card, CardTitle } from '@mlain/ui/components/card';
import { useTranslations } from 'next-intl';
import { descriptorFor } from '../../descriptors/registry';
import type { VisibilityCondition } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import { findBlock } from '../../model/tree';
import type { EditorPorts } from '../../ports/types';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import type { ValidationProfile } from '@mlain/emails/document/profile';
import { PropField } from './prop-field';
import { ThemePanel } from './theme-panel';

export function PropertiesPanel(props: {
  canWriteHtml: boolean;
  fieldCatalog: FieldCatalog;
  ports: EditorPorts | null;
  /** Profil kontroly dokumentu. Ovládací prvek odkazu podle něj pozná,
   *  jestli je proměnná v URL chyba, nebo normální stav. */
  templateKind: ValidationProfile;
}) {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);
  const selectedId = useEditorState((state) => state.selectedId);
  const found = selectedId ? findBlock(document, selectedId) : undefined;

  /*
   * Panel je KARTA se stejným vnitřním okrajem jako paleta (20 px). Dřív to byl
   * sloupec oddělený svislou linkou; návrh editor kreslí jako tři karty vedle
   * sebe, ne jako panely přilepené k okrajům okna.
   *
   * LEPÍ SE POD HLAVIČKU, ze stejného důvodu jako paleta: roluje stránka, takže
   * bez toho by vlastnosti vybraného bloku odjely pryč právě ve chvíli, kdy se
   * uživatel dívá na blok dole v e-mailu. Když je panel vyšší než okno, roluje
   * si sám, tedy stejně, jako to uměl původní sloupec přes celou výšku.
   */
  const sticky = [
    'min-w-0',
    'sticky top-[calc(var(--size-topbar)+var(--spacing-stack))]',
    'max-h-[calc(100dvh-var(--size-topbar)-var(--spacing-page))] overflow-y-auto',
  ].join(' ');

  if (!found) {
    return (
      <Card
        as="aside"
        id="editor-properties"
        aria-label={t('a11y.propertiesPanel')}
        padding="sm"
        gap="none"
        className={sticky}
      >
        <ThemePanel />
      </Card>
    );
  }

  const descriptor = descriptorFor(found.block.type);

  /*
   * Bohatý text se v panelu UŽ NENABÍZÍ. Edituje se přímo na plátně.
   *
   * Dokud tu pole zůstávalo, byl týž text na obrazovce dvakrát: jednou v místě,
   * kde ho uživatel vidí, a jednou v panelu v jiném písmu a jiné velikosti.
   * Právě to byla hlavní stížnost na starý editor, protože z těch dvou polí
   * nebylo poznat, které je „to pravé".
   *
   * Vyhazuje se jen samotná vlastnost, ne celá skupina: skupina Obsah nese
   * u tlačítka i odkaz a u patičky přepínače odkazů, a ty na plátně nejsou.
   * Skupina, ze které tím nezbude nic, se přeskočí.
   */
  const visibleGroups = descriptor.groups
    .map((group) => ({ ...group, props: group.props.filter((prop) => prop.kind !== 'richtext') }))
    .filter((group) => group.props.length > 0);

  return (
    <Card
      as="aside"
      id="editor-properties"
      aria-label={t('a11y.propertiesPanel')}
      padding="sm"
      gap="none"
      className={`${sticky} gap-[var(--spacing-stack)]`}
    >
      <CardTitle>{t(descriptor.label)}</CardTitle>
      {descriptor.groups.length === 0 ? (
        <p className="text-sm text-text-muted">
          {t('block.lockedHint', { type: found.block.type })}
        </p>
      ) : null}
      {visibleGroups.map((group, groupIndex) => (
        // ODCHYLKA OD PLÁNU: skupina nemá `aria-label`, jméno nese `legend`.
        // S obojím by `getByLabelText` našel jak pole, tak celou skupinu, protože
        // se u obou shoduje text (například „Tmavý režim" v panelu motivu).
        //
        // Skupiny odděluje linka nad nadpisem, přesně jak je má návrh: mono
        // verzálky pod hairline oddělovačem. První skupina linku nemá, aby
        // nekopírovala rámeček karty.
        <fieldset
          key={group.label}
          className="flex flex-col gap-3 border-t border-border pt-[var(--spacing-stack)] first-of-type:border-t-0 first-of-type:pt-0"
        >
          <legend className="meta-caps text-text-muted">{t(group.label)}</legend>
          {group.props.map((descriptorProp, propIndex) => (
            <PropField
              key={descriptorProp.key}
              autoFocus={groupIndex === 0 && propIndex === 0}
              descriptor={descriptorProp}
              block={found.block}
              value={
                descriptorProp.kind === 'visibility'
                  ? (found.block.visibleWhen ?? null)
                  : found.block.props[descriptorProp.key]
              }
              canWriteHtml={props.canWriteHtml}
              fieldCatalog={props.fieldCatalog}
              ports={props.ports}
              templateKind={props.templateKind}
              onChange={(next, extraPatch) => {
                if (descriptorProp.kind === 'visibility') {
                  store.setVisibility(found.block.id, next as VisibilityCondition | null);
                } else {
                  store.patchProps(found.block.id, {
                    [descriptorProp.key]: next,
                    ...extraPatch,
                  });
                }
              }}
            />
          ))}
        </fieldset>
      ))}
    </Card>
  );
}
