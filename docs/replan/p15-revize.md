# Revize P15: AI asistent

**Recenzovaný plán:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p15-ai-asistent.md` (10 888 řádků, 38 úkolů, 229 kroků)
**Datum:** 2026-08-01
**Rozsah:** BYOK a registr providerů, extrakce značky s ochranou proti SSRF, strukturovaný výstup proti blokovému schématu, obrazovky 8.5.3 a 8.5.4, kritéria 7b a 7c

Každý nález je ověřený spuštěním: grepem v cílovém plánu, protočením seznamu zakládaných souborů proti seznamu importovaných, nebo dopočítáním testů. U každého je uvedeno, čím byl ověřen.

---

## Verdikt

**NALEZENY PROBLÉMY. Plán není připravený ke spuštění.**

Doménová kvalita je vysoká. Klasifikace adres, obrana proti DNS rebindingu, ruční obsluha přesměrování, odvození schématu strukturovaného výstupu z P08 a katalog chybových kódů jsou promyšlené a doložené. Identifikátory modelů i ceny jsou správné, což je u tohoto typu plánu spíš výjimka.

Problém je jinde a je systémový: **plán napsal knihovnu, ne funkci.** Každá vrstva je čistá funkce s injektovanými závislostmi a vlastním jednotkovým testem, ale soubor, který ty závislosti poskládá dohromady, nikdy nevznikne. `apps/web/src/lib/ai/deps.ts` je importovaný ze čtyř míst, uvedený v kapitole 8 jako vlastněný a v kapitole 9 označený za domov volání `sharp`, a **žádný ze 229 kroků ho nezakládá.** Důsledek se táhne celým plánem: konektor s připnutou IP nemá jediného spotřebitele, `safeFetch` nemá transport, resolver se čte z globální proměnné, kterou nikdo nenastavuje, a job extrakce volá `fetchAssets([])` s natvrdo prázdným polem.

Obě bezpečnostní kritéria, na kterých zadání trvá, stojí na testech, které neměří. U 7b test přijme stav 401 (tedy odmítnutí autentizací dřív, než se dojde k AI kódu), nemá pozitivní kontrolu odposlechu a stack, který spouští, se kvůli povinným proměnným v `docker/compose.yml` vůbec nenastartuje. U kritéria 70 si test sám sestaví tělo požadavku, sám ho pošle do vlastní špionážní funkce a pak ověří, že v něm není to, co tam sám nedal.

Dva nálezy zastaví plán dřív, než dojde ke kódu: `baseSectionSpecSchema`, na kterém stojí celý strukturovaný výstup, v P08 **neexistuje v žádné podobě** (P08 má jen typ TypeScriptu), a `sharp` přitáhne do produkčního stromu LGPL-3.0-or-later, takže licenční brána v CI shodí build hned prvním `pnpm install`. Obojí ověřeno spuštěním, ne přečtením.

| Závažnost | Počet |
|---|---|
| KRITICKÉ | 11 |
| DŮLEŽITÉ | 8 |
| POZNÁMKA | 7 |

---

## KRITICKÉ

### K1. Kompoziční kořen `lib/ai/deps.ts` neexistuje, a přitom na něm stojí celý produkt

**Kde v plánu:** importovaný v úkolu 18, kroku 3 (ř. 4000, `import { aiChatDeps } from '@/lib/ai/deps'`); `lib/ai/queries.ts` importovaný v úkolu 35 (ř. 9365, `fetchCredentials, fetchUsage`) a v úkolu 36 (ř. 9891, `fetchBrandProfiles`); `components/brand/brand-settings-client.tsx` importovaný v úkolu 36 (ř. 9889). Všechny tři jsou vyjmenované v kapitole 8 jako vlastněné (ř. 10826, 10828) a kapitola 9 (ř. 10858) říká, že „samotné volání `sharp` je v `lib/ai/deps.ts`". Úkol 37 na ně odkazuje znovu (ř. 10510).

**Jak ověřeno:** z plánu vytaženo všech 109 unikátních cest z řádků `Vytvoř:` a `Uprav:` a porovnáno se seznamem v kapitole 8.

```
grep -oE "^- (Vytvoř|Uprav): \`[^\`]+\`" plán | sed -E 's/^- (Vytvoř|Uprav): `//; s/`$//' | sort -u
```

Výsledek: `packages/core/src/ai/sdk/factories.ts` OK, `packages/core/src/ai/tools/schemas.ts` OK, **`apps/web/src/lib/ai/deps.ts` CHYBÍ**, **`apps/web/src/lib/ai/queries.ts` CHYBÍ**, **`apps/web/src/components/brand/brand-settings-client.tsx` CHYBÍ**.

**Proč to vadí:** `deps.ts` je jediné místo, kde se má poskládat objektový graf: skutečný `undici` dispatcher s připnutým konektorem, `buildModel` s továrnami SDK, `sharp`, čtení a zápis do databáze. Bez něj neběží ani AI asistent, ani extrakce značky, ani obě obrazovky. Typová kontrola `@mlain/web` spadne na chybějícím modulu hned u úkolu 18. Kapitola 9 přitom tvrdí: „Každý krok, který něco mění, obsahuje celý obsah souboru nebo přesně vymezenou úpravu." Pro tři nejvíc nosné soubory plánu to neplatí.

**Rozsah je větší, než se na první pohled zdá: plán se nikdy nedotkne databáze.**

```
grep -cniE "INSERT INTO|SELECT .* FROM|UPDATE .* SET|ON CONFLICT" P15  → 2
grep -cn "from '@mlain/db'|drizzle("                          P15  → 0
```

Oba zásahy prvního grepu jsou jedna prozaická věta v úvodu úkolu 11 („`ai_usage_daily` je agregát plněný přes `INSERT ... ON CONFLICT DO UPDATE`"), ne kód. **Plán neobsahuje jediný dotaz a neimportuje `@mlain/db` ani jednou**, ačkoli kapitola 0.2 (ř. 35) tvrdí, že si odtud bere sedm tabulek.

Veškerý přístup k datům je schovaný za injektované závislosti, které nikdo neimplementuje: `insertCredential`, `listCredentials`, `findByFingerprint`, `insertExtraction`, `loadExtraction`, `markRunning`, `finish`, `countExtractionsInLastHour`, `countRunningExtractions`, `failStaleExtractions`, `buildBrandProfile`, `emitWebhookEvent`, `writeAuditLog`. Testy je všechny nahrazují přes `vi.fn()`, takže jsou zelené a nic nedokazují.

Praktický důsledek pro odhad: nejde o „doplnit jeden soubor", ale o **napsat celou repozitářovou vrstvu domény**, včetně mapování na skutečné sloupce P03. Zároveň to vysvětluje, proč je nález K8 (typ `apiKeyEncrypted`) jediný schématický nález v téhle revizi: **není co jiného se schématem porovnat.** Až repozitářová vrstva vznikne, bude ji potřeba proti P03 projít sloupec po sloupci znovu, protože právě tam se skryté rozpory typu „NOT NULL bez DEFAULT" obvykle objeví.

**Navržená oprava:** v P15. Doplnit úkoly, které zakládají:
1. `apps/web/src/lib/ai/deps.ts`, celý objektový graf pro chat, nástroje a extrakci, včetně `request` implementace pro `safeFetch` nad `undici.Agent` s `createPinnedConnector` a nastavení resolveru (viz K2), a volání `sharp`.
2. **Repozitářovou vrstvu** nad `@mlain/db` pro všech třináct výše vyjmenovaných funkcí, s testy proti skutečné databázi, ne proti `vi.fn()`.
3. `apps/web/src/lib/ai/queries.ts` (serverová čtení pro obě obrazovky) a `apps/web/src/components/brand/brand-settings-client.tsx`.

Doplnit je do kapitoly 3 i do pořadí v kapitole 6, mezi větev B a větev D.

---

### K2. Ochrana proti SSRF je napsaná a otestovaná, ale není zapojená do žádné produkční cesty

Tři nezávislé vady, které dohromady znamenají, že celá kapitola 3.13 specifikace v běžícím produktu nic nechrání.

**a) `createPinnedConnector` nemá spotřebitele.**

**Kde:** definice v úkolu 23, kroku 3 (ř. 5480).
**Jak ověřeno:** `grep -n "createPinnedConnector" plán` vrací 6 řádků: 5374 (import v testu), 5386, 5406, 5423, 5439 (čtyři volání v testu), 5480 (definice). Mimo vlastní testovací soubor **nula použití**.

Komentář v souboru ho označuje za „poslední pojistku proti DNS rebindingu", jenže žádný kód nikdy nevytvoří `undici` dispatcher, který by ho použil. `grep -n "new Agent"` v celém plánu nevrací nic.

**b) `safeFetch` nemá transport a nikdo ho nevolá.**

**Kde:** úkol 23, krok 6 (ř. 5834), typ `SafeFetchDeps` (ř. 5798-5811).
**Jak ověřeno:** `grep -n "safeFetch(" plán` vrací 14 řádků; 13 je uvnitř `safe-fetch.test.ts`, jeden je definice. Jediné další zmínky (ř. 6185) jsou vzorky kódu v testu ESLint pravidla.

`deps.request` je **povinná** vlastnost bez výchozí hodnoty a bez jediné implementace v celém plánu. Job extrakce (úkol 31) místo toho přijímá `deps.fetchPage`, `deps.checkRobots` a `deps.fetchAssets` jako injektované funkce, a ani jednu z nich nikdo nesestavuje. Orchestrace v úkolu 30 (`requestExtraction`) jen normalizuje URL a zařadí job do fronty.

**c) Resolver se čte z globální proměnné, kterou nikdo nenastavuje.**

**Kde:** úkol 23, krok 6, ř. 5857:
```ts
resolver: (globalThis as { __mlainResolver?: never }).__mlainResolver as never,
```
**Jak ověřeno:** `grep -n "__mlainResolver" plán` vrací **jediný** řádek, ten výše. Nikde se nepřiřazuje.

V produkci je tedy `options.resolver` `undefined`. `resolveHostSafely` (úkol 22, ř. 5326) volá `options.resolver.resolve4(hostname)`, což hodí `TypeError`. `safeFetch` má `try/catch` jen kolem `deps.request`, ne kolem `await resolve(...)`, takže se odmítne celý příslib. **Každá reálná extrakce by spadla.** Testy to nikdy nechytí, protože všech třináct injektuje mock `resolveHostSafely`.

**Navržená oprava:** v P15, v novém souboru z nálezu K1. `deps.ts` musí sestavit `resolveHostSafely` s `new dns.promises.Resolver()`, `request` implementaci nad `undici.Agent({ connect: createPinnedConnector({ pinnedIp, servername, ...policy }) })` a předat obojí do `safeFetch`. Zároveň odstranit hack přes `globalThis` a udělat z `resolver` běžný parametr `SafeFetchDeps`; globální stav je v tomhle souboru navíc jediné místo, kde by se dal obejít lint z úkolu 25.

---

### K3. Kritérium 7b: test v úkolu 32 nemůže selhat ze správného důvodu a pravděpodobně vůbec nedoběhne

Zadání explicitně žádá ověřit, že test měří, ne že kontroluje konfiguraci. **Neměří.** Pět nezávislých vad.

**a) Chybí pozitivní kontrola. Test projde i s mrtvým snifferem.**

**Kde:** úkol 32, krok 3, ř. 5591-5612. Test čte počítadlo před požadavkem (`expect(before).toBe('0')`) a po něm (`expect(after).toBe('0')`).

Nikde se neověřuje, že sniffer vůbec něco zachytí. Když alias `api.anthropic.com` neplatí (Docker ho nerozřeší, kontejnery nejsou na společné síti, sniffer se nerozběhl na portu 443), počítadlo zůstane na nule i ve chvíli, kdy aplikace požadavek na **skutečný** `api.anthropic.com` odešle. Test projde a kritérium zůstane neověřené. Plán si toho je částečně vědom, ale řeší to větou v kroku 4 („Pokud test projde hned napoprvé, ověř, že sniffer opravdu běží"), tedy pokynem pro člověka, ne tvrzením v testu.

**b) Test přijímá stav 401, čímž ho splní autentizační vrstva.**

**Kde:** ř. 8604: `expect([401, 409]).toContain(response.status());`

Požadavek na `/api/internal/ai/chat` jde bez přihlášení. Při 401 se nikdy nedojde k `prepareConversation`, k načtení credentialu ani k `buildModel`, takže se přirozeně nic neodešle, **a to bez ohledu na to, jestli kritérium 7b platí**. Kritérium přitom mluví o projektu bez nakonfigurovaného klíče, což předpokládá, že projekt existuje a uživatel je v něm přihlášený.

**c) Stack se nedá nastartovat.**

**Jak ověřeno:** přečteno `docker/compose.yml` v P01 (ř. 7848-7900).

- `APP_URL: ${APP_URL:?APP_URL je povinná}` a `SECRET_KEY: ${SECRET_KEY:?SECRET_KEY je povinná...}`. Overlay v úkolu 32 ani jednu nedodává, takže `docker compose up` skončí chybou dřív, než se cokoliv spustí.
- `postgres` má `profiles: ["bundled"]`. Test volá `compose('up', '-d', '--wait')` **bez** `--profile bundled`, takže databáze neběží. Entrypoint P01 přitom při `MODE=all` a výchozím `MIGRATE_ON_START=true` pouští `mlain migrate`, ta selže a kontejner se ukončí. `--wait` skončí chybou.
- `app` má `read_only: true` a `/tmp` jako tmpfs; overlay pod něj montuje pojmenovaný svazek `egress-count:/tmp/egress`, který se nikde nečte (test čte počítadlo přímo ze snifferu).

**d) Pátý test nemůže projít nikdy.**

**Kde:** ř. 8614-8628.
```ts
compose('exec', '-T', '-e', 'ANTHROPIC_API_KEY=sk-test', 'app', 'node', '-e',
  "require('@mlain/core/ai').warnOnLeakedEnvKeys(process.env, console)");
