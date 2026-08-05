import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { canonicalize } from '../identity/jcs';

/**
 * Generátor závazného vektoru podpisu `identify`, viz plán P10 Task 28 Step 6.
 *
 * ROZHODNUTÍ O VLASTNICTVÍ. Specifikace 3.6.3 a požadavek 12.5.21 umisťují
 * vektor do `packages/contracts/fixtures/identify/signature.json`, ale P02 tu
 * skupinu fixtures nemá a nemá ji proč mít: podpis `identify` není jedním z pěti
 * zmrazených kontraktů mezi TypeScriptem a Go, sender ho nevyrábí ani neověřuje
 * a v Go pro něj neexistuje druhá implementace, kterou by měly golden fixtures
 * srovnávat. Vektor proto vlastní plán P10 a leží tady. Účel zůstává beze
 * zbytku: zákazník, který si podpis vyrábí v PHP nebo Pythonu, má proti čemu
 * měřit.
 *
 * ODKUD SE BEROU HODNOTY. Vstupy a `expected_jcs` jsou přepsané ze specifikace
 * 3.6.3, tedy ze zdroje, který o naší implementaci nic neví. Hodnotu
 * `signature` dopočítává tenhle generátor přesně tak, jak specifikace
 * předepisuje.
 *
 * Spuštění: `pnpm --filter @mlain/core exec tsx src/tracking/fixtures/generate-identify-signature.ts`
 */

/** Přepsáno z 3.6.3 části 5. Nikdy neupravuj podle toho, co vyjde. */
const SECRET_KEY = 'ml_live_0123456789abcdef';
const EXTERNAL_ID = 'customer_8472';
const TRAITS = {
  first_name: 'Jan',
  email: 'jan@example.cz',
  orders: 3,
  ltv: 1490.5,
  vip: true,
  note: 'čeština',
} as const;
const EXPECTED_JCS =
  '{"email":"jan@example.cz","first_name":"Jan","ltv":1490.5,"note":"čeština","orders":3,"vip":true}';

const jcs = canonicalize(TRAITS);
if (jcs !== EXPECTED_JCS) {
  throw new Error(`kanonizace se rozešla se specifikací 3.6.3:\n  ${jcs}\n  ${EXPECTED_JCS}`);
}

const input = Buffer.concat([
  Buffer.from(EXTERNAL_ID, 'utf8'),
  Buffer.from([0x0a]),
  Buffer.from(jcs, 'utf8'),
]);
const signature = createHmac('sha256', Buffer.from(SECRET_KEY, 'utf8'))
  .update(input)
  .digest('base64url');

writeFileSync(
  new URL('./identify-signature.json', import.meta.url),
  `${JSON.stringify(
    {
      secret_key: SECRET_KEY,
      external_id: EXTERNAL_ID,
      traits: TRAITS,
      expected_jcs: EXPECTED_JCS,
      signature,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
