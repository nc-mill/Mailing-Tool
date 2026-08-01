'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@mlain/ui/components/button';

export type SubmitButtonProps = {
  label: string;
  pendingLabel: string;
};

/**
 * Primární akce nikdy nemá `disabled` (kritérium 18 kapitoly 15.2 části 6).
 * Mrtvé tlačítko neřekne, proč je mrtvé. Dvojklik zachytí idempotence.
 *
 * ODCHYLKA OD PLÁNU, vynucená rozhraním P05: plán posílal `aria-busy={pending}`
 * a text měnil sám. `Button` z designového systému má na tohle vlastní dvojici
 * propů `pending` a `pendingLabel` a `aria-busy` si nastavuje AŽ ZA rozbalením
 * ostatních propů, takže by ručně předanou hodnotu tiše přebil. Chování je
 * stejné, jen ho drží jedno místo: text se během odesílání změní, atribut
 * `disabled` nevznikne nikdy.
 */
export function SubmitButton({ label, pendingLabel }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" pending={pending} pendingLabel={pendingLabel}>
      {label}
    </Button>
  );
}
