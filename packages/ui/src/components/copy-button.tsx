'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './button';

/**
 * Zkopíruje text do schránky a na dvě sekundy to přizná.
 *
 * Bydlí v primitivech, protože ho vedle chybového bloku potřebují i klíče
 * k API, DNS záznamy a `request_id`. Dvě implementace téhož by se rozešly
 * právě v tom, co je na tom těžké: v ohlášení čtečce.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  variant = 'secondary',
  className,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  variant?: 'secondary' | 'link';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Hlášku „Zkopírováno" je potřeba po chvíli vrátit zpět, jinak tlačítko
  // podruhé nevypadá jako akce. Časovač se při odpojení ruší.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant={variant}
      {...(className ? { className } : {})}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      {copied ? copiedLabel : label}
      {/* Změnu musí slyšet i ten, kdo tlačítko nevidí. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </Button>
  );
}
