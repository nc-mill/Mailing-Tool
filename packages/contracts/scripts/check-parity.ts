import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Report = {
  language: 'ts' | 'go';
  section: string;
  total: number;
  executed: number;
  skipped: number;
  ids: string[];
  groups: Record<string, number>;
  fixturesDigest: string;
};

type SideExpectation = { ids: string[]; groups: Record<string, number> };
type SectionExpectation = { ts: SideExpectation; go: SideExpectation; digest: string };
type VectorItem = { id: string; sides?: Array<'ts' | 'go'> };

/**
 * Kódy, které MUSÍ mít alespoň jednu fixture. Je to sloučení tabulky zakázaných
 * konstrukcí z kontraktu 4.10.2 a negativních vektorů ze 4.10.3 a 4.10.4.
 * Nová zakázaná konstrukce bez fixture spadne tady.
 */
const REQUIRED_LIQUID_CODES = [
  'liquid_tag_not_allowed',
  'liquid_whitespace_control_not_allowed',
  'liquid_filter_not_allowed',
  'liquid_vocative_filter',
  'liquid_contains_not_allowed',
  'liquid_parentheses_not_allowed',
  'liquid_nested_for',
  'liquid_for_parameter_not_allowed',
  'liquid_index_not_allowed',
  'liquid_comparison_operator_not_supported',
  'liquid_string_literal_not_allowed',
  'liquid_escaped_entity_in_construct',
  'liquid_literal_not_supported',
  // Doplněno: kontrakt ho v tabulce zakázaných konstrukcí má a část 3 na něj
  // má kritérium 8.4/28, ale fixture neměl žádnou. Doplnila ho LQ-511.
  'liquid_date_format_not_allowed',
];

const REQUIRED_TOKEN_ERRORS = [
  'token_malformed',
  'token_signature_invalid',
  'token_type_mismatch',
  'token_unknown_key',
  'token_expired',
  'token_already_used',
];

const REQUIRED_CRYPTO_ERRORS = [
  'crypto_envelope_malformed',
  'crypto_unsupported_version',
  'crypto_context_mismatch',
  'crypto_unknown_key',
  'crypto_auth_failed',
];

const BOTH: Array<'ts' | 'go'> = ['ts', 'go'];

async function digestOf(files: string[]): Promise<string> {
  const outer = createHash('sha256');
  for (const file of [...files].sort()) {
    const body = await readFile(file);
    outer.update(path.basename(file));
    outer.update('\0');
    outer.update(createHash('sha256').update(body).digest('hex'));
    outer.update('\n');
  }
  return outer.digest('hex');
}

/**
 * Očekávaná množina id pro každou sekci a stranu, spočítaná Z FIXTUR NA DISKU.
 * Tohle je jádro celé kontroly: parita se neporovnává report proti reportu, ale
 * OBA reporty proti datům. Kdyby si obě strany odpustily tutéž fixture, srovnání
 * report proti reportu by prošlo.
 */
export async function expectedIds(
  packageRoot: string,
): Promise<Record<string, SectionExpectation>> {
  const fixtures = (...parts: string[]): string => path.join(packageRoot, 'fixtures', ...parts);
  const out: Record<string, SectionExpectation> = {};

  const perFile = async (
    dir: string,
    section: string,
    group?: (id: string) => string,
  ): Promise<void> => {
    const names = (await readdir(fixtures(dir))).filter((f) => f.endsWith('.json')).sort();
    const sides: Record<'ts' | 'go', SideExpectation> = {
      ts: { ids: [], groups: {} },
      go: { ids: [], groups: {} },
    };
    for (const name of names) {
      const fixture = JSON.parse(await readFile(fixtures(dir, name), 'utf8')) as {
        id: string;
        sides?: Array<'ts' | 'go'>;
      };
      for (const side of fixture.sides ?? BOTH) {
        sides[side].ids.push(fixture.id);
        if (group) {
          const key = group(fixture.id);
          sides[side].groups[key] = (sides[side].groups[key] ?? 0) + 1;
        }
      }
    }
    sides.ts.ids.sort();
    sides.go.ids.sort();
    out[section] = { ...sides, digest: await digestOf(names.map((name) => fixtures(dir, name))) };
  };

  const perVectorFile = async (
    dir: string,
    file: string,
    section: string,
    pick: (data: unknown) => VectorItem[],
  ): Promise<void> => {
    const data = JSON.parse(await readFile(fixtures(dir, file), 'utf8'));
    const sides: Record<'ts' | 'go', SideExpectation> = {
      ts: { ids: [], groups: {} },
      go: { ids: [], groups: {} },
    };
    for (const item of pick(data)) {
      for (const side of item.sides ?? BOTH) sides[side].ids.push(item.id);
    }
    sides.ts.ids.sort();
    sides.go.ids.sort();
    out[section] = { ...sides, digest: await digestOf([fixtures(dir, file)]) };
  };

  await perFile('liquid', 'liquid', (id) => `LQ-${id.slice(3, 4)}xx`);
  await perFile('markers', 'markers');
  await perVectorFile('token', 'vectors.json', 'token', (d) => {
    const data = d as { positive: VectorItem[]; negative: VectorItem[] };
    return [...data.positive, ...data.negative];
  });
  await perVectorFile('crypto', 'vectors.json', 'crypto', (d) => {
    const data = d as { positive: VectorItem[]; negative: VectorItem[] };
    return [...data.positive, ...data.negative];
  });
  await perVectorFile(
    'message-id',
    'vectors.json',
    'message-id',
    (d) => (d as { cases: VectorItem[] }).cases,
  );
  await perVectorFile(
    'outbox',
    'scenarios.json',
    'outbox',
    (d) => (d as { transitions: VectorItem[] }).transitions,
  );
  return out;
}

