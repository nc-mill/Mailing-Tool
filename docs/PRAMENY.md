# Prameny: co jsou ty dva textové soubory v `docs/`

Revize: 2026-08-06. Tenhle dokument existuje proto, aby si nikdo nespletl
**historický pramen** se **závazným zadáním**.

## Závazné je tohle

| Co | Kde |
|---|---|
| Specifikace produktu | `docs/superpowers/specs/2026-07-31-mailing-tool-spec.md` a soubory ve `specs/parts/` |
| Implementační plány | `docs/superpowers/plans/` |
| Stav implementace | `docs/superpowers/plans/STAV-IMPLEMENTACE.md` |
| Registr nálezů | `docs/superpowers/plans/NALEZY-NAPRIC-PLANY.md` |

## Prameny, které závazné NEJSOU

### `docs/transcribe.txt`

Přepis **mluveného zadání z počátku projektu** (soubor v repozitáři od
2026-07-31). Je to jeden nezalomený odstavec doslovné řeči, včetně přerušených
vět a myšlenek, které se v další větě mění. Vznikl **před** specifikací a
specifikace z něj vychází.

Číst se dá jako záznam původního záměru. **Nelze z něj citovat požadavky**: co
z něj platí, rozhodla specifikace, a leccos se od té doby rozhodlo jinak
(příklad: název produktu, dnes Mlain Mailer).

### `docs/Reference-konverzace.txt`

Export sdílené konverzace s ChatGPT z počátku projektu (v repozitáři od
2026-07-31, 909 řádků). Je to **rešerše existujících nástrojů** (Listmonk,
Keila, Mautic, phpList, Mailtrain) a úvaha, co by měl vlastní nástroj umět. Text
psal jazykový model, ne zadavatel, takže **žádné jeho tvrzení není ověřený fakt
o cizích produktech** a rozhodně to není rozhodnutí o tomhle produktu.

## Proč se to nemaže

Obojí je záznam toho, jak zadání vzniklo, a spec se na ně výslovně odvolává.
Mazat prameny, ze kterých se odvozovalo rozhodnutí, znamená zahodit možnost
zpětně zjistit proč. Oba soubory proto zůstávají beze změny obsahu; přibyla
v nich jen hlavička s odkazem sem.

Obsahují navíc **starý pracovní název produktu**. Je to jediná povolená výjimka
z pravidla „nikde není starý název", viz `docs/superpowers/specs/parts/STAV.md`.
