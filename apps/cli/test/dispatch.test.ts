import { describe, expect, it } from 'vitest';
import { EXIT_CONFIG, EXIT_UNAVAILABLE, EXIT_USAGE } from '../src/exit-codes';
import { COMMANDS } from '../src/registry';
import { dispatch } from '../src/dispatch';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

describe('mlain dispatcher', () => {
  it('zná všechny podpříkazy, které specifikace jmenuje', () => {
    const names = COMMANDS.map((command) => command.name).sort();
    expect(names).toEqual([
      'backup',
      'config',
      'doctor',
      'genkey',
      'healthcheck',
      'migrate',
      // `partitions` je jediné místo, kde se v produktu uklízí odeslaná pošta.
      // Dřív úklid neexistoval: dvě retenční fronty byly v registru bez
      // obsluhy, protože odpojení oddílu je DDL a worker na ně nemá práva.
      'partitions',
      // Přepočet stavu souhlasů. Obsluha fronty `consents.rebuild_state` existovala,
      // ale vedl k ní jedině ruční INSERT do tabulky úloh pg-bossu, takže nástroj
      // na obnovu byl v praxi nedosažitelný právě po obnově ze zálohy.
      'rebuild-consents',
      'rebuild-engagement',
      // Jednorázové převlečení uložených e-mailů do barev značky. Bez příkazu
      // by instalace, která značku má a od upgradu ji znovu neuloží, zůstala
      // se starými barvami napořád: jinak převlékání spouští až uložení značky.
      'redress-brand',
      'reset-password',
      'restore',
      'rotate-credentials',
      'upgrade',
      'version',
    ]);
  });

  it('zná podpříkazy, které vlastník příkazu skutečně dodává', () => {
    const backup = COMMANDS.find((command) => command.name === 'backup');
    // P16 implementuje `backup`, `backup verify` i `backup list`. Kdyby tady
    // `list` chyběl, dispatcher by ho odmítl jako špatný argument.
    expect([...(backup?.subcommands ?? [])].sort()).toEqual(['list', 'verify']);
  });

  it('bez argumentů vypíše nápovědu a skončí 64', async () => {
    const streams = io();
    const code = await dispatch([], streams);
    expect(code).toBe(EXIT_USAGE);
    expect(streams.out.join('\n')).toContain('mlain <příkaz>');
    expect(streams.out.join('\n')).toContain('backup');
  });

  it('neznámý příkaz skončí 64 s návrhem', async () => {
    const streams = io();
    const code = await dispatch(['bakcup'], streams);
    expect(code).toBe(EXIT_USAGE);
    expect(streams.err.join('\n')).toContain('bakcup');
    expect(streams.err.join('\n')).toContain('backup');
  });

  it('deklarovaný, ale neimplementovaný příkaz skončí 69 s jasnou chybou', async () => {
    // Konkrétní jméno se tu SCHVÁLNĚ nepíše. Dřív tu byl `backup`, pak
    // `migrate`, a oba mezitím jejich plány dodaly; test pak měřil opak toho,
    // co má, protože implementovaný příkaz končí na chybějící konfiguraci (78),
    // ne na 69. Bere se proto libovolný příkaz, který je v registru
    // deklarovaný a zatím nedodaný.
    const pending = COMMANDS.find((command) => !command.implemented);
    if (!pending) return; // Všechno je dodané, tahle větev už nemá co ověřit.
    const streams = io();
    const code = await dispatch([pending.name], streams);
    expect(code).toBe(EXIT_UNAVAILABLE);
    const text = streams.err.join('\n');
    expect(text).toContain('not implemented');
    expect(text).toContain(pending.owner);
  });

  // Tenhle test dřív ověřoval, že `migrate` hlásí „dodá ho P03", a zůstal
  // zelený i poté, co příkaz vznikl: `dispatch` u něj tou dobou ještě vracel
  // EXIT_UNAVAILABLE. Zastaralý zelený test je horší než žádný, protože tvrdí,
  // že se něco měří. Teď měří skutečné chování implementovaného příkazu.
  it('migrate bez konfigurace vrátí EXIT_CONFIG a jmenuje chybějící proměnné', async () => {
    const streams = { ...io(), env: { NODE_ENV: 'test' } };

    const code = await dispatch(['migrate'], streams);

    expect(code).toBe(EXIT_CONFIG);
    const text = streams.err.join('\n');
    // Validace hlásí VŠECHNY chybějící proměnné najednou, ne jen první.
    // `DATABASE_URL_MIGRATOR` mezi nimi není: konfigurace padne dřív na
    // základních povinných hodnotách a k volitelným se nedostane.
    expect(text).toContain('SECRET_KEY');
    expect(text).toContain('DATABASE_URL');
    // Nesmí to spadnout výjimkou. Příkaz dřív volal `streams.err.write()`,
    // jenže `CliStreams` má metody `stdout()`/`stderr()`, ne objekty s `write`.
    // Padalo to na `TypeError: Cannot read properties of undefined`, tedy
    // neodchyceně a bez exit kódu. Entrypoint kontejneru se rozhoduje podle
    // exit kódu, takže by instalace vůbec nenaběhla.
    expect(text).not.toContain('TypeError');
  });

  it('version vypíše verzi a skončí nulou', async () => {
    const streams = io();
    const code = await dispatch(['version'], { ...streams, env: { IMAGE_VERSION: '9.9.9' } });
    expect(code).toBe(0);
    expect(streams.out.join('\n')).toContain('9.9.9');
  });

  it('--help u konkrétního příkazu vypíše jeho popis a skončí nulou', async () => {
    const streams = io();
    const code = await dispatch(['backup', '--help'], streams);
    expect(code).toBe(0);
    expect(streams.out.join('\n')).toContain('zálohu');
  });

  it('každý neimplementovaný příkaz zná plán, který ho dodá', () => {
    for (const command of COMMANDS) {
      if (command.implemented) continue;
      expect(command.owner, `${command.name} nemá vlastníka`).toMatch(/^P\d\d$/);
    }
  });

  it('config check při vadné konfiguraci skončí 78', async () => {
    const streams = io();
    const code = await dispatch(['config', 'check'], { ...streams, env: {} });
    expect(code).toBe(78);
    expect(streams.err.join('\n')).toContain('SECRET_KEY');
  });
});
