import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

/**
 * Popisek formulářového pole. 14 px polotučně.
 *
 * `as="span"` je tu pro pole, které `<label for>` použít nemůže. Takové pole
 * existuje: výběr postavený na Radixu odesílá hodnotu skrytým `<input>`, na
 * který by `htmlFor` ukazoval, jenže ten nejde zaostřit. Popisek se tam tedy
 * kreslí jako text a jméno nese `aria-label` spouštěče.
 *
 * **Není to pozvánka psát pole bez popisku.** Je to jediné místo, kde se styl
 * popisku definuje, takže i ten „nepravý" vypadá stejně jako ostatní. Dřív si
 * ho takové pole opisovalo a mělo pak jinou tučnost než sousední pole
 * v témže formuláři.
 */
export const Label = forwardRef<
  HTMLLabelElement,
  ComponentPropsWithoutRef<'label'> & { as?: 'label' | 'span' }
>(function Label({ className, as: Element = 'label', ...props }, ref) {
  return (
    <Element
      {...props}
      ref={ref as React.Ref<HTMLLabelElement & HTMLSpanElement>}
      className={cn('block text-sm font-semibold text-text', className)}
    />
  );
});
