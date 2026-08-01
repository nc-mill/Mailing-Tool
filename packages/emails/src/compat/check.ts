/**
 * Datová sada `caniemail.json` je vendorovaná, ne stahovaná při buildu: build
 * nesmí záviset na cizí síti. Zdroj `https://www.caniemail.com/api/data.json`,
 * repozitář `hteumeuleu/caniemail`, licence MIT. Staženo 1. 8. 2026,
 * `api_version` 1.0.4, `last_update_date` 2026-07-20. Aktualizace je vždy
 * ruční krok, ať je v historii vidět, kdy se podpora klientů posunula.
 */
import data from './caniemail.json' with { type: 'json' };

export const TIER1_CLIENTS = [
  'gmail-desktop-webmail',
  'gmail-android',
  'apple-mail-macos',
  'apple-mail-ios',
  'outlook-windows',
  'outlook-com',
] as const;

export type Tier1Client = (typeof TIER1_CLIENTS)[number];

export type CompatFinding = {
  feature: string;
  usedAt: string;
  support: Record<Tier1Client, 'y' | 'a' | 'n' | 'u'>;
  severity: 'error' | 'warning' | 'info';
};

/**
 * Vědomé výjimky: degradují bez rozbití a UI o nich u bloků informuje.
 * Cokoliv mimo tenhle seznam s podporou "n" u klienta úrovně 1 je chyba.
 */
const KNOWN_EXCEPTIONS = new Set([
  'css-border-radius',
  'css-box-shadow',
  'css-letter-spacing',
  'css-at-media',
]);

/**
 * Rozklad jména klienta na rodinu a platformu datové sady.
 *
 * Plán tady dělá `client.split("-")` a první díl bere jako rodinu. Na třech
 * z šesti klientů to nesedí: `apple-mail-macos` by hledalo rodinu `apple`,
 * kterou datová sada nemá, a `outlook-com` platformu `com`, po které by kód
 * spadl do větve „vezmi první platformu rodiny", tedy do dat Outlooku pro
 * Windows. Podpora Outlook.com by se pak hlásila jako podpora Wordového enginu
 * a `border-radius` by vycházel jako nepodporovaný i tam, kde funguje.
 * Rozpad je proto zapsaný natvrdo, aby ho nešlo splést.
 */
const CLIENT_KEYS: Record<Tier1Client, [family: string, platform: string]> = {
  'gmail-desktop-webmail': ['gmail', 'desktop-webmail'],
  'gmail-android': ['gmail', 'android'],
  'apple-mail-macos': ['apple-mail', 'macos'],
  'apple-mail-ios': ['apple-mail', 'ios'],
  'outlook-windows': ['outlook', 'windows'],
  'outlook-com': ['outlook', 'outlook-com'],
};

type Entry = {
  slug: string;
  title: string;
  stats: Record<string, Record<string, Record<string, string>>>;
};

const ENTRIES = (data as unknown as { data: Entry[] }).data;
const BY_SLUG = new Map(ENTRIES.map((entry) => [entry.slug, entry]));

function latestSupport(entry: Entry, client: Tier1Client): 'y' | 'a' | 'n' | 'u' {
  const [family, platform] = CLIENT_KEYS[client];
  const versions = entry.stats[family]?.[platform];
  if (!versions) return 'u';
  const keys = Object.keys(versions);
  const value = versions[keys[keys.length - 1] ?? ''] ?? 'u';
  const flag = value.split(' ')[0];
  return flag === 'y' || flag === 'a' || flag === 'n' ? flag : 'u';
}

/** Vlastnosti CSS použité v inline stylech a v <style> bloku, i s hodnotou. */
function usedDeclarations(
  html: string,
): Array<{ property: string; value: string; usedAt: string }> {
  const found = new Map<string, { property: string; value: string; usedAt: string }>();
  const add = (property: string, value: string, usedAt: string): void => {
    if (!found.has(`${property}:${value}`))
      found.set(`${property}:${value}`, { property, value, usedAt });
  };
  for (const match of html.matchAll(/style="([^"]*)"/g)) {
    for (const declaration of match[1]!.split(';')) {
      const [property, ...rest] = declaration.split(':');
      const name = property?.trim();
      if (name) add(name, rest.join(':').trim(), `style="${name}"`);
    }
  }
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const declaration of match[1]!.split(/[;{}]/)) {
      const [property, ...rest] = declaration.split(':');
      const name = property?.trim();
      if (name && /^[a-z-]+$/.test(name)) add(name, rest.join(':').trim(), `<style> ${name}`);
    }
  }
  return [...found.values()];
}

/**
 * Nejdřív se hledá záznam pro konkrétní hodnotu (`css-display-flex`), teprve
 * potom pro samotnou vlastnost (`css-display`). Bez toho by `display:flex`
 * vycházelo jako podporované: `css-display` má u všech klientů úrovně 1 aspoň
 * částečnou podporu, kdežto `css-display-flex` je ve Wordovém enginu „n".
 */
function entryFor(property: string, value: string): Entry | undefined {
  if (/^[a-z-]+$/.test(value)) {
    const byValue = BY_SLUG.get(`css-${property}-${value}`);
    if (byValue) return byValue;
  }
  return BY_SLUG.get(`css-${property}`);
}

export function checkCompatibility(html: string): CompatFinding[] {
  const findings: CompatFinding[] = [];
  for (const { property, value, usedAt } of usedDeclarations(html)) {
    const entry = entryFor(property, value);
    if (!entry) continue;
    const support = Object.fromEntries(
      TIER1_CLIENTS.map((client) => [client, latestSupport(entry, client)]),
    ) as Record<Tier1Client, 'y' | 'a' | 'n' | 'u'>;
    const values = Object.values(support);
    const severity: CompatFinding['severity'] =
      values.includes('n') && !KNOWN_EXCEPTIONS.has(entry.slug)
        ? 'error'
        : values.includes('a') || values.includes('n')
          ? 'warning'
          : 'info';
    if (severity === 'info' && !values.includes('u')) continue;
    findings.push({ feature: entry.slug, usedAt, support, severity });
  }
  return findings;
}
