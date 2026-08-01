'use client';

import { ErrorBlock, type ErrorBlockLabels, type ProblemSummary } from '@mlain/ui/patterns/states';
import type { Problem } from '@/lib/api-client/problem';

export type ProblemBlockLabels = ErrorBlockLabels;

export type ProblemBlockProps = {
  problem: Problem;
  /** Lokalizovaný nadpis: co se stalo. */
  title: string;
  /** Lokalizované vysvětlení: proč a co s tím. */
  body: string;
  labels: ProblemBlockLabels;
  /** ISO čas vzniku chyby, předává ho server, aby nevznikl rozpor při hydrataci. */
  occurredAt: string;
  onRetry?: () => void;
};

/**
 * Stav S9 podle 7.1 části 6 a konvence z 5.3 části 1.
 *
 * Tenhle soubor **nic nekreslí**. Dřívější znění mělo vlastní blok s nadpisem,
 * tlačítkem, číslem požadavku a sbalenými podrobnostmi, tedy přesně to, co
 * `ErrorBlock` z `@mlain/ui/patterns/states` už umí, včetně `data-error-code`
 * v DOM a tlačítka na zkopírování celého bloku. Dvě implementace téhož se
 * rozejdou a uzávěr S3 to zakazuje, takže tady zbyl jen převod tvaru:
 * `Problem` podle RFC 9457 na `ProblemSummary`, se kterým komponenta pracuje.
 *
 * Prázdné `request_id` se **nepřevádí na výmysl**: `instance` se předá jako
 * cesta a číslo požadavku zůstane prázdné, protože vymyšlené číslo v logu
 * neexistuje (rozhodnutí R5).
 */
export function ProblemBlock({
  problem,
  title,
  body,
  labels,
  occurredAt,
  onRetry,
}: ProblemBlockProps) {
  const summary: ProblemSummary = {
    code: problem.code,
    requestId: problem.request_id,
    occurredAt: new Date(occurredAt),
    path: problem.instance,
  };

  return (
    <ErrorBlock
      title={title}
      reason={body}
      problem={summary}
      {...(onRetry ? { onRetry } : {})}
      labels={labels}
    />
  );
}
