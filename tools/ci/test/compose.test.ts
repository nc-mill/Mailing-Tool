import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const compose = (): string => fs.readFileSync(path.join(ROOT, 'docker/compose.yml'), 'utf8');

describe('docker/compose.yml', () => {
  it('je platný compose soubor', () => {
    execFileSync('docker', ['compose', '-f', path.join(ROOT, 'docker/compose.yml'), 'config'], {
      env: { ...process.env, APP_URL: 'https://x.example', SECRET_KEY: 'k' },
      encoding: 'utf8',
    });
  });

  it('mountuje /var/lib/postgresql, NE /var/lib/postgresql/data (kritérium 8b)', () => {
    const text = compose();
    expect(text).toContain(':/var/lib/postgresql\n');
    expect(text).not.toContain(':/var/lib/postgresql/data');
  });

  it('má stop_grace_period 40s, tedy o 15 s víc než SHUTDOWN_GRACE_SECONDS', () => {
    expect(compose()).toContain('stop_grace_period: 40s');
  });

  it('běží s read_only rootfs a no-new-privileges (kritérium 8)', () => {
    const text = compose();
    expect(text).toContain('read_only: true');
    expect(text).toContain('no-new-privileges:true');
  });

  it('vyžaduje APP_URL a SECRET_KEY, nemá pro ně výchozí hodnotu', () => {
    const text = compose();
    expect(text).toMatch(/APP_URL: \$\{APP_URL:\?/);
    expect(text).toMatch(/SECRET_KEY: \$\{SECRET_KEY:\?/);
  });

  it('předává DATABASE_URL_MIGRATOR, jinak nemá runner čím se připojit', () => {
    expect(compose()).toContain('DATABASE_URL_MIGRATOR:');
  });

  it('nepoužívá tag latest v produkčním příkladu', () => {
    expect(compose()).not.toMatch(/image: ghcr\.io\/nc-mill\/mlain:latest/);
  });

  it('postgres je pod profilem bundled, aby šel vypnout', () => {
    expect(compose()).toContain('profiles: ["bundled"]');
  });
});

describe('docker/initdb/10-roles.sql', () => {
  const sql = (): string => fs.readFileSync(path.join(ROOT, 'docker/initdb/10-roles.sql'), 'utf8');

  it('zakládá všech šest rolí, které vyžaduje model oprávnění', () => {
    const text = sql();
    // Šest, ne čtyři. mlain_gdpr a mlain_maintenance přibyly po nálezu, že bez
    // nich není v produkci proveditelný výmaz podle článku 17 ani retenční
    // mazání web_events, a že to selže TIŠE: migrace granty na chybějící roli
    // přeskočí a testovací harness si role zakládá sám.
    for (const role of [
      'mlain_migrator',
      'mlain_app',
      'mlain_sender',
      'mlain_backup',
      'mlain_gdpr',
      'mlain_maintenance',
    ]) {
      expect(text, `chybí role ${role}`).toContain(role);
    }
  });

  it('je idempotentní, každý CREATE ROLE má ochranu proti opakování', () => {
    // Původní znění tohohle testu bylo `expect(creates.length).toBe(0)`, což
    // proti souboru, který tentýž úkol o pár kroků dál zapisuje, nemohlo projít
    // nikdy: pět CREATE ROLE tam je, jen uvnitř ochranných bloků. Měřit se má
    // záměr, tedy „žádný CREATE ROLE není NECHRÁNĚNÝ".
    //
    // Kontrola je zároveň přísnější než `toContain('pg_catalog.pg_roles')`:
    // ta projde i tehdy, když je chráněná jediná role z pěti, nebo když je
    // ochrana omylem napsaná na jiné jméno, než jaké se pak zakládá.
    const lines = sql().split('\n');
    const unguarded: string[] = [];
    lines.forEach((line, index) => {
      const match = /CREATE\s+ROLE\s+([a-z_]+)/i.exec(line);
      if (!match || /IF\s+NOT\s+EXISTS/i.test(line)) return;
      const guard = lines.slice(Math.max(0, index - 3), index).join('\n');
      // `match[1]` je při `noUncheckedIndexedAccess` typu `string | undefined`,
      // přestože ho regulární výraz vždycky naplní. Kontrola je tu proto pro
      // typy, ne proti skutečnému stavu.
      const role = match[1];
      if (role === undefined) return;
      const guarded =
        /IF\s+NOT\s+EXISTS/i.test(guard) &&
        /pg_catalog\.pg_roles/i.test(guard) &&
        guard.includes(`'${role}'`);
      if (!guarded) unguarded.push(role);
    });
    expect(unguarded, 'CREATE ROLE bez ochrany proti opakování').toEqual([]);
    // Pojistka proti prázdné množině: kdyby se soubor rozpadl, test by byl
    // zeleně splněný nad nulou rolí.
    expect((sql().match(/CREATE\s+ROLE/gi) ?? []).length).toBe(5);
  });

  it('nastavuje časovou zónu databáze na UTC', () => {
    // ALTER DATABASE smí jen vlastník databáze nebo superuživatel, a
    // mlain_migrator není ani jedno. Musí to tedy proběhnout tady, v initdb,
    // ne v migraci. Požadavek P03, kapitola 7, řádek B.
    //
    // Hledá se volání `format`, ne doslovné `ALTER DATABASE mlain`: jméno
    // databáze přestalo být napevno, bere se z `POSTGRES_DB`, protože instalace
    // s jinak pojmenovanou databází jinak tenhle krok tiše přeskočila. Ani
    // `GRANT`, ani `ALTER DATABASE` nepřijímají výraz, takže se jméno musí
    // vložit přes `%I` do textu příkazu.
    expect(sql()).toMatch(/ALTER DATABASE %I SET timezone = %L'\s*,\s*db\s*,\s*'UTC'/);
  });

  it('zakládá schéma pgboss vlastněné aplikační rolí', () => {
    const text = sql();
    expect(text).toContain('CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mlain_app');
  });

  it('nedává aplikační roli vlastnictví schématu public', () => {
    expect(sql()).not.toMatch(/ALTER SCHEMA public OWNER TO mlain_app/);
  });

  it('každá zakládaná role dostane CONNECT i USAGE, kromě zálohovací', () => {
    const text = sql();
    for (const role of ['mlain_app', 'mlain_sender', 'mlain_gdpr', 'mlain_maintenance']) {
      expect(
        text.match(new RegExp(`GRANT CONNECT[\\s\\S]*?${role}`)),
        `${role} bez CONNECT`,
      ).not.toBeNull();
      expect(
        text.match(new RegExp(`GRANT USAGE ON SCHEMA public[\\s\\S]*?${role}`)),
        `${role} bez USAGE`,
      ).not.toBeNull();
    }
    // mlain_backup má pg_read_all_data a USAGE nepotřebuje.
    expect(text).toContain('GRANT pg_read_all_data TO mlain_backup');
  });
});

describe('.env.example', () => {
  it('obsahuje všechny povinné proměnné a žádnou skutečnou hodnotu tajemství', () => {
    const text = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    for (const name of ['APP_URL', 'SECRET_KEY', 'POSTGRES_PASSWORD']) {
      expect(text, `chybí ${name}`).toContain(name);
    }
    expect(text).toContain('mlain genkey');
  });
});
