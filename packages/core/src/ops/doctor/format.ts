import { SEVERITY_ORDER, type DoctorFinding, type DoctorSeverity } from './types';

const LABEL: Record<DoctorSeverity, string> = {
  critical: 'KRITICKÉ',
  warning: 'VAROVÁNÍ',
  info: 'informace',
};

export function sortFindings(findings: readonly DoctorFinding[]): DoctorFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
}

export function summarize(findings: readonly DoctorFinding[]): Record<DoctorSeverity, number> {
  return {
    critical: findings.filter((f) => f.severity === 'critical').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
}

/**
 * Kritický nález je nenulový návratový kód vždy. Varování jen s --strict,
 * protože jinak si provozovatel zvykne nenulový kód ignorovat a přestane
 * si všímat i těch kritických.
 */
export function exitCodeFor(
  findings: readonly DoctorFinding[],
  options: { strict: boolean },
): number {
  const s = summarize(findings);
  if (s.critical > 0) return 2;
  if (s.warning > 0 && options.strict) return 1;
  return 0;
}

export function formatReport(findings: readonly DoctorFinding[]): string {
  if (findings.length === 0) {
    return 'Instalace je v pořádku, žádný nález.\n';
  }
  const lines: string[] = [];
  for (const f of sortFindings(findings)) {
    lines.push(`[${LABEL[f.severity]}] ${f.title}  (${f.id})`);
    if (f.detail) lines.push(`    ${f.detail}`);
    if (f.action) lines.push(`    Co s tím: ${f.action}`);
    lines.push('');
  }
  const s = summarize(findings);
  lines.push(`Souhrn: ${s.critical} kritických, ${s.warning} varování, ${s.info} informací.`);
  return `${lines.join('\n')}\n`;
}

export function formatJson(findings: readonly DoctorFinding[]): string {
  return `${JSON.stringify(
    { summary: summarize(findings), findings: sortFindings(findings) },
    null,
    2,
  )}\n`;
}
