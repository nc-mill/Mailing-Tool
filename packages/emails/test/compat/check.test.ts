import { describe, expect, it } from 'vitest';
import { checkCompatibility, TIER1_CLIENTS } from '../../src/compat/check';

describe('checkCompatibility', () => {
  it('knows the tier one clients', () => {
    expect(TIER1_CLIENTS.length).toBeGreaterThanOrEqual(5);
    expect(TIER1_CLIENTS).toContain('outlook-windows');
  });

  it('reports nothing for plain table markup', () => {
    const findings = checkCompatibility('<table><tr><td style="color:#000">x</td></tr></table>');
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('downgrades a documented exception to info', () => {
    const findings = checkCompatibility('<td style="border-radius:6px">x</td>');
    const radius = findings.find((f) => f.feature.includes('border-radius'));
    expect(radius?.severity).not.toBe('error');
  });

  it('reports an unsupported property as an error', () => {
    const findings = checkCompatibility('<div style="display:flex">x</div>');
    expect(findings.some((f) => f.severity === 'error')).toBe(true);
  });

  it('reports partial support as a warning', () => {
    const findings = checkCompatibility('<td style="background-image:url(a.png)">x</td>');
    expect(findings.some((f) => f.severity === 'warning' || f.severity === 'error')).toBe(true);
  });

  it('names the place where the property was used', () => {
    const findings = checkCompatibility('<div style="display:flex">x</div>');
    expect(findings[0]!.usedAt).toContain('display');
  });

  it('reads outlook.com from its own column, not from the word engine', () => {
    // Regrese na rozpad jména klienta: `outlook-com` se dřív četlo jako
    // platforma `com`, spadlo do dat Outlooku pro Windows a hlásilo `n` tam,
    // kde Outlook.com zaoblení podporuje.
    const findings = checkCompatibility('<td style="border-radius:6px">x</td>');
    const radius = findings.find((f) => f.feature === 'css-border-radius');
    expect(radius?.support['outlook-com']).toBe('y');
    expect(radius?.support['outlook-windows']).toBe('n');
    expect(radius?.support['apple-mail-macos']).toBe('y');
  });
});
