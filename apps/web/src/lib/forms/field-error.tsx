import type { FieldErrors } from '@/lib/errors/field-errors';

export function fieldErrorId(name: string): string {
  return `field-error-${name}`;
}

export type FieldErrorProps = {
  name: string;
  errors: FieldErrors;
};

/**
 * Chyba je svázaná s polem přes `aria-describedby` a pole má `aria-invalid`,
 * viz 11.3 části 6. Vlastní propojení dělá volající, tahle komponenta jen
 * vykreslí text se stabilním `id`.
 *
 * ODCHYLKA OD PLÁNU, jen ve třídě: plán psal `text-[--color-danger]`, což
 * v Tailwindu 4 není utilita a text by zůstal bez barvy. Používá se sémantická
 * třída z tokenů `packages/ui`, tedy `text-danger-text`.
 */
export function FieldError({ name, errors }: FieldErrorProps) {
  const messages = errors[name];
  if (!messages || messages.length === 0) return null;
  return (
    <p id={fieldErrorId(name)} className="mt-1 text-sm text-danger-text">
      {messages.join(' ')}
    </p>
  );
}

export function fieldAria(
  name: string,
  errors: FieldErrors,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return errors[name] ? { 'aria-invalid': true, 'aria-describedby': fieldErrorId(name) } : {};
}
