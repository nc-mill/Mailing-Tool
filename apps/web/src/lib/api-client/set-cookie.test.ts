import { describe, expect, it } from 'vitest';
import { parseSetCookie, parseSetCookies } from './set-cookie';

const SESSION =
  'ml_session=4AcorhJZOdUMXN7ots7sAjSQzeUTfCABzNGc4MQmd7M; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000';

describe('parseSetCookie', () => {
  it('zachová jméno, hodnotu i všechny atributy relační cookie z P04', () => {
    expect(parseSetCookie(SESSION)).toEqual({
      name: 'ml_session',
      value: '4AcorhJZOdUMXN7ots7sAjSQzeUTfCABzNGc4MQmd7M',
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 2_592_000,
    });
  });

  it('hodnotu nedekóduje, aby se token nezměnil', () => {
    const parsed = parseSetCookie('ml_session=a%2Fb%3Dc; Path=/');
    expect(parsed?.value).toBe('a%2Fb%3Dc');
  });

  it('rozumí mazací cookie s Max-Age=0 a Expires v minulosti', () => {
    const parsed = parseSetCookie(
      'ml_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );
    expect(parsed?.value).toBe('');
    expect(parsed?.maxAge).toBe(0);
    expect(parsed?.expires?.getTime()).toBe(0);
  });

  it('zachytí Secure, Domain a Partitioned', () => {
    const parsed = parseSetCookie('a=b; Domain=mlain.dev; Secure; Partitioned; Priority=High');
    expect(parsed).toMatchObject({
      domain: 'mlain.dev',
      secure: true,
      partitioned: true,
      priority: 'high',
    });
  });

  it('u hlavičky bez dvojice jméno=hodnota vrátí undefined', () => {
    expect(parseSetCookie('')).toBeUndefined();
    expect(parseSetCookie('bez-rovnitka')).toBeUndefined();
    expect(parseSetCookie('=hodnota')).toBeUndefined();
    expect(parseSetCookie('   =hodnota')).toBeUndefined();
  });

  it('nepřebírá atributy, kterým nerozumí', () => {
    const parsed = parseSetCookie('a=b; Vymyslene=1');
    expect(parsed).toEqual({ name: 'a', value: 'b' });
  });
});

describe('parseSetCookies', () => {
  it('rozebere víc hlaviček zvlášť, i když mají v Expires čárku', () => {
    const headers = new Headers();
    headers.append('set-cookie', SESSION);
    headers.append('set-cookie', 'jina=1; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT');

    const parsed = parseSetCookies(headers);
    expect(parsed.map((cookie) => cookie.name)).toEqual(['ml_session', 'jina']);
    // Kdyby se použilo `get('set-cookie')`, obě hlavičky by se slepily do
    // jednoho řetězce a tenhle test by našel jednu rozbitou cookie.
    expect(parsed).toHaveLength(2);
  });

  it('u odpovědi bez cookie vrátí prázdné pole', () => {
    expect(parseSetCookies(new Headers())).toEqual([]);
  });
});
