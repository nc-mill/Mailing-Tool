# Volné .com domény pro projekt

Datum ověření: 2026-07-31
Projekt: open-source self-hosted e-mailingová a customer engagement platforma (pracovní název OpenEngage)

## Jak to bylo ověřeno

Prověřeno zhruba 410 kandidátů, z toho 180 se slovem „send". Každá doména uvedená níže prošla **dvěma nezávislými kontrolami**:

1. Vercel Domains API (`check_domain_availability_and_price`), které vrací dostupnost i cenu
2. Verisign RDAP (`https://rdap.verisign.com/com/v1/domain/<doména>`), autoritativní registr pro .com, odpověď HTTP 404 znamená neregistrováno

Cena u všech volných domén: **11,25 USD za první rok** (Vercel). U jiného registrátora se bude lišit, dostupnost ne.

Kolize s existujícími produkty byly dohledány přes webové vyhledávání, výsledky jsou v sekci [Zamítnuto](#zamítnuto-přes-volnou-doménu).

Zadání se v průběhu upřesnilo na: **anglický název, ze kterého je jasné, že jde o otevřený e-mailový nástroj, slovo „open" povolené.** Sekce jsou seřazené podle souladu s tímto zadáním.

---

## Doporučení

### openmailhouse.com

**OpenMailhouse.** *Open* nese otevřenost zdroje, *mailhouse* je zavedený oborový termín pro provozovnu, která rozesílá hromadnou poštu. Přesně to ten nástroj je, jen si ho hostuješ sám.

- anglické, vyslovitelné i pro českého mluvčího, bez zkratek a překlepů
- `github.com/openmailhouse` volné (HTTP 404, ověřeno 2026-07-31)
- rešerše neodhalila žádný **softwarový** brand toho jména, „mail house" používají tiskové a direct mail firmy jako obecný termín
- funguje technicky: repo `openmailhouse`, image `openmailhouse/app`, CLI `omh`

### Náhradníci

Všechny mají volný i GitHub handle (ověřeno HTTP 404).

| Doména | Čte se jako | Kdy ji zvolit |
|---|---|---|
| openmailyard.com | Open Mailyard | neformálnější, „dílenský" tón blíž ke komunitě |
| openemailstack.com | Open Email Stack | maximální jasnost pro vývojáře, „tvůj vlastní e-mailový stack" |
| openmailbase.com | OpenMailbase | vyznění platformy nebo backendu ve stylu Supabase |
| openmailhq.com | OpenMail HQ | nejkratší varianta, ale brand je fakticky jen „OpenMail" |
| opensendhouse.com | Open Send House | nejlepší varianta se slovem „send" |
| sendopenly.com | Send openly | čte se jako věta, obsahuje send i open, ale neříká přímo e-mail |
| sendrune.com | SendRune | nejkratší rozumný nález, osm znaků, runa je vyrytá zpráva |

---

## Všechny volné domény podle skupin

### Skupina „open + mail"

| Doména | Poznámka |
|---|---|
| openmailhouse.com | doporučeno, viz výše |
| openmailyard.com | náhradník |
| openmailhq.com | náhradník |
| openmailbase.com | náhradník |
| openmailengine.com | jasné, ale zní jako komponenta, ne celý produkt |
| openmaillab.com | „lab" evokuje experiment, ne produkční infrastrukturu |
| openmailtool.com | doslovné, ale „tool" je slabý brand |
| openmailflow.com | „mail flow" je terminologie Exchange, mírné riziko záměny |
| openmailmarketing.com | nejjasnější k oboru, ale dlouhé a generické |
| openmailpost.com | redundantní, mail i post znamenají totéž |
| openmailcast.com | „cast" evokuje broadcast, ucházející |
| openmailwave.com | neutrální, bez silné vazby na obor |
| openmailcamp.com | volné, ale významově nejasné |
| openmailship.com | volné, čte se nešikovně |
| openmailloop.com | „Loops" je konkurenční brand, riziko záměny |
| openmailkitchen.com | volné, hravé, ale dlouhé |
| openmailry.com | volné, ale nečitelné, není jasné jak to vyslovit |
| openmailkit.com | **nedoporučeno**, viz Zamítnuto |
| openmailcore.com | **nedoporučeno**, viz Zamítnuto |
| openmailsuite.com | **nedoporučeno**, viz Zamítnuto |
| openmailstudio.com | **nedoporučeno**, viz Zamítnuto |
| openmailforge.com | **nedoporučeno**, viz Zamítnuto |
| openmailpilot.com | **nedoporučeno**, viz Zamítnuto |

### Skupina „open + email"

Delší, zato bez jakékoli nejednoznačnosti, „mail" totiž může znamenat i listovní poštu.

| Doména | Poznámka |
|---|---|
| openemailstack.com | náhradník, doporučeno z této skupiny |
| openemailplatform.com | nejjasnější, zato nejnudnější |
| openemailhq.com | protějšek openmailhq.com |
| openemailengine.com | protějšek openmailengine.com |
| openemailtool.com | doslovné |
| openemailkit.com | **nedoporučeno**, kolize MailKit |
| openemailcore.com | **nedoporučeno**, kolize MailCore |
| openemailsuite.com | **nedoporučeno**, kolize Mailsuite |
| openemailstudio.com | **nedoporučeno**, kolize Mail Studio |

### Skupina se slovem „send"

Samotné `send` plus běžné slovo je vytěženo úplně: z třiceti kombinací typu sendbase, sendcore, sendstack, sendhq, sendforge, sendhub, sendroom, sendport prošla volná jediná (sendbarn.com). Prostor se otevírá teprve ve spojení s „open".

#### open + send

| Doména | Poznámka |
|---|---|
| opensendhouse.com | nejsilnější z této skupiny, přímý protějšek openmailhouse.com, GitHub handle volný |
| opensendengine.com | sedí na architekturu projektu, odesílací engine je samostatná Go binárka, GitHub handle volný |
| opensendyard.com | neformální tón, GitHub handle volný |
| opensendworks.com | zní jako „provozovna", GitHub handle volný |
| opensendlab.com | GitHub handle volný |
| opensendhub.com | |
| opensendbox.com | |
| opensendforge.com | „forge" má silnou open-source konotaci, SourceForge a podobné |
| opensendtool.com | doslovné |
| opensendtools.com | množné číslo téhož |
| opensendapp.com | |
| opensendspace.com | |
| opensendsource.com | zdvojuje myšlenku open source, dlouhé |
| opensendplatform.com | jasné, ale generické |
| opensendsuite.com | pozor, „suite" koliduje s Mailsuite |
| opensendmarketing.com | nejjasnější k oboru, zato dlouhé |
| opensendmailer.com | |
| opensendmailhouse.com | příliš dlouhé, tři slova za sebou |
| opensendhouseapp.com | totéž |
| opensendpost.com | |
| opensendletter.com | |
| opensendcast.com | |
| opensendcamp.com | |
| opensendwave.com | |
| opensendloop.com | „Loops" je konkurenční brand, riziko záměny |
| opensendstudio.com | **nedoporučeno**, viz Zamítnuto |
| opensendmailkit.com | **nedoporučeno**, kolize MailKit |

#### open + sender

Brand by fakticky zněl „OpenSender". Mírné riziko: **Sender.net** je velká e-mail marketingová platforma.

| Doména | Poznámka |
|---|---|
| opensenderhq.com | nejčistší z této podskupiny, GitHub handle volný |
| opensenderkit.com | pozor, kolize MailKit i vzor jména |
| opensenderlab.com | |
| opensenderhouse.com | |
| opensenderforge.com | |
| opensenderstack.com | |

#### krátké se „send", bez „open"

Cílené hledání na délku. Prověřeno 80 krátkých vzorů: `send` plus tří- až pětipísmenné slovo, obrácené pořadí (baysend, foxsend, websend), jedno písmeno plus send (xsend, zsend, esend), koncovky (sendo, sendi, sendly, sendio, sendex, sendix). **Všech dvacet jednoslabičných koncovek i všech deset variant písmeno plus send je obsazených.** Volné zůstalo tohle, seřazeno podle použitelnosti.

Pozor na kompromis: „send" nese sdělení „odesílá", ale ani open, ani email v názvu nezazní. Za jasnost se tady platí délkou.

| Doména | Délka | Význam | Poznámka |
|---|---|---|---|
| sendrune.com | 8 | runa je vyrytá zpráva | nejlepší poměr délky a významu, česky i anglicky se čte stejně, GitHub handle volný |
| sendfern.com | 8 | kapradina | nejsnazší na výslovnost i diktování do telefonu, význam ale náhodný, GitHub handle volný |
| sendlamp.com | 8 | lampa, světlo, signál | GitHub handle volný |
| sendquay.com | 8 | nábřeží, místo odbavení | významově sedí, ale anglicky se čte „kee", česky jinak |
| sendhorn.com | 8 | roh, svolávací signál | GitHub handle volný |
| sendtorch.com | 9 | pochodeň, signál | GitHub handle volný |
| sendflag.com | 8 | signální vlajka | GitHub handle volný, ale ve vývojářském světě „flag" znamená příznak, může mást |
| sendreef.com | 8 | útes | snadné, ale útes je to, na čem lodě ztroskotají |
| sendreed.com | 8 | rákos, rákosové pero | plete se se slovem „read" |
| senddune.com | 8 | duna | |
| sendmoor.com | 8 | vřesoviště, „to moor" znamená zakotvit | |
| sendkiln.com | 8 | pec | „kiln" je pro Čecha těžké na výslovnost |
| sendcliff.com | 9 | útes | |
| sendbarn.com | 8 | stodola | |
| sendelm.com | 7 | jilm | nejkratší nález, ale „sendelm" se čte nejednoznačně |
| senddart.com | 8 | šipka, rychlé doručení | **nedoporučeno**, Dart je programovací jazyk, kolize ve vývojářském prostoru |

Dvě varianty se slovem „libre", které nese otevřenost bez slova open: **libremailer.com** a **libresender.com**. Delší, zato srozumitelné napříč jazyky.

#### send bez „open"

| Doména | Poznámka |
|---|---|
| sendopenly.com | „Send openly." Krátké, čte se jako věta, obsahuje send i open. GitHub handle volný. Slabina: neříká přímo, že jde o e-mail. |
| sendopensource.com | jasné, ale dlouhé a těžkopádné |
| sendaudience.com | míří na publikum, ne na otevřenost |
| sendmailhouse.com | „send" a „mailhouse" významově zdvojuje totéž |
| sendbarn.com | jediná volná krátká kombinace send plus podstatné jméno, ale „barn" je stodola, významově náhodné |
| sendmailkit.com | **nedoporučeno**, kolize MailKit |

### Skupina „herald, courier, carrier"

Neobsahují slovo open ani mail, takže neplní upřesněné zadání. Ponecháno pro případ změny směru.

| Doména | Poznámka |
|---|---|
| heraldcore.com | herald = ohlašovatel, posel zpráv |
| heraldstack.com | |
| heraldkit.com | |
| heraldbase.com | |
| heralddeck.com | |
| heraldforge.com | riziko: existuje Mailforge (cold e-mail infrastruktura) |
| heraldyard.com | riziko: existuje Emailyard, stejný vzor jména v témže oboru |
| courierforge.com | riziko: Courier je zavedený brand v messagingu (trycourier.com) |
| courieryard.com | stejné riziko jako výše |
| carrieryard.com | vyšší riziko: MailCarry je self-hosted e-mail marketing, blízké pozicování |

Pozn.: u všech „herald" variant je drobné riziko, existuje menší nástroj **Maily Herald**.

### Ostatní volné nálezy mimo zadání

Metaforické a obrazné názvy z dřívější fáze hledání. Neříkají, že jde o otevřený e-mailový nástroj, takže **neplní zadání**. Uvedeno jen pro úplnost, ať se práce neztratí.

| Doména | Obraz | Riziko |
|---|---|---|
| sendquay.com | quay = nábřeží, místo odbavení | výslovnost, anglicky „kee", česky se čte jinak |
| postquay.com | totéž | totéž |
| sendhearth.com | hearth = krb, domov | výslovnost „harth" |
| posthearth.com | totéž | totéž |
| sendfern.com | fern = kapradina | krátké a snadné, ale významově náhodné |
| sendlantern.com | lantern = signál, maják | dlouhé, zato dobře vyslovitelné |
| postorchard.com | orchard = sad, pěstování publika | „orchard" je pro Čechy těžké na výslovnost |
| postwillow.com | willow = vrba | |
| sendclover.com | clover = jetel | |
| sendthicket.com | thicket = houští | negativní konotace, zapletené |
| enveline.com | envelope + line | |
| letterfern.com | letter + fern | |
| swallowpost.com | vlaštovka, posel dobrých zpráv | v angličtině „swallow" znamená i polknout |
| swallowtide.com | migrace vlaštovek | abstraktní |
| soarpost.com | soar = stoupat | podobné SoPost, britská firma |
| chimepost.com | chime = zvon, signál | Chime je velký americký fintech |
| starlingwing.com | špačci, hejno | Starling Bank |
| currentwing.com | proud a křídlo | |
| wingdove.com | holubice, klasický posel | Dove je značka Unileveru |
| waxdove.com | pečetní vosk a holubice | totéž |
| tidedove.com | | dvě velké spotřební značky naráz, Tide i Dove |

---

## Zamítnuto přes volnou doménu

Doména volná byla, ale jméno by kolidovalo s existujícím produktem ve stejném nebo sousedním oboru.

| Doména | Důvod zamítnutí |
|---|---|
| openmailkit.com, openemailkit.com | **MailKit** je zavedená .NET knihovna pro IMAP, POP3 a SMTP, a zároveň **MailKit s.r.o.** je česká ESP firma. Dvojitá kolize, pro českého autora obzvlášť nešikovná. |
| openmailsuite.com, openemailsuite.com | **Mailsuite** (dříve Mailtrack) je živý produkt se dvěma miliony uživatelů. |
| openmailstudio.com, openemailstudio.com | „Mail Studio" je přeplněné: mailstudio.app, mailstudio.nl i mailstudio.dev jsou e-mailové template buildery. |
| openmailforge.com | **mailforge.ai** působí v cold e-mailu, tedy v sousedním oboru. |
| openmailcore.com, openemailcore.com | **MailCore** je známá mailová knihovna. |
| openmailpilot.com | **Mail Pilot** je existující e-mailová aplikace pro macOS. |
| opensendstudio.com | **SendStudio** (sendstudio.co) i **The Send Studio** působí v e-mail marketingu. |
| opensendmailkit.com, sendmailkit.com, opensenderkit.com | tatáž kolize MailKit jako výše. |
| opensendsuite.com | tatáž kolize Mailsuite jako výše. |

## Obsazené domény, které stojí za zmínku

Pracovní název **openengage.com** je obsazený. Dále obsazeno: opensend, openpost, opensender, opencampaign, opencampaigns, openoutreach, openbroadcast, opendispatch, opencourier, openherald, openaudience, openmailer, openmail, openemail, openmailing, openmailstack, openmailhub, openmailapp, openmails, openmailworks, openmailbox, opennewsletter, opensourcemail, mailopen, opendrip, openblast, openemailmarketing, openmailplatform.

Ze skupiny se slovem send obsazeno: opensend, opensender, opensendkit, opensendcore, opensendbase, opensendstack, opensendhq, opensendmail, opensendly, opensendlabs, opensendflow, sendopen, sendbase, sendcore, sendstack, sendhq, sendengine, sendlab, sendtool, sendhouse, sendkit, senddeck, sendforge, sendhub, sendstudio, sendsuite, sendplatform, sendroom, sendport, sendpier, sendmill, sendsmith, sendcrew, sendcamp, sendnest, sendloft, sendvault, sendanchor, sendwright, sendmast, sendden, sendwise, sendfreely, sendsource, sendletters, sendlists, senderforge, senderyard, senderhouse, senderhq, sendercore, senderlab, sendloop, sendworks, sendcraft, sendyard, sendkeep, sendquill, sendwarden, sendera, sendilo, sendejo, sendery.

Krátké jednoslovné .com jsou v tomhle oboru prakticky vytěžené. Z osmdesáti kombinací typu mail, send nebo post plus běžné slovo prošly volné jen čtyři. Šestipísmenné vymyšlené názvy typu envolo, mittera, sendilo jsou obsazené do jednoho.

---

## Stav

Nic není koupeno. Ceny a dostupnost platí k 2026-07-31 a mohou se kdykoli změnit, doména se dá zaregistrovat kýmkoli jiným během minut.