const logs = compose('logs', 'app');
expect(logs).toContain('ai_key_leaked_from_env');
```
Výstup `docker compose exec` jde klientovi, ne do logovacího ovladače kontejneru. `docker compose logs app` ukazuje jen stdout a stderr procesu PID 1. Zpráva se tam tedy neobjeví za žádných okolností. Navíc `require()` je CJS volání na balíček, jehož exports mapa (úkol 1, ř. 346) míří na **TypeScriptový zdroj** `./src/ai/index.ts`, a kořenový export `@mlain/core` podle téhož úkolu neexistuje.

**e) Uvedený očekávaný výsledek neodpovídá skutečnosti.**

**Kde:** krok 4, ř. 8635: „Expected: FAIL na prvním testu, `expected environ not to contain "ANTHROPIC_API_KEY"`."

Entrypoint P01 proměnné podle vzoru `*_API_KEY` maže už dnes (P01 ř. 7357-7359) a P01 to má pokryté vlastním testem (P01 ř. 7251). První test tedy projde napoprvé.

**Navržená oprava:** v P15, úkol 32 přepsat.
1. Doplnit do overlaye `APP_URL`, `SECRET_KEY` a spouštět `up -d --wait --profile bundled` (nebo přidat `MIGRATE_ON_START: 'false'` a externí databázi).
2. Přidat **pozitivní kontrolu** jako první test: z kontejneru `app` se úmyslně spojit na `api.anthropic.com:443` (například `node -e "require('net').connect(443,'api.anthropic.com')"`), ověřit, že počítadlo vyskočí na 1, a pak ho vynulovat. Bez ní test nic nedokazuje.
3. Požadavek posílat **přihlášeně** proti nasazenému projektu bez klíče a trvat na jediném stavu 409 s kódem `ai_credential_missing`. Stav 401 musí být selhání testu, ne jeho splnění.
4. Pátý test buď zahodit (patří k P01, viz K4), nebo ověřovat návratovou hodnotu `exec` místo `compose logs` a volat modul podcestou přes zkompilovaný build.
5. Do overlaye přidat `ANTHROPIC_AUTH_TOKEN=sk-test` a ověřit i ji (viz K5).

---

### K4. Druhá vrstva kritéria 7b je mrtvý kód a zároveň slabší duplikát toho, co už má P01

**Kde v plánu:** úkol 5 zakládá `env-guard.ts` s `leakedProviderEnvVars` a `warnOnLeakedEnvKeys`; kapitola 7 (ř. 10729) je uvádí jako jednu ze čtyř vrstev pokrytí 7b.

**Jak ověřeno:** `grep -n "warnOnLeakedEnvKeys\|leakedProviderEnvVars" plán` vrací 8 řádků: definice, vlastní test, a nefunkční docker exec z K3d. **Ani jedno volání z produkčního kódu.** Ani `chat.ts`, ani route handler, ani žádný startovací soubor je nevolá.

**Co už existuje v P01:** `packages/core/src/config/ai-keys.ts` s `AI_PROVIDER_ENV_PATTERN`, `AI_PROVIDER_ENV_EXCEPTIONS`, `isAiProviderVariable` a `aiKeyVariablesPresent` (P01 ř. 4043-4070), a nad tím **živý** `aiKeyLeakCheck()` zapojený do health checků webu i workeru (P01 ř. 4901, volaný na ř. 5211 a 5760). P01 si 7b nárokuje ve své tabulce kritérií (P01 ř. 9599).

P15 tedy vyrábí druhou implementaci téže věci, která je navíc **užší**: staví na `allFallbackEnvVars()` z vlastního registru providerů, takže nezná `OLLAMA_HOST`, `HF_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK` ani ostatní položky z výčtu výjimek P01.

**Navržená oprava:** v P15. Úkol 5 zrušit a místo něj importovat `aiKeyVariablesPresent` z P01. Pokud plán chce vlastní vrstvu ponechat, musí ji nad P01 nadstavit (sjednocení obou seznamů) a hlavně **zavolat**: nejpozději v `prepareConversation` (úkol 18) před sestavením modelu.

---

### K5. `ANTHROPIC_AUTH_TOKEN` projde entrypointem, a P15 to ví, ale nehlásí

**Kde v plánu:** úkol 3, krok 3, ř. 616:
```ts
fallbackEnvVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
```
s komentářem u typu (ř. 601-603): „Proměnné prostředí, po kterých SDK sáhne, když se klíč nepředá. Entrypoint je maže (P01)."

**Jak ověřeno:** přečten `docker/entrypoint.sh` v P01 (ř. 7350-7371). Maže se vzor `*_API_KEY` plus výčet `AWS_BEARER_TOKEN_BEDROCK`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_GENAI_USE_VERTEXAI`, `AZURE_OPENAI_ENDPOINT`, `OLLAMA_HOST`, `HF_TOKEN`. `ANTHROPIC_AUTH_TOKEN` **v seznamu není** a na `_API_KEY` nekončí.

