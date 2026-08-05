import { describe, expect, it } from 'vitest';
import { toHistoryItem, type ExtractionRow } from './extractions.repo';

/**
 * Mapování běhu do historie stažení. Testuje se bez databáze, protože je to
 * čistá funkce nad `result`, a právě v ní se rozhoduje, co o cizím webu smí
 * ven do prohlížeče.
 */
const row = (over: Partial<ExtractionRow> = {}): ExtractionRow => ({
  id: 'e1',
  workspaceId: 'w1',
  inputUrl: 'https://petrnovak.com',
  normalizedUrl: 'https://petrnovak.com/',
  status: 'succeeded',
  errorCode: null,
  result: null,
  brandProfileId: 'b1',
  createdAt: new Date('2026-08-04T13:00:00.000Z'),
  finishedAt: new Date('2026-08-04T13:00:06.000Z'),
  ...over,
});

describe('historie stažení značky', () => {
  it('vydá kdy, odkud a co běh vytáhl', () => {
    const item = toHistoryItem(
      row({
        result: {
          warnings: ['logo_not_found', 'logo_not_measured'],
          palette: { primary: '#c41e3a', text: '#111827', source: { primary: 'css' } },
        },
      }),
    );

    expect(item.url).toBe('https://petrnovak.com/');
    expect(item.status).toBe('succeeded');
    expect(item.warnings).toEqual(['logo_not_found', 'logo_not_measured']);
    expect(item.palette).toEqual({ primary: '#c41e3a', text: '#111827' });
    expect(item.createdAt).toBe('2026-08-04T13:00:00.000Z');
  });

  /**
   * `source` říká, ze kterého selektoru cizího webu barva pochází. Je to
   * podrobnost o cílovém serveru, tedy táž třída údajů jako `hop_summary`,
   * a do prohlížeče nepatří (kritérium 53).
   */
  it('původ barev ani nesmyslné hodnoty ven nejdou', () => {
    const item = toHistoryItem(
      row({ result: { palette: { primary: 'rgb(1,2,3)', source: { primary: 'meta' } } } }),
    );

    expect(item.palette, 'nic v očekávaném tvaru nezbylo').toBeNull();
  });

  /** Starší běhy paletu v `result` nemají a nesmí kvůli tomu spadnout. */
  it('běh bez palety a bez varování projde', () => {
    const item = toHistoryItem(row({ result: null, status: 'failed', errorCode: 'brand_timeout' }));

    expect(item.palette).toBeNull();
    expect(item.warnings).toEqual([]);
    expect(item.errorCode).toBe('brand_timeout');
  });
});
