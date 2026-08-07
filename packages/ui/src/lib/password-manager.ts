/**
 * Atributy, kterými se poli řekne „tohle není přihlašovací pole, nenabízej sem
 * uložená hesla".
 *
 * PROČ TO TU JE: správci hesel si sami všímají textových polí a nad to, do
 * kterého uživatel klikne, vysunou vlastní nabídku uložených přihlášení. Ta
 * nabídka je součást rozšíření v prohlížeči, takže leží NAD naší stránkou a my
 * ji nijak neodsuneme ani nepřekreslíme. U vyhledávacího pole v paletce
 * (`CommandInput`) tím zakryla první položky seznamu a nešla zavřít: kliknutí
 * mimo ni zavřelo i celou paletku. Vada z provozu, hlášená na Bitwardenu.
 *
 * PROČ JICH JE VÍC NARÁZ: žádná společná značka neexistuje, každý správce si
 * čte tu svoji. Kdo nasadí jen jednu, opraví si vadu u jednoho rozšíření a
 * u ostatních ji nechá být. Zdroje k jednotlivým značkám:
 *   - 1Password: `data-1p-ignore`, `data-op-ignore` je oficiální náhrada pro
 *     nástroje, které nesnesou datový atribut začínající číslicí
 *     (https://www.1password.dev/web/compatible-website-design/)
 *   - LastPass: `data-lpignore`, vyžaduje výslovné `"true"`
 *   - Bitwarden: `data-bwignore`, stačí přítomnost atributu
 *   - Dashlane: `data-form-type="other"` ze specifikace SAWF
 *   - Proton Pass: `data-protonpass-ignore`
 *
 * `autocomplete="off"` mezi nimi schválně NENÍ jako jediná obrana: prohlížeče
 * i správci hesel ho u přihlašovacích polí běžně ignorují, takže sám o sobě
 * nabídku nevypne. Jako doplněk se hodí a `cmdk` si ho na svém poli nastavuje
 * samo; kdo tenhle objekt použije na vlastní pole, ať si `autoComplete="off"`
 * přidá k němu.
 *
 * KDE SE TO NESMÍ POUŽÍT: přihlášení, registrace a změna hesla. Tam je nabídka
 * správce hesel to, co uživatel chce, a vypnout mu ji je škoda, ne oprava.
 */
export const passwordManagerOptOut = {
  'data-1p-ignore': 'true',
  'data-op-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
  'data-protonpass-ignore': 'true',
} as const;
