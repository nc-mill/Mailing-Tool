export type BannedTerm = {
  /** Kmen výrazu. Hledá se bez ohledu na velikost písmen a na koncovku. */
  term: string;
  /** Správný výraz, který se nabídne v hlášce. */
  use: string;
  /** Prefixy klíčů, kde je výraz povolený. */
  except: string[];
  /**
   * Hledat výraz jako CELÉ slovo, bez tolerance ke koncovce.
   *
   * Ve výchozím stavu se koncovka toleruje, protože čeština skloňuje a term
   * „slučovací značka" musí najít i tvar „slučovací značku". U anglických
   * výrazů je ale tahle tolerance škodlivá: naměřeno na skutečném katalogu,
   * kmen z termu `subscribed` je `subscribe` a ten se chytí v každé větě
   * typu „people subscribe to a list", tedy v úplně běžném slovese.
   * Kontrola pak hlásí deset planých porušení na jedno skutečné.
   */
  exact?: boolean;
};

export const BANNED_CS: BannedTerm[] = [
  { term: 'pracovní prostor', use: 'Projekt', except: [] },
  { term: 'workspace', use: 'Projekt', except: [] },
  { term: 'odběratel', use: 'Kontakt', except: [] },
  { term: 'blacklist', use: 'Blokované adresy', except: [] },
  { term: 'černá listina', use: 'Blokované adresy', except: [] },
  { term: 'pískoviště', use: 'Testovací režim u Amazonu', except: [] },
  { term: 'kvóta', use: 'Denní limit', except: [] },
  // Merge tag se česky řekne „Personalizace" (rozhodnutí zadavatele 1. 8. 2026).
  // Slovo „personalizace" proto v tomhle seznamu **není a být nesmí**.
  { term: 'placeholder', use: 'Personalizace', except: [] },
  { term: 'slučovací značka', use: 'Personalizace', except: [] },
  { term: 'doplňovaný údaj', use: 'Personalizace', except: [] },
  { term: 'merge tag', use: 'Personalizace', except: [] },
  { term: 'preference centrum', use: 'Nastavení odběru', except: [] },
  { term: 'dvojité přihlášení', use: 'Potvrzení přihlášení e-mailem', except: [] },
  { term: 'unikátní otevření', use: 'Otevřelo lidí', except: [] },
  { term: 'trackování', use: 'Sledování', except: [] },
  { term: 'prokliková míra', use: 'Míra prokliku', except: [] },
  { term: 'odregistrovat', use: 'Odhlásit z odběru', except: [] },
  { term: 'zaregistrovat', use: 'Přihlásit k odběru', except: [] },
  { term: 'joba', use: 'Úloha', except: [] },
  { term: 'háček', use: 'Webhook', except: [] },
  { term: 'administrátor', use: 'Správce', except: [] },
  { term: 'majitel', use: 'Vlastník', except: [] },
];

export const BANNED_EN: BannedTerm[] = [
  { term: 'blacklist', use: 'suppression list', except: [] },
  { term: 'sandbox', use: 'Amazon sandbox', except: ['common.errors'] },
  { term: 'placeholder', use: 'merge tag', except: [] },
];

export type Violation = { key: string; term: string; use: string };

function walk(node: unknown, path: string, visit: (key: string, value: string) => void): void {
  if (typeof node === 'string') {
    visit(path, node);
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      walk(value, path === '' ? key : `${path}.${key}`, visit);
    }
  }
}

/**
 * Kmen výrazu bez poslední hlásky. Slouží k nalezení skloněných tvarů
 * („slučovací značku" má najít i term „slučovací značka"). Zkracuje se
 * jen poslední slovo a jen o jeden znak, aby krátká slova (do 4 znaků,
 * třeba „joba") nezpůsobila planá hlášení na náhodné shodě.
 */
function stem(term: string): string | null {
  const lastSpace = term.lastIndexOf(' ');
  const lastWord = lastSpace === -1 ? term : term.slice(lastSpace + 1);
  if (lastWord.length <= 4) return null;
  return term.slice(0, term.length - 1);
}

/**
 * Hledá výraz na ZAČÁTKU slova, konec nechává volný.
 *
 * Volný konec je tu schválně kvůli skloňování: „slučovací značku" musí najít
 * i term „slučovací značka". Hranice na začátku je tam ale taky schválně,
 * protože bez ní je kontrola nepoužitelná.
 *
 * Naměřeno na skutečném katalogu: term `subscribed` bez hranice hlásil
 * 21 porušení, z nichž skoro všechna byla planá. Chytal se totiž uvnitř slov
 * `unsubscribed` a `resubscribe`, tedy uvnitř výrazů, které znamenají PRAVÝ
 * OPAK toho, co má zakázáno být. Kontrola, která hlásí opak zakázaného výrazu,
 * se buď vypne, nebo se její hlášení začnou přehlížet, a v obou případech
 * přestane hlídat to jediné, kvůli čemu vznikla.
 *
 * Je to tatáž třída chyby jako u prefixu a suffixu, které se překrývaly
 * nad krátkým jménem souboru, nebo u `\s`, které přeskočilo konec řádku.
 */
function matchesAtWordStart(haystack: string, needle: string, wholeWord = false): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? undefined : haystack[at - 1];
    const after = haystack[at + needle.length];
    // Před výrazem musí být začátek řetězce nebo znak, který není písmeno.
    const startOk = before === undefined || !/\p{L}/u.test(before);
    // U celého slova musí totéž platit i za výrazem.
    const endOk = !wholeWord || after === undefined || !/\p{L}/u.test(after);
    if (startOk && endOk) return true;
    from = at + 1;
  }
}

export function findViolations(tree: unknown, banned: BannedTerm[]): Violation[] {
  const found: Violation[] = [];
  walk(tree, '', (key, value) => {
    const haystack = value.toLocaleLowerCase('cs');
    for (const entry of banned) {
      if (entry.except.some((prefix) => key.startsWith(prefix))) continue;
      const term = entry.term.toLocaleLowerCase('cs');
      const shortened = entry.exact === true ? null : stem(term);
      const matches =
        matchesAtWordStart(haystack, term, entry.exact === true) ||
        (shortened !== null && matchesAtWordStart(haystack, shortened));
      if (matches) {
        found.push({ key, term: entry.term, use: entry.use });
      }
    }
  });
  return found;
}
