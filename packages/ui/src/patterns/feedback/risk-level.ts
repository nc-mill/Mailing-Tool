/**
 * Škála rizika z 6.1. Úroveň ochrany se počítá ze tří os, nehádá se.
 *
 * Rozsah:          0 jedna položka, 1 do 100, 2 nad 100
 * Obnovitelnost:   0 plně vratné, 1 obnovitelné ze zálohy nebo exportu, 2 nenávratné
 * Vnější dopad:    0 nikdo mimo nástroj to nepozná, 1 ovlivní kolegy,
 *                  2 odejde ven ke koncovým lidem nebo se ztratí cizí data
 */
export type RiskAxes = {
  scope: 0 | 1 | 2;
  recoverability: 0 | 1 | 2;
  externalImpact: 0 | 1 | 2;
};

export type RiskLevel = 'N1' | 'N2' | 'N3' | 'N4';

const ORDER: RiskLevel[] = ['N1', 'N2', 'N3', 'N4'];

function fromScore(score: number): RiskLevel {
  if (score <= 1) return 'N1';
  if (score <= 3) return 'N2';
  if (score === 4) return 'N3';
  return 'N4';
}

export function riskLevel(
  axes: RiskAxes,
  modifiers: { bulkCount?: number; destructive?: boolean } = {},
): RiskLevel {
  let level = fromScore(axes.scope + axes.recoverability + axes.externalImpact);

  // A6 není samostatná třída, je to modifikátor (5.1).
  const isBulk = (modifiers.bulkCount ?? 0) > 20;
  if (isBulk && ORDER.indexOf(level) < ORDER.indexOf('N2')) level = 'N2';
  if (isBulk && modifiers.destructive && ORDER.indexOf(level) < ORDER.indexOf('N3')) level = 'N3';

  return level;
}
