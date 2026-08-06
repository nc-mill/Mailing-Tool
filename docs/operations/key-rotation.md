# Rotace šifrovacího klíče

**K čemu to je:** postup výměny `SECRET_KEY` za nové pokolení, aniž by se ztratily
uložené přístupy k odesílání a otisky smazaných adres.

Revize: 2026-08-06. Příkazy ověřené proti `apps/cli/src/registry.ts`, chování
proti `packages/core/src/ops/genkey.ts` a `rotate-credentials.ts`.

Postup je totožný s výpisem příkazu `mlain genkey`, tenhle dokument ho doplňuje
o to, co se z výpisu nevejde.

## Postup

```bash
# 1. Vygeneruj nové pokolení klíče. Číslo si příkaz odvodí z prostředí instalace.
docker compose exec app mlain genkey
```

Výpis obsahuje nový klíč ve tvaru `<id>:<base64url>` a přesné pořadí dalších
kroků, celkem šest. První řádek říká, jaká pokolení příkaz v prostředí našel
a jaké číslo z toho odvodil; zkontrolujte ho, je to jediná pojistka proti tomu,
že příkaz běžel v jiném prostředí, než jste mysleli.

> **`--id` se běžně nezadává, ale zadat se dá.** Příkaz čte `SECRET_KEY`
> a `SECRET_KEY_PREVIOUS` z prostředí, ve kterém běží, a vezme následující volné
> číslo. Databázi k tomu nepotřebuje, takže funguje i při havárii.
>
> - Když v prostředí žádné pokolení není (typicky spuštění na svém stroji nebo
>   před instalací), příkaz **odmítne hádat** a `--id` si vyžádá. První klíč
>   nové instalace je `--id 1`.
> - Když zadáte `--id`, které instalace **už zná**, příkaz to odmítne. Druhý
>   různý klíč se stejným `key_id` znamená, že se data zašifrovaná tím prvním
>   přestanou dát přečíst, a neohlásí to nic: `key_id` sedí, takže se sáhne
>   po klíči, který k datům nepatří.
>
> Dřív měl `--id` výchozí hodnotu `2` a při druhé rotaci bez přepínače vznikl
> přesně ten druhý různý klíč s dvojkou. Proto ta výchozí hodnota zmizela.
> Číslo je celé, 1 až 255. Jak se blížíte ke stropu, `mlain doctor` to hlásí
> nálezem `key_id_ceiling_near` (od pokolení 200 výš).

```bash
# 2. Do konfigurace VŠECH procesů (web, worker, sender) zapiš NOVÝ klíč jako
#    SECRET_KEY a STARÝ přesuň na začátek SECRET_KEY_PREVIOUS
#    (čárkou oddělený seznam).
# 3. Restartuj VŠECHNY procesy a u každého ověř readiness.
docker compose up -d --force-recreate
#    V rozděleném režimu:
#    docker compose -f compose.yml -f compose.scale.yml up -d --force-recreate

# 4. Přešifruj uložené obálky na aktuální pokolení. WORKER MUSÍ BĚŽET, viz níž.
docker compose exec app mlain rotate-credentials

# 5. Počkej 15 minut, než vyprší identifikační tokeny z prokliků.

# 6. Ověř.
docker compose exec app mlain doctor
```

## Pořadí kroků 2 a 3 se nesmí prohodit

Kdyby se restart udělal dřív, než je nový klíč v konfiguraci, běží procesy dál
se starým klíčem. Jenže konfigurace, kterou mezitím zapíše web, je zašifrovaná
**novým** klíčem, a sender ji přečíst nedokáže. Každé dešifrování selže.

U kampaně na milion příjemců to znamená **milion zpráv označených jako
neúspěšné**, protože sender nemá jak získat přístupové údaje k providerovi.
Chyba se navíc projeví až ve chvíli odesílání, ne při restartu.

## Krok 4 potřebuje běžící worker

`mlain rotate-credentials` udělá dvě věci, ne jednu:

1. **přešifruje obálky** uložených přístupů, tedy tu část, která jde přešifrovat
   na místě,
2. **zařadí úlohu `contacts.refingerprint`** do fronty. Otisky adres
   v `contacts.email_fingerprints` se totiž nešifrují, ale **počítají z klíče**,
   takže po rotaci kontaktům chybí otisk pod novým pokolením. Průchod všemi
   kontakty patří do fronty, ne do příkazu.

Když se úlohu zařadit nepodaří, příkaz to **napíše a skončí kódem 1**, ale
přešifrování už proběhlo. Spusťte ho pak znovu, až worker poběží; přešifrování
je idempotentní a nic nepokazí.

Prakticky: krok 4 nepouštějte na instalaci, kde je worker zastavený kvůli
odstávce. Nejdřív procesy nahoru, pak rotace.

## `SECRET_KEY_PREVIOUS` se nikdy nevyprazdňuje

Ani po `mlain rotate-credentials`. Rotace přešifruje **obálky** uložených
přístupů, ale otisky smazaných adres v `suppressions` se přepočítat nedají:
otisk je jednosměrný a původní adresa už v systému není. Otisky se proto počítají
a porovnávají **pod všemi známými pokoleními**, bez horního stropu.

Vyprázdněný `SECRET_KEY_PREVIOUS` znamená, že se smazaní lidé přestanou poznávat.
Import proběhne úspěšně, nikde se nic nezaloguje a člověk, který si odesílání
zakázal, ho dostane znovu. `mlain doctor` tenhle stav hlásí jako **kritický** pod
označením `missing_key_generations`. Vedle toho hlásí `secret_key_previous_empty`,
a to za tří podmínek naráz: běžíte na jiném pokolení než 1, `SECRET_KEY_PREVIOUS`
je prázdné a v datech nějaké otisky smazaných adres opravdu jsou.

## Po ztrátě klíče

`mlain doctor` ztrátu pozná: najde v datech `key_id`, ke kterému nemá klíč, a
skončí návratovým kódem 2. (Kód 2 vrací u kteréhokoli kritického nálezu, kód 1
jen s přepínačem `--strict`, když jsou nálezy pouze varovné. Strojově čitelný
výpis dá `mlain doctor --json`.)

Jediná oprava je:

1. zadat znovu **přístupy k providerům odesílání** (SMTP, SES a další),
2. zadat znovu **AI klíče**,
3. smířit se s tím, že **trackovací tokeny ze starých kampaní přestanou platit**;
   odkazy v už odeslaných e-mailech skončí na stránce „odkaz vypršel",
4. doplnit chybějící pokolení do `SECRET_KEY_PREVIOUS`, pokud se klíč ještě někde
   najde. Tohle je jediný krok, který ztrátu opravdu vrátí zpět.

Data kontaktů, kampaní ani reportů ztracená nejsou: šifrované jsou jen obálky
přístupů a otisky, ne obsah.
