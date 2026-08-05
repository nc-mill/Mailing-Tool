/**
 * Očista identifikátoru z veřejného odkazu, který přišel z poštovního klienta.
 *
 * PROČ TO EXISTUJE. Gmail k odkazu v e-mailu připojuje vlastní sledovací parametry
 * a dělá to NAIVNÍM SPOJENÍM: nezkoumá, jestli adresa už query řetězec má, a připíše
 * `&source=gmail&ust=…&usg=…` rovnou za ni. Odhlašovací odkaz `/u/<token>` žádný `?`
 * nemá, takže výsledná adresa vypadá takhle:
 *
 *   /u/t1dQEB…LLD&source=gmail&ust=1785931489061000&usg=AOvVaw2…
 *
 * Pro Next.js je tam celý ten řetězec JEDEN segment cesty, protože oddělovač query
 * nikdo nenapsal. Do parametru `[token]` se proto dostane token i s přílepkem, kodek
 * z kontraktu 3 ho odmítne jako `token_malformed` a příjemce uvidí „odkaz neplatí".
 * Přesně tohle zadavatel nahlásil a přesně tohle poštovní providery trestají: neúspěšné
 * odhlášení končí tlačítkem spam, ne druhým pokusem.
 *
 * CO S TÍM. Přílepek se uřízne na hranici abecedy identifikátoru. Není to shovívavost
 * k poškozenému tokenu: podpis se pořád ověřuje nad tím, co ze zprávy skutečně přišlo,
 * jen se zahodí to, co k tokenu nikdy nepatřilo. Uříznutí je vždy na PRVNÍM cizím znaku,
 * takže z `t1AAA&x=1` vznikne `t1AAA`, ne `t1AAAx1`; slepování zbytků by z neplatného
 * tokenu mohlo omylem složit platný.
 *
 * NEDĚLÁ se to uvnitř `verifyToken` v `@mlain/contracts`: kontrakt 3 je zmrazený,
 * má zlaté vektory sdílené s Go stranou (mimo jiné vektor, který musí zůstat
 * `token_malformed`, protože je ve standardním base64 místo base64url) a chování
 * poštovních klientů do něj nepatří. Čistí se na hranici aplikace, tedy tam, kde
 * požadavek z poštovního klienta přistane.
 */

/** Abeceda base64url bez paddingu, tedy vše, co smí být v tokenu z kontraktu 3. */
const TOKEN_ALPHABET = /[^A-Za-z0-9_-]/;

/**
 * Abeceda veřejného odkazu, který nese projekt v sobě (`encodePublicRef`): 32 znaků
 * hexa a za nimi náhodná hodnota. Je to tatáž množina znaků jako u tokenu, ale má
 * vlastní jméno, aby bylo na volajícím vidět, co čistí.
 */
const REF_ALPHABET = TOKEN_ALPHABET;

/** Slug hostovaného formuláře. Malá písmena, číslice a pomlčka; tečku kvůli `.js` NE. */
const SLUG_ALPHABET = /[^a-z0-9-]/;

function cutAtFirstForeign(raw: string, foreign: RegExp): string {
  const at = raw.search(foreign);
  return at === -1 ? raw : raw.slice(0, at);
}

/**
 * Uřízne z tokenu vše od prvního znaku, který do base64url nepatří.
 *
 * Vrací prázdný řetězec, když je cizí hned první znak; volající to pozná tak, že
 * ověření selže úplně stejně jako u jakéhokoliv jiného nesmyslu v adresním řádku.
 */
export function sanitizePublicToken(raw: string): string {
  return cutAtFirstForeign(raw, TOKEN_ALPHABET);
}

/** Totéž pro identifikátor, který nese projekt v prvních 32 znacích. */
export function sanitizePublicRef(raw: string): string {
  return cutAtFirstForeign(raw, REF_ALPHABET);
}

/**
 * Totéž pro slug formuláře. Přípona `.js` se ořezává PŘED voláním, protože tečka
 * v abecedě slugu není a jinak by se odřízla i ona.
 */
export function sanitizePublicSlug(raw: string): string {
  return cutAtFirstForeign(raw.toLowerCase(), SLUG_ALPHABET);
}
