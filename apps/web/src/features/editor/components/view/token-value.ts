import type { VarInline } from '@mlain/emails/document/types';

/**
 * Hodnota značky pro dosazení do plátna.
 *
 * DO E-MAILU JDE DÁL `{{ … }}`. Tohle je jen zobrazení: plátno umí kreslit
 * značku dvěma způsoby, jako štítek s popiskem („Oslovení") nebo jako hodnotu
 * („Dobrý den, Jano"), a přepíná mezi nimi volba „Zobrazit jako" v hlavičce.
 * Emitter ani model dokumentu o tomhle souboru nevědí.
 *
 * Náhrada se řeší stejně jako filtrem `default` v Liquidu: prázdná hodnota
 * (chybějící pole i prázdný řetězec) se nahradí textem z `fallback`. Bez toho
 * by volba „Kontakt bez jména" ukazovala díru i tam, kde uživatel náhradu
 * vyplnil, a vypadalo by to jako vada šablony.
 */
export function resolvePath(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Cesta bez filtrů. `expr` může znít `contact.first_name | default`. */
export function exprPath(expr: string): string {
  return (expr.split('|')[0] ?? '').trim();
}

export function tokenValue(
  root: Record<string, unknown>,
  node: Pick<VarInline, 'expr' | 'fallback'>,
): string {
  const raw = resolvePath(root, exprPath(node.expr));
  const text = raw === undefined || raw === null ? '' : String(raw);
  if (text === '' && node.fallback) return node.fallback;
  return text;
}
