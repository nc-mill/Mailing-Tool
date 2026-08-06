'use client';

import { Label } from '@mlain/ui/components/label';
import { Tooltip, TooltipProvider } from '@mlain/ui/components/tooltip';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { useId } from 'react';
import type { ValidationProfile } from '@mlain/emails/document/profile';
import type { PropDescriptor } from '../../descriptors/types';
import type { EditorBlock } from '../../model/document-types';
import type { FieldCatalog } from '../../model/field-catalog';
import type { EditorPorts } from '../../ports/types';
import { Info } from '../icons';
import { AssetControl } from './controls/asset-control';
import { CodeControl } from './controls/code-control';
import { ColorControl } from './controls/color-control';
import { LinkControl } from './controls/link-control';
import { NumberControl } from './controls/number-control';
import { PaddingControl } from './controls/padding-control';
import { RichTextControl } from './controls/rich-text-control';
import { SelectControl } from './controls/select-control';
import { SocialItemsControl } from './controls/social-items-control';
import { TextControl } from './controls/text-control';
import { ToggleControl } from './controls/toggle-control';
import { VisibilityControl } from './controls/visibility-control';

export type ControlProps = {
  descriptor: PropDescriptor;
  value: unknown;
  /**
   * ODCHYLKA OD PLÁNU: druhý parametr. `LinkControl` musí vedle vlastní hodnoty
   * přepnout ještě sledování prokliků, což je jiný klíč vlastnosti. Plán volal
   * `onChange(draft, { trackable: … })` na jednoparametrovou funkci, což se
   * nezkompiluje. Panel obě části sloučí do jediné změny dokumentu.
   */
  onChange: (next: unknown, extraPatch?: Record<string, unknown>) => void;
  id: string;
  block: EditorBlock;
  canWriteHtml: boolean;
  fieldCatalog: FieldCatalog;
  ports: EditorPorts | null;
  /**
   * Profil kontroly dokumentu. Dnes ho čte jen `LinkControl`, a to kvůli
   * jediné otázce: je proměnná v poli odkazu chyba, nebo normální stav?
   * V transakční šabloně se odkazy nesledují, takže je to normální stav.
   */
  templateKind: ValidationProfile;
  /**
   * Id popisku vlastnosti. Nese ho ovládání, které NENÍ jedno pole, ale
   * skupina prvků (vzorník barev, čtveřice odsazení, seznam sítí): takové
   * se s popiskem sváže přes `aria-labelledby`, protože `<label for>` smí
   * ukazovat jen na jeden formulářový prvek.
   *
   * Dřív si tyhle skupiny psaly `aria-labelledby={id}`, jenže `id` patří
   * ovládacímu prvku uvnitř, ne popisku, takže odkaz mířil na prvek, který
   * v panelu vůbec není, a skupina zůstala bez jména.
   */
  labelId: string;
  autoFocus?: boolean;
};

const CONTROLS: Record<PropDescriptor['kind'], (props: ControlProps) => ReactElement> = {
  color: ColorControl,
  number: NumberControl,
  select: SelectControl,
  toggle: ToggleControl,
  padding: PaddingControl,
  richtext: RichTextControl,
  asset: AssetControl,
  link: LinkControl,
  text: TextControl,
  code: CodeControl,
  socialItems: SocialItemsControl,
  visibility: VisibilityControl,
};

/**
 * Ovládání, které není jedno pole, ale skupina prvků. Popisek se u nich
 * kreslí jako text (`Label as="span"`) a váže se přes `aria-labelledby`.
 */
const GROUP_KINDS = new Set<PropDescriptor['kind']>(['color', 'padding', 'socialItems']);

/**
 * Ovládání, u kterého popisek patří VEDLE, ne nad.
 *
 * Přepínač je široký 52 px a popisek nad ním nechával vedle sebe prázdný pruh
 * přes celou šířku panelu. Patička má tři přepínače pod sebou, takže to byly
 * tři řádky navíc a v té změti nebylo poznat, co ke které vlastnosti patří.
 */
const INLINE_KINDS = new Set<PropDescriptor['kind']>(['toggle']);

export function PropField(props: Omit<ControlProps, 'id' | 'labelId'>) {
  const t = useTranslations('editor');
  const id = useId();
  const labelId = `${id}-label`;
  const Control = CONTROLS[props.descriptor.kind];
  const hint = 'hint' in props.descriptor ? props.descriptor.hint : undefined;
  // Vlastnost chráněná oprávněním je jen pro čtení. Příznak je na obalu, aby se
  // dal přečíst u celé vlastnosti, ne až u vnitřku ovládacího prvku.
  const readOnly = props.descriptor.kind === 'code' && !props.canWriteHtml;
  const isGroup = GROUP_KINDS.has(props.descriptor.kind);
  const inline = INLINE_KINDS.has(props.descriptor.kind);

  const label = (
    <div className="flex min-w-0 items-center gap-1">
      {isGroup ? (
        <Label as="span" id={labelId}>
          {t(props.descriptor.label)}
        </Label>
      ) : (
        <Label id={labelId} htmlFor={id}>
          {t(props.descriptor.label)}
        </Label>
      )}
      {hint ? (
        <TooltipProvider>
          <Tooltip content={t(hint)}>
            <span data-testid={`hint-${props.descriptor.key}`} tabIndex={0} aria-label={t(hint)}>
              <Info aria-hidden className="icon-xs text-text-muted" />
            </span>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  );

  return (
    <div
      data-testid={`prop-${props.descriptor.key}`}
      data-readonly={readOnly ? 'true' : undefined}
      className={
        inline ? 'flex min-w-0 items-center justify-between gap-[var(--spacing-inline)]' : 'min-w-0'
      }
    >
      {label}
      <div className={inline ? 'shrink-0' : 'mt-1 min-w-0'}>
        <Control {...props} id={id} labelId={labelId} />
      </div>
    </div>
  );
}
