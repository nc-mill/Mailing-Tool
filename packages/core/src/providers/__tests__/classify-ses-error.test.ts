import { describe, expect, it } from 'vitest';
import { classifySesError } from '../ses/classify-error';

/**
 * Tvary chyb jsou opsané ze skutečných výjimek AWS SDK v3: služba je vrací
 * v poli `name`, síťová vrstva Node v poli `code`. Test hlídá to jediné, na čem
 * uživateli záleží: aby dostal radu, která odpovídá jeho chybě.
 */
describe('roztřídění chyby z Amazonu', () => {
  it('neznámý pár klíčů je chyba přihlašovacích údajů', () => {
    expect(classifySesError({ name: 'UnrecognizedClientException' })).toBe('credentials');
    expect(classifySesError({ name: 'InvalidClientTokenId' })).toBe('credentials');
    expect(classifySesError({ name: 'SignatureDoesNotMatch' })).toBe('credentials');
  });

  it('platný klíč bez práva na volání je chyba oprávnění, ne klíče', () => {
    expect(classifySesError({ name: 'AccessDeniedException' })).toBe('permissions');
    expect(
      classifySesError({
        name: 'ServiceException',
        message: 'User: arn:aws:iam::1:user/x is not authorized to perform: ses:GetAccount',
      }),
    ).toBe('permissions');
  });

  it('nepřeložený endpoint Amazonu ukazuje na region, ne na výpadek sítě', () => {
    expect(
      classifySesError({
        name: 'Error',
        code: 'ENOTFOUND',
        message: 'getaddrinfo ENOTFOUND email.eu-cetnral-1.amazonaws.com',
      }),
    ).toBe('region');
    expect(classifySesError({ name: 'UnknownEndpoint' })).toBe('region');
  });

  it('nepřeložené cizí jméno je výpadek sítě, ne špatný region', () => {
    // Rada „opravte si region" u chyby DNS, která s regionem nesouvisí, posílá
    // uživatele přepisovat hodnotu, se kterou není nic špatně.
    expect(
      classifySesError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND proxy.local' }),
    ).toBe('network');
  });

  it('vypršení a odmítnuté spojení je síť', () => {
    expect(classifySesError({ name: 'TimeoutError' })).toBe('network');
    expect(classifySesError({ code: 'ECONNREFUSED' })).toBe('network');
  });

  it('nezařaditelná chyba nekončí pádem ani vymyšleným důvodem', () => {
    expect(classifySesError(new Error('něco úplně jiného'))).toBe('unknown');
    expect(classifySesError(null)).toBe('unknown');
    expect(classifySesError(undefined)).toBe('unknown');
    expect(classifySesError('řetězec')).toBe('unknown');
  });
});
