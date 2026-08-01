import { describe, expect, it } from 'vitest';
import {
  ONE_CLICK_BODY,
  buildListUnsubscribeHeaders,
  isOneClickBody,
  oneClickRateLimit,
} from '../../lists/one-click';

describe('hlavičky podle RFC 8058', () => {
  const headers = buildListUnsubscribeHeaders({
    unsubscribeUrl: 'https://app.example.com/u/t1abc',
    mailtoAddress: 'unsubscribe@example.com',
    token: 't1abc',
  });

  it('List-Unsubscribe obsahuje právě jedno HTTPS URI', () => {
    const https = headers['List-Unsubscribe'].match(/https:\/\//g) ?? [];
    expect(https).toHaveLength(1);
  });

  it('List-Unsubscribe smí obsahovat další ne-HTTP URI', () => {
    expect(headers['List-Unsubscribe']).toContain('mailto:');
  });

  it('List-Unsubscribe-Post obsahuje přesně požadovanou dvojici', () => {
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('URI nese neuhodnutelnou složku', () => {
    expect(headers['List-Unsubscribe']).toContain('t1abc');
  });

  it('bez mailto adresy se vrátí jen HTTPS varianta', () => {
    const only = buildListUnsubscribeHeaders({
      unsubscribeUrl: 'https://app.example.com/u/t1abc',
      token: 't1abc',
    });
    expect(only['List-Unsubscribe']).toBe('<https://app.example.com/u/t1abc>');
  });
});

describe('rozpoznání one-click těla', () => {
  it('přesná hodnota z RFC projde', () => {
    expect(isOneClickBody(new URLSearchParams(ONE_CLICK_BODY))).toBe(true);
  });

  it('tělo z formuláře na stránce předvoleb neprojde', () => {
    expect(isOneClickBody(new URLSearchParams('action=unsubscribe_all'))).toBe(false);
  });

  it('prázdné tělo neprojde', () => {
    expect(isOneClickBody(new URLSearchParams())).toBe(false);
  });

  it('jiná hodnota u správného klíče neprojde', () => {
    expect(isOneClickBody(new URLSearchParams('List-Unsubscribe=Two-Click'))).toBe(false);
  });
});

describe('rate limit one-click endpointu', () => {
  it('KRITÉRIUM 82: neexistuje žádný limit na IP', () => {
    expect(oneClickRateLimit.perIp).toBeNull();
  });

  it('limit je jen na token, dvacet za hodinu', () => {
    expect(oneClickRateLimit.perToken).toEqual({ points: 20, durationSeconds: 3600 });
  });
});
