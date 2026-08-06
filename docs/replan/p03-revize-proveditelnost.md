# Revize P03: proveditelnost

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P03, úhel proveditelnost z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Datum: 2026-08-01. Model: opus. Plán: `2026-07-31-p03-databaze-schema-rls.md`, hash `05f14f0`.
Verdikt: **NALEZENY PROBLÉMY**. 5 kritických, 12 důležitých, 10 poznámek.

Hlavní nálezy ověřeny spuštěním proti reálnému PostgreSQL a dohledáním v plánu P01.

## Kritické

**K1. Založení projektu neprojde, RLS ho zablokuje dvakrát. Ověřeno spuštěním.**
`INSERT ... RETURNING` uplatní na nový řádek i SELECT politiky, a obě jsou nepravdivé.
Tentýž `INSERT` bez `RETURNING` projde. Následné vložení členství selže také.
**Tentýž nález nezávisle našla i bezpečnostní recenze (K1).**

**K2. Úkol 4 očekává devět zelených testů, ale spadnou všechny.**
Testovací harness má migrace zapnuté a runner čte soubor, který vzniká až o úkol později.
Výjimka v souborovém `beforeAll` shodí celý soubor. Plán si toho mechanismu je jinde vědom,
jen ho nedomyslel o jeden úkol dřív.

**K3. Finální brána plánu volá skript, který neexistuje.**
`pnpm --filter @mlain/db lint` není nikde definovaný, P01 lintuje výhradně z kořene a žádný
balíček skript `lint` nemá. Poslední krok plánu tedy skončí chybou.

**K4. Dvě role nikdo nezakládá a migrace to tiše spolkne.**
Plán počítá se šesti rolemi, P01 zakládá čtyři. Role pro výmaz podle GDPR a pro retenci
v P01 ani ve specifikaci **nejsou vůbec**. Granty pro obě jsou v migraci obalené výjimkou,
takže se v produkci **tiše přeskočí** a s nimi zmizí jediná cesta, jak smazat souhlasy
a staré události.

Testy to odhalit nemohou, protože **testovací harness si všech šest rolí zakládá sám**,
takže test „role má právo mazat" je zelený, zatímco v produkci ta role neexistuje.
Je to znovu tentýž vzorec: testuje se jiné prostředí, než jaké běží u zákazníka.

**K5. Blokující CI job zůstane po mergnutí červený a nikdo ho nesmí opravit.**
P01 dodává kontrolní skript, který **záměrně** selže, dokud mu někdo nedodá scénáře, a předává
to jako požadavek. P03 je ale píše jinam a jeho vlastní pravidlo mu zakazuje sáhnout mimo
svůj balíček. Vlastnictví té opravy nemá nikdo.

## Důležité (výběr)

| # | Nález |
|---|---|
| D2 | `package.json` a `tsconfig.json` už existují z P01, P03 je uvádí jako nově zakládané a přepsal by je jinak, včetně zahození údaje o licenci, který hlídá CI |
| D4 | Vnitřní rozpor: odůvodnění, proč se granty obalují výjimkou, neplatí, protože dřívější migrace na chybějící roli spadne dřív. Dnes to maskuje K4 |
| D5 | Čítač neúspěšných migrací je tichý no-op. **Potvrzuje nález schématové recenze (K3).** Sloupec navíc proti specifikaci vznikl kvůli čítači, do kterého se nikdy nezapíše |
| D6 | Test „spojení běží v UTC" nemůže spadnout, protože se ptá poolu, který si harness sám nastavil. Ochrana, kterou má hlídat, není otestovaná vůbec |
| D7 | Nepoužité importy ve čtyřech souborech shodí typovou kontrolu, plán varuje jen u jednoho |
| D9 | Testy mutují repozitář a hned nato se kontroluje čistota pracovního stromu, takže vygenerovaný soubor bude vypadat jako porušení vlastnictví |
| D10 | Kontraktní SQL se do testu **opisuje ručně** místo importu z kontraktů. Test tedy dokazuje, že projde opis, ne kontrakt. Přitom historickou poruchou, kterou plán sám cituje, bylo „normativní SQL, které nikdo nikdy nespustil" |
| D12 | Dvě migrace nemají žádný padající test, přestože jejich selhání je tiché: chybějící grant se pozná až v provozu, přebytečný nikdy |

## Poznámky, které stojí za pozornost

- **Čtyři úkoly jsou řádově nad limit 2 až 5 minut** (390, 270, 280 a 400 řádků) a sedm úkolů
  po sobě nemá žádnou testovací bránu, jen typovou kontrolu. Chyba v přepisu jednoho omezení
  se projeví až o pět úkolů dál.
- Chybí behaviorální test izolace na nejrizikovější ploše, tedy na tabulkách s výjimkou
  pro sender. Kontroluje se u nich jen deklarativně, že politika existuje.
- Celá sada startuje zhruba 22 kontejnerů, každý s plnou sadou migrací a 36 oddíly.
  Limit patnácti minut v CI je těsný a doménové plány přidají další.

## Co recenze ověřila jako v pořádku

Částečný unikátní index na partitionované tabulce projde. Mazání pod RLS jen s právem `DELETE`
bez `SELECT` funguje. `EXPLAIN` bez `ANALYZE` prořezávání podle času skutečně provede,
takže test na prořezávání je platný (jen počítá špatně, viz schématová recenze D2).