Tvrzení v komentáři je tedy nepravdivé pro polovinu položek u Anthropicu. Test kritéria 7b v úkolu 32 tu proměnnou nenastavuje, takže ji nechytí ani on. Provozovatel, který má v prostředí `ANTHROPIC_AUTH_TOKEN`, by projektem bez klíče utrácel vlastní peníze, což je přesně scénář, kvůli kterému kritérium 7b vzniklo.

**Navržená oprava:** ve dvou plánech. V **P01** doplnit `ANTHROPIC_AUTH_TOKEN` do `AI_PROVIDER_ENV_EXCEPTIONS` i do výčtu `unset` v `docker/entrypoint.sh`. V **P15** to zapsat jako požadavek na P01 (kapitola, která zatím neexistuje, viz D4) a doplnit proměnnou do overlaye a tvrzení v úkolu 32.

---

### K6. Uživatelem zadaná `base_url` nikdy neprojde kontrolou SSRF, ačkoli to specifikace výslovně žádá

**Kde v plánu:** `buildModel` (úkol 7, krok 3, ř. 1426-1441) ověří jen `descriptor.allowsBaseUrl`, `allowCustomBaseUrl` a `descriptor.requiresBaseUrl`, pak hodnotu předá do `args.baseURL` beze změny. Routa `handleCreateCredential` (úkol 19, ř. 4176-4189) má jediný test na `base_url`, a to že u `anthropic` je chybou validace. `credential-service` (úkol 10) hodnotu jen ukládá a vrací.

**Jak ověřeno:** `grep` na všechny výskyty `baseUrl`/`base_url` v kombinaci s validačními slovy vrací pouze tyto dva testy a dvě nesouvisející místa v extrakci značky (`collectStylesheetUrls`, `collectLogoCandidates`). Voláním `normalizeBrandUrl` prochází jen `safeFetch` (ř. 5848) a `requestExtraction` (ř. 7893). Nikdy `base_url` credentialu.

**Co žádá specifikace:** `docs/superpowers/specs/parts/03-obsah.md`, ř. 2413: „Uživatelem zadaná `baseURL` je **další SSRF plocha**, proto prochází kontrolou hostu z 3.13.3 a 3.13.4 (schéma, port, zakázané rozsahy). Nekontroluje se robots.txt a nesleduje se přesměrování, protože jde o API endpoint."

**Proč to vadí:** provider `openai_compatible` má `requiresBaseUrl: true`, takže URL je povinná a uživatelem zadaná. Přihlášený člen projektu ji nastaví na `http://169.254.169.254/latest/meta-data/` nebo na vnitřní službu a server tam pošle požadavek, navíc s hlavičkou `Authorization`. Je to tentýž SSRF vektor, proti kterému plán postavil celý podstrom `brand`, jen o dvě obrazovky vedle.

**Navržená oprava:** v P15. Do `handleCreateCredential` a `handleUpdateCredential` (úkol 19) doplnit před uložením kontrolu `normalizeBrandUrl(base_url, policy)` s politikou bez `allowHttp` a odmítnout kódem `validation_failed` s `ai_base_url_not_allowed`. Do `buildModel` doplnit tutéž kontrolu jako druhou vrstvu (klíč se ověřuje dvakrát ze stejného důvodu). Doplnit dva testy: `base_url` na privátní rozsah a `base_url` s pověřením v URL.

---

### K7. Ani jeden ze dvou jobů se nikdy nespustí: chybí `queue-handlers.ts`

**Kde v plánu:** úkol 12 zakládá `packages/core/src/ai/jobs/cleanup-conversations.ts`, úkol 31 zakládá `packages/core/src/brand/jobs/brand-extract.ts`.

**Jak ověřeno:** `grep -n "queue-handlers" plán` vrací **nulu**. V P01 přitom (ř. 9717) stojí požadavek P01-6 na všechny doménové plány: „Handler fronty psát do `packages/core/src/<domena>/jobs/queue-handlers.ts` s exportem `handlers`, pak spustit `pnpm --filter @mlain/worker run codegen` a commitnout vygenerovaný soubor."

**Druhá, horší vada:** P01 odvozuje adresář z **prefixu jména fronty**, ne z pole `domain`. P01 ř. 2754-2757:
```ts
export function handlerModulePath(entry: QueueEntry): string {
  const [domainPart] = entry.name.split('.');
  return `packages/core/src/${domainPart}/jobs/queue-handlers.ts`;
}
```
Fronta se podle registru P01 (ř. 2687) jmenuje `content.brand_extract`, takže codegen hledá `packages/core/src/**content**/jobs/queue-handlers.ts`. P15 ale vlastní `src/ai` a `src/brand`, adresář `src/content` nikoli.

**Třetí vada, tichá:** registr P01 (ř. 2687) definuje `payloadFields: ['workspace_id', 'extraction_id']` a `singletonKeyTemplate: '<extraction_id>'`. `requestExtraction` (úkol 30, ř. 7906) zařazuje `{ extractionId: inserted.id }`, tedy camelCase a bez `workspace_id`.

**Proč to vadí:** codegen workeru handlery neprogloubuje, `apps/worker/src/handlers.generated.ts` je nebude obsahovat a obě fronty budou přijímat úlohy, které nikdo nezpracuje. Extrakce značky zůstane navždy ve stavu `pending`, retence konverzací nikdy neproběhne. Nic nespadne.

**Navržená oprava:** ve dvou plánech. V **P15** doplnit `packages/core/src/ai/jobs/queue-handlers.ts` s exportem `handlers` a srovnat payload na `workspace_id` a `extraction_id`. Pro brand extract je nutné **rozhodnutí**: buď P15 založí `packages/core/src/content/jobs/queue-handlers.ts` (a rozšíří si vlastnictví o jeden soubor mimo `src/brand`), nebo se v **P01** přejmenuje fronta na `brand.extract`, aby cesta odpovídala vlastnictví. Druhá varianta je čistší, ale mění zmrazený registr.

---

### K8. `apiKeyEncrypted` je ve schématu `bytea`, P15 do něj ukládá řetězec, a vlastní test si to zamaskuje

**Kde v plánu:** `encryptApiKey` (úkol 10, ř. 2110-2120) vrací `string`; `handleCreateCredential` (úkol 19, ř. 4344) předává výsledek do `insertCredential({ apiKeyEncrypted: ... })`.