export async function checkParity(
  packageRoot: string,
  options: { override?: Record<string, unknown>; requireExtraCode?: string } = {},
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const expected = await expectedIds(packageRoot);

  const readReport = async (file: string): Promise<Report | undefined> => {
    if (options.override) return options.override[file] as Report | undefined;
    try {
      return JSON.parse(await readFile(path.join(packageRoot, 'reports', file), 'utf8')) as Report;
    } catch {
      return undefined;
    }
  };

  for (const [section, expectation] of Object.entries(expected)) {
    for (const language of BOTH) {
      const file = `${language}-golden-${section}.json`;
      const report = await readReport(file);
      if (!report) {
        errors.push(
          `chybí report ${file}; parita nad jednou stranou není parita, ` +
            'spusť golden testy obou jazyků',
        );
        continue;
      }
      const want = expectation[language];

      if (report.skipped !== 0) {
        errors.push(`${file}: ${report.skipped} přeskočených fixtur, přeskočení není povolené`);
      }
      if (report.executed !== report.total) {
        errors.push(`${file}: provedeno ${report.executed} z ${report.total}, musí být všechno`);
      }
      if (report.executed !== report.ids.length) {
        errors.push(`${file}: executed ${report.executed}, ale id je ${report.ids.length}`);
      }
      if (report.fixturesDigest !== expectation.digest) {
        errors.push(
          `${file}: otisk fixtures nesedí s obsahem disku, report je z jiného běhu ` +
            `(${report.fixturesDigest.slice(0, 12)} vs ${expectation.digest.slice(0, 12)})`,
        );
      }

      const got = new Set(report.ids);
      const missing = want.ids.filter((id) => !got.has(id));
      const extra = report.ids.filter((id) => !want.ids.includes(id));
      if (missing.length > 0) errors.push(`${file}: nezpracované fixtures ${missing.join(', ')}`);
      if (extra.length > 0) errors.push(`${file}: neznámé fixtures ${extra.join(', ')}`);

      for (const group of new Set([...Object.keys(want.groups), ...Object.keys(report.groups)])) {
        if ((want.groups[group] ?? 0) !== (report.groups[group] ?? 0)) {
          errors.push(
            `${file}: skupina ${group} má ${report.groups[group] ?? 0}, čeká se ${want.groups[group] ?? 0}`,
          );
        }
      }
    }
  }

  // Každý kód z tabulek zakázaných konstrukcí a negativních vektorů má fixture.
  const liquidDir = path.join(packageRoot, 'fixtures', 'liquid');
  const liquidFiles = (await readdir(liquidDir)).filter((f) => f.endsWith('.json'));
  const seenLiquid = new Set<string>();
  for (const file of liquidFiles) {
    const fixture = JSON.parse(await readFile(path.join(liquidDir, file), 'utf8')) as {
      expect_validation_error?: { code: string };
    };
    if (fixture.expect_validation_error) seenLiquid.add(fixture.expect_validation_error.code);
  }
  const required = [
    ...REQUIRED_LIQUID_CODES,
    ...(options.requireExtraCode ? [options.requireExtraCode] : []),
  ];
  for (const code of required) {
    if (!seenLiquid.has(code)) errors.push(`kód ${code} nemá ani jednu fixture`);
  }

  const tokens = JSON.parse(
    await readFile(path.join(packageRoot, 'fixtures', 'token', 'vectors.json'), 'utf8'),
  ) as { negative: Array<{ expected_error: string }> };
  const seenToken = new Set(tokens.negative.map((n) => n.expected_error));
  for (const code of REQUIRED_TOKEN_ERRORS) {
    if (!seenToken.has(code)) errors.push(`negativní vektor ${code} chybí`);
  }

  const crypto = JSON.parse(
    await readFile(path.join(packageRoot, 'fixtures', 'crypto', 'vectors.json'), 'utf8'),
  ) as { negative: Array<{ expected_error: string }> };
  const seenCrypto = new Set(crypto.negative.map((n) => n.expected_error));
  for (const code of REQUIRED_CRYPTO_ERRORS) {
    if (!seenCrypto.has(code)) errors.push(`negativní vektor ${code} chybí`);
  }

  return { errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await checkParity(packageRoot);
  if (result.errors.length > 0) {
    console.error('test:parity selhal:');
    for (const error of result.errors) console.error('  ' + error);
    process.exit(1);
  }
  console.log('test:parity: počty, množiny id, otisky i pokrytí kódů v pořádku');
}
