/**
 * Typová pojistka ke kritériu 18. Soubor se nespouští, kontroluje ho `tsc`.
 * Když by se `disabled` na primární variantě povolilo, `@ts-expect-error`
 * přestane platit a typecheck spadne.
 */
import type { ButtonProps } from './button';

// @ts-expect-error primární tlačítko nesmí přijmout disabled
const invalidPrimary: ButtonProps = { variant: 'primary', disabled: true, children: 'Odeslat' };

// @ts-expect-error destruktivní tlačítko nesmí přijmout disabled
const invalidDestructive: ButtonProps = {
  variant: 'destructive',
  disabled: true,
  children: 'Smazat',
};

const validSecondary: ButtonProps = { variant: 'secondary', disabled: true, children: 'Zpět' };
const validPrimary: ButtonProps = { variant: 'primary', children: 'Odeslat 12 e-mailů' };

export const guards = [invalidPrimary, invalidDestructive, validSecondary, validPrimary];
