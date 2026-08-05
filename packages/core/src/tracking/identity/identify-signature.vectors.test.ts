import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalize } from './jcs';
import { verifyIdentifySignature } from './signature';

type Vector = {
  secret_key: string;
  external_id: string;
  traits: Record<string, unknown>;
  expected_jcs: string;
  signature: string;
};

/**
 * Přepsáno ze specifikace 3.6.3, ne načteno z fixture. Kdyby test četl
 * očekávanou kanonizaci z téhož souboru, který generátor zapsal, ptal by se
 * sám sebe a rozchod s RFC 8785 by prošel oběma stranami stejně.
 */
const SPEC_JCS =
  '{"email":"jan@example.cz","first_name":"Jan","ltv":1490.5,"note":"čeština","orders":3,"vip":true}';

/**
 * Podpis je taky přepsaný, a to z plánu P10 Task 28 Step 6, kde je zmrazený.
 * Kdyby ho test bral z fixture, neodhalil by změnu oddělovače ani kanonizace:
 * generátor by zapsal jinou hodnotu a test by ji poslušně potvrdil.
 */
const PLAN_SIGNATURE = 'GoE8G84t_u2jgjfQlWLvaKoFe3RQs91Pwjo1dMn9Ceg';

const vector = JSON.parse(
  readFileSync(new URL('../fixtures/identify-signature.json', import.meta.url), 'utf8'),
) as Vector;

describe('identify signature vector', () => {
  it('fixture nese přesně tu kanonizaci, kterou předepisuje specifikace', () => {
    expect(vector.expected_jcs).toBe(SPEC_JCS);
  });

  it('kanonizace implementace sedí na řetězec ze specifikace', () => {
    expect(canonicalize(vector.traits)).toBe(SPEC_JCS);
  });

  it('fixture nese podpis zmrazený v plánu', () => {
    expect(vector.signature).toBe(PLAN_SIGNATURE);
  });

  it('podpis z fixture se ověří', () => {
    expect(
      verifyIdentifySignature({
        externalId: vector.external_id,
        traits: vector.traits,
        signature: vector.signature,
        secret: Buffer.from(vector.secret_key, 'utf8'),
      }),
    ).toBe(true);
  });

  it('podpis z fixture neprojde po změně jediného znaku v traits', () => {
    expect(
      verifyIdentifySignature({
        externalId: vector.external_id,
        traits: { ...vector.traits, first_name: 'Jana' },
        signature: vector.signature,
        secret: Buffer.from(vector.secret_key, 'utf8'),
      }),
    ).toBe(false);
  });
});