**Co má P03:** `packages/db/.../content.ts`, ř. 2505:
```ts
apiKeyEncrypted: bytea().notNull(),  // obálka části 1, context = "ai_provider"
```

**Co žádá kontrakt P02 (4.10.4, ZMRAZENO), ř. 3455:**
```
stored = "enc:v1:" || base64_standard_with_padding(envelope)
```
Tedy řetězec s textovým prefixem, ne binární data. Prefix `enc:v1:` je právě to, podle čeho jde v záloze najít všechna zašifrovaná pole; v `bytea` se v dumpu objeví jako `\x656e633a76313a...` a hledání selže.

**Jak se to maskuje:** úkol 19, ř. 4158:
```ts
expect(String(row.apiKeyEncrypted)).toMatch(/^enc:v1:/);
```
Obalení do `String()` znamená, že test projde i tehdy, když ovladač vrátí `Buffer`. Vada se tak neprojeví v testu, ale až při prvním skutečném zápisu (Drizzle `customType` pro `bytea` očekává `Buffer`, ne `string`).

**Souvislost:** zadavatel už ví, že šifrované obálky mají napříč schématem tři různé typy pro tentýž formát. Co je nové: **P15 s tím nedělá nic.** Nemá kapitolu s požadavky na jiné plány (D4), nezapsal nic do `NALEZY-NAPRIC-PLANY.md`, a v kapitole 8.1 (ř. 8840) naopak tvrdí „Nesahá na databázové schéma ani migrace... Plán nepřidává sloupce", jako by rozpor neexistoval.

**Navržená oprava:** změna typu na `text` patří do **P03** a do jediného doplňkového průchodu schématem (nález N9). V **P15** stačí zapsat požadavek na P03 a odstranit `String()` z testu, aby chyba typu při implementaci opravdu spadla.

---

### K9. Kritérium 70 stojí na testu, který nemůže spadnout

**Kde v plánu:** úkol 17, krok 1, třetí test (ř. 3781-3805).

Test si sám sestaví řetězec promptu ze dvou natvrdo napsaných vět, sám ho zabalí do JSON, sám ho pošle do vlastní funkce `spyFetch`, která ho jen uloží do pole, a pak ověří, že v uloženém řetězci nejsou hodnoty z konstanty `contactsInDatabase` deklarované o třicet řádků výš. **Do testu nevstupuje jediný řádek produkčního kódu**, který by odchozí požadavek sestavoval: ani `chat.ts`, ani `metered-fetch.ts`, ani `buildModel`, ani nástroje. Znění kritéria přitom zní „test zachytí odchozí požadavek", což předpokládá skutečný požadavek.

Druhý test (ř. 3756-3779) má podobnou vadu mírnějšího druhu: `listMergeTags` je předaný jako `vi.fn()` vracející bezpečná data, a test pak ověří, že jsou bezpečná. Skutečná implementace nástroje z úkolu 16 se testu neúčastní, takže kdyby do výstupu propouštěla hodnoty kontaktů, test to nezachytí.

První test (ř. 3749-3754) je v pořádku, volá skutečný `buildSystemPrompt`.

**Navržená oprava:** v P15, úkol 17 přepsat. Použít `MockLanguageModelV2` z `ai/test` (plán s ním v rozhodnutí D6 počítá) a nechat proběhnout **skutečné** volání `runConversation`/`streamText` s repozitářem kontaktů naplněným testovacími daty. Zachytit prompt na hranici mocku modelu, ne ve vlastnoručně zavolané `fetch`. Druhý test nechat volat skutečný `listMergeTags` nad katalogem polí z P07 a nad kontaktem, který v databázi existuje.

---

### K10. `baseSectionSpecSchema` v P08 neexistuje, a stojí na něm celý strukturovaný výstup

**Kde v plánu:** úkol 2 (kontraktní test, ř. 391) a úkol 14, krok 3 (ř. 2887) importují `baseSectionSpecSchema` z `@mlain/emails/base` a používají ho jako runtime schéma: `baseSectionSpecSchema.safeParse(...)` a `z.array(baseSectionSpecSchema).min(1).max(12)`.

**Jak ověřeno:**
```
grep -c "baseSectionSpecSchema" P08   → 0
grep -c "buildBaseTemplate" P08       → 23
grep -c "validateDocument" P08        → 17
grep -c "validateLiquid" P08          → 4
```

Tři ze čtyř očekávaných rozhraní existují. Čtvrté **ne v žádné podobě**. P08 má na ř. 8741 pouze:
```ts
export type BaseSectionSpec =
  | { kind: "hero"; headline: string; subhead?: string; imageAssetId?: string; cta?: {...} }
  | ... osm variant celkem
```
Tedy **typ TypeScriptu, ne Zod schéma.** Typ v runtime neexistuje, nemá `safeParse` a nedá se vložit do `z.array()`. Kontraktní test úkolu 2 spadne na `baseSectionSpecSchema is not defined` a `composeSchema` v úkolu 14 se nedá sestavit.

Navíc kontraktní test od schématu očekává chování, které P08 nikde nespecifikuje: „odmítne HTML tam, kde má být prostý text" (ř. 428). To není odvoditelné z typu, vyžaduje to refinement, který by musel někdo napsat.

