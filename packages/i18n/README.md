# @mlain/i18n

Katalogy jsou rozdělené na soubory po doménách: `messages/{cs,en}/<namespace>.json`.
Za běhu se skládají do jednoho vnořeného stromu, který `next-intl` očekává.

## Kdo co vlastní

| Namespace            | Plán                      |
| -------------------- | ------------------------- |
| `common`             | P05 (tenhle balíček)      |
| `auth`, `settings`   | plán nastavení a přístupů |
| `contacts`           | plán kontaktů             |
| `import`, `segments` | plán importu a segmentů   |
| `editor`             | plán editoru šablon       |
| `campaigns`          | plán kampaní              |
| `reports`            | plán reportů              |
| `ai`                 | plán AI asistenta         |
| `onboarding`         | plán onboardingu          |

Nový namespace se zakládá tak, že vznikne `messages/cs/<namespace>.json`
i `messages/en/<namespace>.json`. Loader je najde sám, kód se nemění.

## Závazná pravidla

1. Klíč se v kódu píše plnou cestou: `t('contacts.count')`. Skládání klíčů
   za běhu je zakázané, protože se nedá staticky ověřit ani extrahovat.
2. Věta se nikdy neskládá z fragmentů. Vždy celá zpráva s parametry.
3. U počtu vždy ICU `plural` včetně kategorie `=0`. Kategorie `many`
   je v češtině pro desetinná čísla a musí být vyplněná.
4. Se změnou čísla se v češtině mění i sloveso, takže `plural`
   je nad celou větou, ne jen nad podstatným jménem.
5. Rod se řeší `select` nad **celou větou**. Neutrální větev je podstatné
   jméno, ne mužský tvar:

   `{gender, select, female {Otevřela kampaň {campaign}} male {Otevřel kampaň {campaign}} other {Otevření kampaně {campaign}}}`

6. Zdroj pravdy pro množinu klíčů je `en`. `cs` musí mít stejné klíče.
7. Znak U+2014 (dlouhá pomlčka) se v katalozích nesmí objevit.
