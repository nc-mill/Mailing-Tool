import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const dockerfile = (): string => fs.readFileSync(path.join(ROOT, 'docker/Dockerfile'), 'utf8');

/** Dockerfile bez komentářů. Testy zákazů mají hlídat instrukce, ne vysvětlivky. */
const instructions = (): string =>
  dockerfile()
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

describe('Dockerfile', () => {
  it('deklaruje ARG IMAGE_VERSION globálně i v každé fázi, která ho čte', () => {
    const text = dockerfile();
    // Nedeklarovaná ${...} se v Dockerfile rozvine na PRÁZDNÝ ŘETĚZEC, tiše.
    const stagesUsingVersion = text
      .split(/^FROM /m)
      .slice(1)
      .filter((stage) => stage.includes('${IMAGE_VERSION}'));
    for (const stage of stagesUsingVersion) {
      expect(stage, `fáze používá ${'${IMAGE_VERSION}'} bez ARG`).toMatch(
        /^\s*\S+.*\n(.|\n)*?ARG IMAGE_VERSION/,
      );
    }
    expect(text).toMatch(/^ARG IMAGE_VERSION=/m);
  });

  it('kopíruje manifesty přes turbo prune, nikdy globem (kritérium 7d)', () => {
    const text = dockerfile();
    expect(text).toContain('turbo@2.10.7 prune');
    // Glob s jedním cílovým adresářem zploští devět manifestů do jednoho souboru.
    // Kontrola běží nad `instructions()`, ne nad `dockerfile()`: vysvětlivka
    // k pruneru cituje přesně tenhle zakázaný glob jako odstrašující příklad,
    // takže nad textem s komentáři by test padal na vlastní citaci.
    expect(instructions()).not.toMatch(/COPY\s+packages\/\*\/package\.json/);
    expect(instructions()).not.toMatch(/COPY\s+apps\/\*\/package\.json/);
  });

  it('prune filtr obsahuje všechny tři Node aplikace', () => {
    const text = dockerfile();
    for (const app of ['@mlain/web', '@mlain/worker', '@mlain/cli']) {
      expect(text, `prune neobsahuje ${app}`).toContain(app);
    }
  });

  it('běží pod uživatelem 10001 (kritérium 7)', () => {
    expect(dockerfile()).toMatch(/^USER 10001:10001$/m);
  });

  it('má tini jako PID 1 a entrypoint.sh za ním', () => {
    expect(dockerfile()).toContain(
      'ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]',
    );
  });

  it('instaluje postgresql18-client kvůli pg_dump a pg_restore', () => {
    expect(dockerfile()).toContain('postgresql18-client');
  });

  it('HEALTHCHECK volá mlain healthcheck', () => {
    expect(dockerfile()).toContain('CMD ["/usr/local/bin/mlain", "healthcheck"]');
  });

  it('nastavuje rozdílné výchozí health porty (kritérium 8c)', () => {
    const text = dockerfile();
    expect(text).toContain('WORKER_HEALTH_PORT=3001');
    expect(text).toContain('SENDER_HEALTH_PORT=3002');
  });

  it('kopíruje artefakty všech tří aplikací i CLI', () => {
    const text = dockerfile();
    for (const artefact of [
      'apps/web/.next/standalone',
      'apps/worker/dist',
      'apps/cli/dist',
      '/out/ml-sender',
    ]) {
      expect(text, `chybí COPY ${artefact}`).toContain(artefact);
    }
  });

  it('zapisuje jen do /data a deklaruje ho jako svazek (kritérium 8)', () => {
    const text = dockerfile();
    expect(text).toContain('VOLUME ["/data"]');
    expect(text).toMatch(/chown -R 10001:10001 \/data/);
  });

  // Wildcard v COPY se na chybějícím adresáři NECHOVÁ jako no-op: build skončí
  // na `lstat ...: no such file or directory`. Každá cesta v COPY proto musí
  // existovat, a test integrity workspace ověřuje, že ty dvě zakládané opravdu
  // vzniknou.
  //
  // Komentáře se odfiltrují: Dockerfile ten zrušený řádek cituje ve vysvětlivce
  // a test má hlídat instrukce, ne prózu.
  it('nekopíruje packages/contracts/fixtures, ten adresář v téhle fázi neexistuje', () => {
    expect(instructions()).not.toMatch(/COPY\s+packages\/contracts\/fixtures/);
  });

  it('kopíruje migrace, jinak by image neměla co aplikovat', () => {
    expect(instructions()).toContain('/app/packages/db/migrations ./packages/db/migrations');
  });

  it('žádný COPY nespoléhá na wildcard v adresáři', () => {
    // `COPY neco*/ cil/` vypadá jako podmíněná kopie, ale není: chybějící
    // nadřazený adresář build zabije. Ověřeno spuštěním docker buildu.
    const offenders = instructions()
      .split('\n')
      .filter((line) => /^COPY\s/.test(line) && /\*\//.test(line));
    expect(offenders, 'COPY s wildcardem v adresáři není podmíněná kopie').toEqual([]);
  });
});