**Co je na tom dobře:** plán tuhle vadu **sám odhalí v úkolu 2**, tedy druhým úkolem ze třiceti osmi, přesně jak slibuje rozhodnutí D10 („Kdyby P08 export přejmenoval, chci to vědět v první minutě, ne po dvaceti úkolech"). Kapitola 6 na to má správnou reakci: „Úkol 2 spadne na chybějící export z P08 → zastav větev A, řeš s vlastníkem P08, **nepiš si vlastní kopii blokového schématu**." Konstrukce plánu tedy funguje. Problém je, že spouštěč je jistý, ne hypotetický, a řešení leží v plánu, který je podle řídicího dokumentu ve vlně 0 dávno smergovaný.

**Navržená oprava:** v **P08**. Doplnit do `packages/emails/src/base/` runtime schéma `baseSectionSpecSchema` odvozené z téhož zdroje jako typ (tedy `z.discriminatedUnion('kind', [...])` a `BaseSectionSpec` z něj odvodit přes `z.infer`, aby nevznikly dvě definice), včetně refinementu na prostý text. V **P15** to zapsat jako požadavek na P08 (kapitola, která chybí, viz D4) a v kapitole 5 u úkolu 2 uvést, že se selhání očekává.

**Co tím naopak není zpochybněné:** tvar `BaseSectionSpec` potvrzuje, že rozhodnutí D8 je věcně správné. Osm variant nese **jen obsah** (nadpisy, texty, položky, popisky, odkazy, `imageAssetId`) a **žádnou barvu, odsazení ani vnoření**. Barvy přicházejí z `params.brand` přes `brandToTheme()`, na což model nesahá. Tvrzení „model nemůže zvolit špatnou barvu ani nemožnou vnořenou strukturu, protože o nich nerozhoduje" tedy platí doslova.

### K11. `sharp` přitáhne LGPL-3.0-or-later a licenční brána v CI shodí build

**Kde v plánu:** kapitola 2, ř. 104: `| sharp | 0.35.3 | Apache-2.0 | Měření, rasterizace a kvantizace obrázků |`. Kapitola 9 (ř. 10858) upřesňuje, že volání `sharp` má bydlet v `lib/ai/deps.ts`.

Tvrzení o licenci je pravdivé o balíčku `sharp` samotném a **nepravdivé o stromu, který se nainstaluje.**

**Jak ověřeno:** skutečnou instalací, ne čtením metadat.

```
npm install sharp@0.35.3 --ignore-scripts
```
Výsledné `node_modules/@img/`:

| Balíček | Licence |
|---|---|
| `@img/colour` | MIT |
| `@img/sharp-darwin-arm64` | Apache-2.0 |
| **`@img/sharp-libvips-darwin-arm64`** | **LGPL-3.0-or-later** |
| **`@img/sharp-wasm32`** | **Apache-2.0 AND LGPL-3.0-or-later AND MIT** |

Na Linuxu v CI je to totéž s `@img/sharp-libvips-linux-x64`, rovněž `LGPL-3.0-or-later` (ověřeno dotazem na registr). Vazba je `optionalDependencies` platformního balíčku:
```
@img/sharp-linux-x64 → optionalDependencies: { "@img/sharp-libvips-linux-x64": "1.3.2" }
```

**Co udělá CI:** job `licenses-node` v P01 (ř. 9300) pouští `tools/ci/licenses-node.mjs`, který volá
```
pnpm exec license-checker --production --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;CC0-1.0;Unlicense;Python-2.0"
```
a v komentáři i v blocklistu má `LGPL-*` výslovně uvedený. `sharp` je produkční závislost, takže `--production` ho zahrne. **Brána spadne v okamžiku, kdy P15 přidá `sharp` do `package.json`.**

**Proč to není jen formalita, ale ani konec světa:** LGPL u dynamicky linkované nativní knihovny je s distribucí MIT aplikace právně slučitelný, copyleft se vztahuje na samotnou knihovnu a na možnost ji vyměnit. Věcně jde tedy o **kolizi s politikou projektu**, ne nutně o právní překážku. Jenže politika je v tomhle projektu vynucená testem, a plán ji porušuje, aniž by to zmínil. Kapitola 2 přitom začíná větou „Projekt je MIT. Povolené licence: MIT, Apache-2.0, BSD, ISC. GPL, AGPL a LGPL jsou zakázané a licenční brána v CI (P01) je nepustí." Plán tedy pravidlo cituje a v témže odstavci ho poruší.

**Navržená oprava:** rozhodnutí zadavatele, pak zápis do P15 (a případně do P01). Tři možnosti:
1. **Vyměnit knihovnu.** P15 potřebuje jen měření rozměrů, rasterizaci SVG a kvantizaci palety. `@napi-rs/image` (MIT) nebo kombinace `image-size` (MIT) a `@jsquash/*` (Apache-2.0) to pokryjí bez LGPL. Nejčistší, protože nevyžaduje výjimku.
2. **Zapsat časově omezenou výjimku** do `licenses.allow.json` (soubor vlastní P01) s poli `package`, `version`, `license`, `reason`, `approved_by`, `expires_at`, jak brána vyžaduje. Přiznaná díra s datem expirace je lepší než tichá.
3. **Ponechat `sharp`, ale bez vendorované libvips** (build proti systémové knihovně v image). Brána ale skenuje `node_modules`, takže to problém s CI neřeší samo o sobě.

Ať padne kterákoliv, patří to do kapitoly s požadavky na jiné plány (D4) a do rozhodnutí kapitoly 1.

---

## DŮLEŽITÉ

### D1. Blocklist rozsahů je duplikát, ne sdílený seznam, a plán si protiřečí v tom, kdo ho vlastní

**Kde v plánu:** kapitola 0.2 (ř. 36) uvádí `@mlain/core/net/ssrf` (sdílený blocklist a typ `SsrfPolicy`) pod vlastníkem **P04**. Úkol 21 (ř. 4883) říká: „Seznam rozsahů je fakt o IP adresách, ne rozhodnutí produktu, a proto je sdílený s odchozími webhooky (**P01**, `@mlain/core/net/ssrf`)."

**Jak ověřeno:** `grep -n "net/ssrf\|SsrfPolicy" plán` vrací jen tyto dva popisné řádky. Soubor `address.ts` (úkol 21, krok 3) neimportuje nic z `@mlain/core/net/ssrf`; definuje si vlastní tabulky `V4_BLOCKED` (ř. 5042) a `V6_BLOCKED` (ř. 5060). Typ `SsrfPolicy` se v plánu nepoužije ani jednou.

Skutečným vlastníkem je P04 (`packages/core/net/ssrf.ts`, P04 ř. 11647, exportuje `BLOCKED_RANGES`, `isBlockedAddress`, `assertUrlAllowed`, `WEBHOOK_SSRF_POLICY`, `SsrfPolicy`).

**Proč to vadí:** dva seznamy rozsahů se rozejdou. Až někdo přidá rozsah do jednoho, druhý o něm nebude vědět, a tichý rozdíl v bezpečnostním blocklistu je horší než žádný sdílený seznam, protože plán tvrdí, že sdílený je.

**Navržená oprava:** v P15. `address.ts` postavit nad `BLOCKED_RANGES` z `@mlain/core/net/ssrf` a vlastní tabulky zredukovat jen na to, co plán skutečně přidává navíc (rozbalení vnořených IPv4, rozsahy specifické pro extrakci). Sjednotit vlastníka na P04 v obou místech. Doplnit test, který porovná, že každý rozsah z P04 je i ve verdiktu `classifyAddress`.

### D2. Job předává `fetchAssets` natvrdo prázdné pole, takže externí CSS, logo ani písma se nikdy nestáhnou

**Kde v plánu:** úkol 31, krok 3, ř. 8194:
```ts
const assets = await deps.fetchAssets([]);
```

Argument je konstanta. `collectStylesheetUrls` (úkol 26, ř. 6474) a `collectLogoCandidates` (úkol 27, ř. 6879) sice kandidáty vyrábějí, ale jejich výsledek se do `fetchAssets` nikdy nedostane. `buildBrandProfile` pak dostane `assets: []` a odvození palety (úkol 28) i výběr loga (úkol 27) pracují jen nad inline HTML.

**Proč to vadí:** kritérium 52 („extrakce z webu bez loga a barev skončí jako `succeeded` s výchozí paletou") by procházelo vždy, protože každý web by vypadal jako web bez loga a barev. Hlavní slib funkce, tedy „šablona ve firemních barvách", by nefungoval na žádném webu, který má barvy v externím stylopisu, což je prakticky každý.

**Navržená oprava:** v P15, úkol 31. Mezi `fetchPage` a `fetchAssets` vložit parsování stránky, sběr kandidátů přes `collectStylesheetUrls` a `collectLogoCandidates`, a jejich URL předat do `fetchAssets` (s limity `BRAND_FETCH_MAX_CSS_FILES` a `BRAND_FETCH_MAX_IMAGE_FILES`, které úkol 33 už od P01 vyžaduje). Doplnit test, že se `fetchAssets` volá s neprázdným seznamem.

### D3. Počet testů v úkolu 23 nesedí

**Kde:** úkol 23, krok 7, ř. 5948: „Expected: PASS, 16 passed".

**Jak ověřeno:**
```
sed -n '5371,5450p' plán | grep -c "^  it("   → 4   (connector.test.ts)
sed -n '5525,5755p' plán | grep -c "^  it("   → 13  (safe-fetch.test.ts)
```
Skutečně 17. Rozpad safe-fetch: šťastná cesta 1, limity 4 (T11 až T14), přesměrování 8 (T9, T10, https na http, http na https, cyklus, cizí schéma, relativní Location, meta refresh).

**Navržená oprava:** v P15, opravit číslo na 17.

### D4. P15 nemá kapitolu s požadavky na jiné plány a nezapsal jediný nález do sdílené evidence

**Jak ověřeno:**
```
for f in 2026-07-31-p*.md; do echo "$f: $(grep -ciE '^## .*[Pp]ožadavky na' $f)"; done
```
P05, P09, P11, P12, P13 a P14 takovou kapitolu mají, P15 nikoli. `grep -n "P15" NALEZY-NAPRIC-PLANY.md` nevrací nic.

Přitom plán potřebuje od cizích plánů minimálně: 27 konfiguračních proměnných v manifestu P01 (vyjmenované v úkolu 33), zhruba 25 chybových kódů v registru P01, opravu entrypointu kvůli `ANTHROPIC_AUTH_TOKEN` (K5), změnu typu sloupce v P03 (K8), rozhodnutí o umístění `queue-handlers.ts` (K7) a pět exportů od P08 (úkol 2). Kapitola 8.1 to místo toho popisuje formulkou „když v nich něco chybí, plán to nahlásí", aniž by kdekoli existoval seznam toho, co se hlásí.

**Navržená oprava:** v P15. Doplnit kapitolu „Požadavky na jiné plány" ve stejném tvaru, jaký má P13 a P14, a zapsat do ní všechny nálezy K5, K7, K8 a D1. Nálezy mimo vlastnictví zapsat i do `NALEZY-NAPRIC-PLANY.md`.

### D4b. Čtyři chybové kódy nejsou v registru P01, ačkoli si to plán sám zakazuje

**Jak ověřeno:** vytažen seznam všech kódů `ai_*` a `brand_*` z obou plánů a porovnán.

```
grep -oE "'(ai|brand)_[a-z_0-9]+'" P01 | sort -u        → 27 kódů
grep -oE "code: '(ai|brand)_[a-z_0-9]+'" P15 ... | sort -u → 29 kódů
comm -23 /tmp/p15_codes.txt /tmp/p01_codes.txt
```

Chybí v P01:

| Kód | Kde v P15 | Poznámka |
|---|---|---|
| `ai_base_url_not_allowed` | úkol 19, tvar odpovědi | `errors[].code` u `validation_failed` |
| `ai_base_url_required` | úkol 7, ř. 1439 | `errors[].code` u `validation_failed` |
| `ai_custom_base_url_disabled` | úkol 7, ř. 1431 | `errors[].code` u `validation_failed` |
| `ai_key_leaked_from_env` | úkol 5, ř. 1030 | jen logovací kód, P01 ho zná v komentáři (ř. 4062), ale nemá ho v registru |

První tři jsou důvody na úrovni pole a patří do uzavřeného registru `VALIDATION_CODES` (P01, ř. 1984). Ten je podle architektury P01 „předdeklarovaný úplný, dopředu, pro všech sedm specifikací, takže ho pozdější doménové plány jen čtou a nikdy nerozšiřují". Konvence P15 (ř. 256) říká totéž: „Nikdy nezakládám nový kód... Když kód chybí, je to požadavek na P01, ne lokální konstanta." Plán tedy vlastní pravidlo čtyřikrát poruší a kvůli chybějící kapitole s požadavky (D4) to nikam nenahlásí.

Opačným směrem je plán v pořádku: P01 má `brand_extract_running`, který P15 nepoužívá, protože souběh řeší obecným `conflict`, a to je s konvencí v souladu.

**Navržená oprava:** v P01 doplnit tři kódy do `VALIDATION_CODES` a `ai_key_leaked_from_env` do registru logovacích kódů. V P15 to zapsat jako požadavek.

### D5. `buildModel` vrací handle typovaný jako `unknown`

**Kde:** úkol 7, krok 3, ř. 1391:
```ts
export type LanguageModelLike = unknown;
```

`ProviderHandle.model` je tedy `unknown` a každý spotřebitel (`chat.ts`, `compose.ts`, nástroje) si ho musí přetypovat. Plán přitom v konvencích (ř. 257) staví na tom, že klíč je vynucený typem („Předání `string` se nezkompiluje"), tedy typům důvěřuje jako obraně. U nejdůležitějšího návratového typu celého souboru tu obranu vypíná.

**Navržená oprava:** v P15. V adaptéru `src/ai/sdk` (úkol 8) reexportovat `LanguageModelV2` z balíčku `ai` a `LanguageModelLike` na něj navázat. Adaptér je právě proto jediné místo, které smí importovat `ai`.

### D6. Kritérium 7c má dvě implementace a dva vlastníky

**Jak ověřeno:** P01 ř. 3849 obsahuje test „žádná proměnná nekončí na `_API_KEY` (kritérium 7c)" nad `configVariableNames()`, a tabulka kritérií P01 (ř. 9600) si 7c nárokuje s odkazem na úkol 10. P15 zakládá týž test znovu (úkol 33) a v kapitole 7 (ř. 10730) si kritérium nárokuje také.

Samotná duplicita není vada, dvě vrstvy u bezpečnostního kritéria jsou obhajitelné. Vadné je, že to nikde není rozhodnuto ani přiznáno, takže při první změně vzoru se opraví jeden test a druhý zůstane.

**Navržená oprava:** v P15. Buď doplnit do rozhodnutí kapitoly 1 řádek, proč se test schválně dubluje, nebo úkol 33 zredukovat na tu část, kterou P01 nemá (třetí test, že proměnné `AI_*` a `BRAND_*` v manifestu skutečně jsou), a kontrolu vzoru přenechat P01.

### D7. Nepovolená `base_url` se u anthropicu tiše ignoruje místo odmítnutí

**Kde:** úkol 7, krok 3, ř. 1427. Podmínka `if (descriptor.allowsBaseUrl && credential.baseUrl !== null ...)` znamená, že u providera, který vlastní URL nepovoluje, se hodnota přeskočí bez chyby. Test na ř. 1296 to potvrzuje jako žádané chování („baseUrl se u anthropicu ignoruje").

Vzhledem k tomu, že `base_url` je vstup od uživatele a zároveň SSRF plocha (K6), je tiché zahození horší než odmítnutí: uživatel nedostane zpětnou vazbu a v databázi zůstane hodnota, kterou při změně providera někdo omylem začne používat.

**Navržená oprava:** v P15. Změnit na `validation_failed` s kódem `ai_base_url_not_allowed`, který plán už jinde používá (ř. s `code: 'ai_base_url_not_allowed'`).

---

## POZNÁMKY

### N1. Ceník pro Sonnet 5 nezohledňuje zaváděcí cenu platnou do 31. 8. 2026

`pricing.json` (úkol 4, ř. 831) uvádí `anthropic/claude-sonnet-5` za 3 USD vstup a 15 USD výstup za milion tokenů. To je správná katalogová cena, ale do 2026-08-31 platí zaváděcí 2 a 10 USD. Ceník má `updatedAt: 2026-07-31`, takže po celý srpen by odhad nákladů přestřeloval o padesát procent. Rozhodnutí D2 přitom staví na tom, že uživateli o cenách nelžeme. Ostatní tři ceny jsou přesné.

Oprava v P15: buď doplnit zaváděcí cenu s datem platnosti, nebo do UI přidat poznámku, že jde o katalogovou cenu.

### N2. Rozhodnutí D11 mluví o identifikátoru, který neexistuje

Ř. 81: „přepis identifikátorů modelů do tvaru s tečkou (`claude-sonnet-4.6`)". Takový identifikátor nemá tvar žádného skutečného modelu ani ve tvaru s tečkou, ani s pomlčkami, a navíc se míjí s rodinou, kterou plán používá (Claude 5). Věcně je rozhodnutí správné (do `models.json` patří identifikátory, které API přijme), jen příklad je vymyšlený.

### N3. Komentář v overlay compose neodpovídá kódu pod ním

Ř. 8490: „`api.anthropic.com` se přes `extra_hosts` přesměruje na sniffer." YAML pod tím `extra_hosts` nepoužívá, používá `networks.default.aliases`. Mechanismus je jiný (vestavěné DNS Dockeru místo `/etc/hosts`) a při ladění testu z K3 to svede čtenáře jinam.

### N4. Svazek `egress-count` u služby `app` je nepoužitý

Ř. 8519-8520 montují `egress-count:/tmp/egress` do aplikace, ale test počítadlo čte přímo ze snifferu (`compose exec egress-sniffer cat /tmp/egress-count.txt`). Navíc `app` má v P01 `read_only: true` a `/tmp` jako tmpfs, takže je to zbytečná komplikace v konfiguraci, která už teď nestartuje.

### N5. Test kritéria 7b běží proti vydané image, ne proti lokálnímu buildu

`docker/compose.yml` v P01 (ř. 7849) používá `image: ghcr.io/nc-mill/mlain:1.0.0`. Test v úkolu 32 image nesestavuje, takže by ověřoval chování posledního vydání, ne rozpracované větve. Pro bezpečnostní kritérium, které má chytat regrese, je to obrácené pořadí.

### N7. Konvence odkazují dvakrát na úkol 41, který neexistuje

**Jak ověřeno:** `grep -noE "úkol[uy]? (39|4[0-9]|5[0-9])"` vrací ř. 260 a 262; nejvyšší skutečný úkol je 38.

Kapitola 4 (Konvence) tvrdí „Hlídá to test v úkolu 41" u dlouhé pomlčky a „Kompletní série v úkolu 41" u závěrečných testů. Obojí ve skutečnosti bydlí v úkolu 38 (kroky 5 a 6). Jde o zbytek po dřívější verzi plánu s víc úkoly. Kontroly samotné existují a jsou v pořádku, chybné je jen číslo, což čtenáře pošle hledat neexistující kapitolu.

**Navržená oprava:** v P15, nahradit obě „41" za „38".

### N6. Poměr červené a zelené fáze

Plán má 40 kroků `Expected: FAIL` a 37 kroků `Expected: PASS`. Rozdíl je v pořádku (některé úkoly mají dvě červené fáze). Uvádím to jen jako doklad, že disciplína TDD je v plánu držená důsledně, na rozdíl od zapojení výsledného kódu.

---

## Co jsem ověřil jako v pořádku

Ověřeno spuštěním, ne přečtením. U každé položky je uvedeno, čím.

**Formální a početní tvrzení**

- **38 úkolů a 229 kroků** sedí přesně s tvrzením v zadání. `grep -c "^### Úkol " → 38`, `grep -c "^- \[ \] \*\*Krok" → 229`, a totéž číslo pro všechny zaškrtávací řádky, takže žádný krok není mimo očekávaný tvar.
- **Dlouhá pomlčka U+2014 se v plánu nevyskytuje ani jednou.** Ověřeno `grep -c` na znak U+2014 nad celým souborem, výsledek 0. Kontrola navíc **existuje jako krok** (úkol 38, krok 6) a je napsaná chytře: hledaný znak se skládá přes `printf '\342\200\224'`, aby sám nebyl v plánu obsažen a kontrola se netrefila do vlastního zadání. Jediná vada je zastaralé číslo odkazu, viz N7.
- **Zástupné texty:** `grep -nE "TODO|TBD|FIXME|XXX|placeholder"` vrací jen tři zásahy, dva jsou legitimní atributy `placeholder` u formulářových polí a třetí je věta v kapitole 9. Tvrzení kapitoly 9 o nepřítomnosti zástupných textů platí, s výjimkou tří neexistujících souborů z K1, což je jiná kategorie vady.
- **Aritmetika v ceníku sedí.** Test `estimateCostUsd('anthropic', 'claude-opus-5', 200_000, 40_000)` očekává 2 USD; při 5 USD za milion vstupních a 25 za milion výstupních vychází 1,0 + 1,0 = 2,0.

**Kritérium 7c (druhá polovina zadání)**

- **Žádná konfigurační proměnná P15 nekončí na `_API_KEY`.** Ověřeno na celém seznamu 27 proměnných z úkolu 33: devět `AI_*` a osmnáct `BRAND_*`. Všechny výskyty řetězce `_API_KEY` v plánu (38 dohromady) jsou buď fallback proměnné cizích SDK, nebo testovací data, nebo popis vzoru, nikdy vlastní konfigurace.
- **Kontrola má test a je správně napsaná.** `assertNoConfigVarEndsWithApiKey` (ř. 1043) používá `name.endsWith('_API_KEY')`, což přesně odpovídá vzoru `*_API_KEY` v entrypointu P01. Test v úkolu 33 obsahuje i negativní případ (`AI_PROVIDER_API_KEY` musí hodit výjimku), takže nejde o test, který nemůže spadnout.
- **Cesta k manifestu sedí.** `new URL('../config/config.manifest.json', import.meta.url)` z `packages/core/src/ai/` míří na `packages/core/src/config/config.manifest.json`, což je přesně to místo, kam ho podle rozhodnutí D5 a skriptu `write-manifest.ts` zapisuje P01 (P01 ř. 4141). Test tedy nespadne na neexistujícím souboru.

**Licence a verze závislostí**

Ověřeno dotazem na `registry.npmjs.org` u všech sedmnácti balíčků z kapitoly 2, ne přečtením tabulky. **Šestnáct ze sedmnácti je v pořádku**, jediná výjimka je `sharp` (K11).

- **Všechny uvedené verze existují.** Ověřeno adresným dotazem na `registry.npmjs.org/<balíček>/<verze>`, ne jen na `latest`: `ai@7.0.44`, `@ai-sdk/anthropic@4.0.25`, `@ai-sdk/openai@4.0.25`, `@ai-sdk/google@4.0.29`, `@ai-sdk/react@4.0.47`, `@ai-sdk/openai-compatible@3.0.18`, `sharp@0.35.3`. Žádná vymyšlená verze, žádné číslo z budoucnosti.
- **Všechny uvedené licence sedí s registrem.** `ai`, `@ai-sdk/*` a `@openrouter/ai-sdk-provider` jsou Apache-2.0; `undici`, `ipaddr.js`, `robots-parser`, `postcss`, `culori`, `file-type`, `zod`, `nanoid` jsou MIT; `linkedom` je ISC. Přesně jak plán tvrdí.
- **Pinované verze jsou konzistentní s aktuálními.** `ai` je pinovaný na 7.0.44 při aktuálních 7.0.47, `@ai-sdk/anthropic` na 4.0.25 při 4.0.27 a tak dál. Rozdíl je v řádu patchů uvnitř téže major, tedy pinování, ne zastaralost. Major řady si vzájemně odpovídají (`ai` v7 a `@ai-sdk/*` v4), což je u AI SDK správné párování.
- **`nanoid@6.0.0` a `file-type@22.0.1` opravdu existují** a jsou to aktuální major verze, ne překlep.

**Identifikátory modelů a ceny**

Ověřeno proti katalogu modelů, ne odhadem.

| Model v `models.json` | Identifikátor | Okno | Strop výstupu | Cena vstup/výstup |
|---|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` OK | 1 000 000 OK | 128 000 OK | 5 / 25 OK |
| Claude Sonnet 5 | `claude-sonnet-5` OK | 1 000 000 OK | 128 000 OK | 3 / 15 (viz N1) |
| Claude Fable 5 | `claude-fable-5` OK | 1 000 000 OK | 128 000 OK | 10 / 50 OK |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` OK | 200 000 OK | 64 000 OK | 1 / 5 OK |

Žádný vymyšlený ani zastaralý identifikátor. Rozhodnutí D2 a D3 (uvádět jen doložitelné ceny a modely, u ostatních providerů prázdný seznam a živý dotaz na seznamový endpoint) je poctivé řešení, které se vyhýbá vymýšlení faktů.

**Strukturovaný výstup a vztah k P08 (čtvrtá část zadání)**

- **Záměr jednoho zdroje pravdy je splněný, plán si schéma nekopíruje.** `compose-schema.ts` (ř. 2887) importuje `baseSectionSpecSchema` z `@mlain/emails/base` a používá ho přímo jako `z.array(baseSectionSpecSchema)`. P15 nemá nikde vlastní definici sekcí, žádnou paralelní kopii blokového modelu ani obcházení. P08 sám (ř. 1406) uvádí structured output AI jako jednoho ze tří zamýšlených konzumentů schématu, takže dohoda je oboustranná. **Jediná vada je, že ten konkrétní export v P08 zatím neexistuje (viz K10); architektonicky je rozhodnutí správné a oprava patří do P08, ne do P15.**
- **Model nerozhoduje o vzhledu.** Ověřeno na skutečném tvaru `BaseSectionSpec` v P08 (ř. 8741): osm variant nese jen obsah, žádnou barvu, odsazení ani vnoření. Barvy vznikají z `params.brand` přes `brandToTheme()` uvnitř `buildBaseTemplate`. Tvrzení rozhodnutí D8 tedy platí doslova a je to dobrá bezpečnostní vlastnost: prompt injection z cizího webu nemá čím ovlivnit vzhled šablony.
- **Kontrakt se ověřuje hned, ne na konci.** Úkol 2 nic neimplementuje a jen ověřuje existenci a tvar pěti rozhraní od P08. Rozhodnutí D10 to zdůvodňuje správně a kapitola 6 na to navazuje pravidlem „úkol 2 spadne, zastav větev A".
- **Chování při nevalidní odpovědi modelu je dotažené.** Ověřeno na testech úkolu 14: proběhne právě jeden opravný pokus, do něhož se posílá syrový text odpovědi i konkrétní výčet chyb z `formatZodIssues` (ne obecné „nevalidní odpověď"); po druhém selhání se vrátí `ai_invalid_output` a `buildBaseTemplate` se **nezavolá**, takže šablona zůstane beze změny; částečná odpověď se nikdy nepoužije a chybějící pole se nedohadují; výsledek se navíc vždy znovu ověří naším `validateDocument` i `validateLiquid`, takže selhání vlastní validace dokument do databáze nepustí. Kritérium 67 je tím pokryté doopravdy.
- **Model neplní `Document`, ale `BaseSectionSpec[]`** (rozhodnutí D8). To je správná volba i bezpečnostně: model nerozhoduje o barvách ani o vnořené struktuře, takže prompt injection z extrahovaného webu nemá čím ovlivnit vzhled.

**Ochrana proti SSRF (třetí část zadání), návrhová stránka**

Návrh je věcně správný a odpovídá kapitole 3.13 specifikace. Vady jsou v zapojení (K2), ne v logice.

- **DNS rebinding je ošetřený na dvou místech, ne na jednom.** Před spojením se jméno rozliší explicitně a všechny vrácené adresy se zkontrolují; po navázání spojení konektor přečte `socket.remoteAddress` a při zakázané adrese socket zabije a vrátí `brand_blocked_address`. Druhá kontrola měří **skutečný stav spojení**, ne předpoklad, takže zabere i tehdy, kdyby první selhala. To je přesně to, na co se zadání ptalo, a plán to má.
- **Kontrolují se všechny vrácené adresy, ne jen ta použitá.** `resolveHostSafely` (ř. 5335) prochází sjednocení výsledků `resolve4` a `resolve6` a při jediné zakázané odmítne celý požadavek bez filtrování. Odpovídá požadavku specifikace na ř. 2663 („přítomnost zakázané adresy v odpovědi je sama o sobě signál pokusu o rebinding"). Test T7 i jeho IPv6 varianta to pokrývají.
- **Rozlišení jmen jde přes `Resolver.resolve4/6`, ne přes `lookup()`.** Zdůvodnění (ř. 5165) je správné: `lookup()` konzultuje `/etc/hosts` a vyhledávací domény, takže by šlo přeložit vnitřní jméno bez toho, aby to bylo v URL vidět.
- **IP literál přeskočí DNS a zkontroluje se přímo**, takže `169.254.169.254` v URL neprojde ani oklikou.
- **Přesměrování se obsluhují ručně a kontrola běží při každém hopu.** Každý hop projde znovu celým řetězcem: `normalizeBrandUrl`, kontrola cyklu proti množině `seen`, DNS, kontrola adres, teprve pak požadavek. `maxRedirections` na úrovni `undici` se vědomě nepoužívá, protože by `Location` následovalo bez kontroly. Pokryté případy: čtvrté přesměrování (`brand_too_many_redirects`), sestup z https na http (`brand_insecure_redirect`), cyklus (`brand_redirect_loop`), cizí schéma jako `file://` (`brand_scheme_not_allowed`), relativní `Location`, a `meta refresh` se nenásleduje vůbec.
- **Požadavek „žádná přesměrování" se extrakce netýká.** Ověřeno ve specifikaci: věta je v `01-platforma.md` ř. 4249 v řádku o **odchozích webhoocích**. Pro extrakci značky platí `03-obsah.md`, kapitola 3.13.6 (ř. 2747-2757), která tři přesměrování výslovně povoluje a definuje přesně ta pravidla, která plán implementuje. P15 tedy specifikaci neporušuje, jen se ta dvě místa nesmí zaměnit.
- **Uživatel nedostane orákulum.** Ven jde jen `hops` s třídou adresy `'public'`, nikdy IP; kontroluje se to i tvrzením `expect(JSON.stringify(result.hops)).not.toContain('93.184.216.34')`. Chybové kódy (`brand_blocked_address`, `brand_dns_failed`, `brand_timeout`, `brand_fetch_failed`) nerozlišují `ECONNREFUSED` od `ETIMEDOUT`. Odpovídá požadavku specifikace na ř. 2798.
- **Limit velikosti se počítá ze streamu, ne z hlavičky `Content-Length`,** s komentářem „hlavička je tvrzení serveru, ne fakt". Test T11 to ověřuje lživou hlavičkou, T12 dekompresní bombou.
- **Statická kontrola existuje a ověřuje se, že chytí porušení.** ESLint pravidlo v úkolu 25 má vlastní testovací soubor s pozitivními i negativními vzorky, takže kritérium 56 není jen věta v dokumentaci.
- **Katalog chybových kódů značky je úplný** proti specifikaci (ř. 2956-2958 a tabulka scénářů T1 až T20). Kritérium 51 v kapitole 7 pokrývá právě dvacet scénářů, součet po úkolech sedí.

**Lokalizace**

Namespace `ai` je bez jediné vady. Ověřeno skriptem, ne okem:

- **Oba katalogy jsou syntakticky platné JSON** a mají shodných 11 kořenových klíčů.
- **Parita je úplná: 126 listů v `cs/ai.json`, 126 v `en/ai.json`, průnik dokonalý.** Rozdíl v obou směrech je prázdná množina.
- **Všech 60 unikátních volání `t('...')` v úkolech 35 až 38 má svůj klíč v katalogu.** Chybějící klíč: žádný. Zkontrolováno vytažením volání regulárním výrazem z úkolů obrazovek a porovnáním proti klíčům vytaženým z katalogu úkolu 34.

Použitý postup (Python, rekurzivní zploštění obou stromů plus množinový rozdíl) je v přepisu revize. Vzhledem k tomu, že `i18n-check` v úkolu 38 tuhle kontrolu má také, jde o oblast, kde plán drží slovo.

**Ostatní**

- **Job extrakce má `retryLimit: 0`** s dobrým zdůvodněním (opakování téhož SSRF pokusu není žádoucí), sedí s registrem front P01, a zaseknuté běhy uklízí `sweepStaleExtractions` po pěti minutách.
- **Rate limit vrací obecný kód `rate_limited` z katalogu P01**, ne vlastní `brand_rate_limited`, a plán na to má explicitní test. Dodržuje tím vlastní konvenci „nikdy nezakládám nový chybový kód".
- **Hodnota klíče se nikdy nedostane do auditu ani do logu.** Ověřeno tvrzeními typu `expect(JSON.stringify(writeAuditLog.mock.calls)).not.toContain('sk-tajne')` a konvencí u logů (ř. 258), která jmenuje i hlavičky `x-api-key` a `x-goog-api-key`.
- **Rozhodnutí D4 a D5** (žádné SSE pro průběh extrakce, fáze se neukládají do databáze) jsou obhájená správně a konzistentně s tím, co plán skutečně dělá: `brand_extractions` v P03 opravdu sloupec pro fázi nemá a obrazovka 8.5.4 se dotazuje po 1000 ms.

---

## Doporučené pořadí oprav

0. **K10 a K11 hned, ještě před zahájením.** Runtime schéma v P08 je předpoklad úkolu 2, a ten je druhý v pořadí; bez něj se plán zastaví na vlastním kontraktním testu dřív, než cokoliv napíše. Licence `sharp` shodí CI při prvním `pnpm install`, tedy ještě dřív. Obojí jsou rozhodnutí mimo P15 (P08, respektive zadavatel plus P01) a obojí je levné, dokud se nezačalo implementovat.
1. **D4 jako první krok v P15.** Kapitola s požadavky na jiné plány je předpokladem k tomu, aby se K5, K7, K8, K10 a D4b vůbec dostaly ke svým vlastníkům. Dnes plán nemá kam je zapsat.
2. **K1 a K2 společně** jedním novým úkolem (kompoziční kořen plus zapojení konektoru a resolveru). Bez toho nemá smysl opravovat nic dalšího, protože produkt neběží ani po zelených testech.
3. **K3** (přepis testu 7b včetně pozitivní kontroly a přihlášeného požadavku) a **K9** (přepis testu kritéria 70). Obojí jsou bezpečnostní kritéria, která dnes prochází vakuově.
4. **K6** (validace `base_url`) v P15. **K5**, **K7** a **D4b** jako požadavky na P01, **K8** jako požadavek na P03 do jediného doplňkového průchodu schématem (nález N9).
5. Zbytek.

**Odhad.** Původní odhad „jeden až dva dny" neplatí. Plán nemá kompoziční kořen **ani repozitářovou vrstvu** (viz K1), takže chybí celý přístup k databázi pro sedm tabulek plus zapojení sítě. Realističtěji **tři až pět dní** na straně P15, z toho většina na repozitáře a na dva bezpečnostní testy, které se musí napsat od začátku. K tomu jeden zásah do P08 (runtime schéma), jeden do P01 (tři validační kódy, `ANTHROPIC_AUTH_TOKEN`, rozhodnutí o cestě k handleru fronty), jedna položka do doplňkového průchodu P03 a jedno rozhodnutí zadavatele o licenci `sharp`.

**Jedno varování k dalším revizím.** Protože plán databázi nikdy nepíše, **tahle revize nemohla porovnat P15 proti schématu P03 sloupec po sloupci** tak, jako to šlo u P14 nebo P10. Jediný schématický nález (K8) vznikl z tvaru dat, ne z dotazu. Až repozitářová vrstva vznikne, musí projít samostatnou revizí proti P03; typické nálezy téhle rodiny (`NOT NULL` bez `DEFAULT`, porušené `CHECK`, chybějící sloupce v `ON CONFLICT`) se dnes nemají kde projevit.
