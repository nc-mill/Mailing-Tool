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

export function PropField(props: Omit<ControlProps, 'id'>) {
  const t = useTranslations('editor');
  const id = useId();
  const Control = CONTROLS[props.descriptor.kind];
  const hint = 'hint' in props.descriptor ? props.descriptor.hint : undefined;
  // Vlastnost chráněná oprávněním je jen pro čtení. Příznak je na obalu, aby se
  // dal přečíst u celé vlastnosti, ne až u vnitřku ovládacího prvku.
  const readOnly = props.descriptor.kind === 'code' && !props.canWriteHtml;

  return (
    <div
      data-testid={`prop-${props.descriptor.key}`}
      data-readonly={readOnly ? 'true' : undefined}
      className="space-y-1"
    >
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{t(props.descriptor.label)}</Label>
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
      <Control {...props} id={id} />
    </div>
  );
}
