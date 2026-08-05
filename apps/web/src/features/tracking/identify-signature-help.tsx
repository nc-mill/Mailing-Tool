'use client';

import { useTranslations } from 'next-intl';
import { CopyButton } from '@mlain/ui/components/copy-button';

/**
 * Návod, jak vyrobit podpis pro `Mlain.identify`.
 *
 * PROČ TO TU JE. Server bez podpisu odmítne `identify`, které nese e-mail nebo
 * telefon, a je to správně: kód z prohlížeče vidí každý a kdokoli by jinak
 * podvrhl cizí adresu a unesl cizí kontakt. Jenže dokud nikde nestálo, JAK se
 * ten podpis vyrábí, byla celá funkce nedosažitelná: zákazník ten řetězec
 * neuhodne a chybová hláška mu neřekne nic.
 *
 * HOTOVÝ KÓD, NE POPIS, stejně jako u měřicího úryvku o kus výš. Popis
 * kanonizace by si každý přeložil po svém a rozešel by se na drobnosti, kterou
 * nikdo nevidí: na pořadí klíčů, na mezeře za dvojtečkou, na escapování
 * diakritiky. Výsledek je „podpis nesedí" bez jediné stopy, kde.
 *
 * V PŘÍKLADECH NENÍ SKUTEČNÝ KLÍČ ZÁKAZNÍKA, jen zástupný tvar. Veřejný klíč
 * se ukazuje o kus výš, protože je veřejný; tenhle je privátní a na obrazovku,
 * kterou si někdo vyfotí nebo nasdílí, nepatří.
 */

/**
 * SEKRET SE BERE PODLE TŘETÍHO PODTRŽÍTKA, ne podle posledního.
 *
 * Klíč má tvar `ml_live_<prefix>_<sekret>` a sekret je base64url, takže sám
 * podtržítka OBSAHUJE. Dělení podle posledního podtržítka proto utne jen jeho
 * konec a podpis se nikdy netrefí. Přesně na tom tenhle návod nejdřív padl
 * a odhalilo to až spuštění příkladu proti běžícímu serveru.
 */
const PHP_EXAMPLE = `<?php
// $apiKey je privátní klíč projektu, tvar ml_live_xxxxxxxx_...
// Podepisuje se OTISKEM sekretu, ne sekretem samotným.
// Sekret je čtvrtá část klíče: sám obsahuje podtržítka, takže se nesmí
// oddělovat podle posledního z nich.
$secret = explode('_', $apiKey, 4)[3];
$key = hash('sha256', $secret, true);

$externalId = 'customer_8472';
$traits = ['first_name' => 'Jan', 'email' => 'jan@example.cz'];

// Kanonizace podle RFC 8785: klíče seřazené, žádné mezery, diakritika bez escapování.
ksort($traits);
$jcs = json_encode($traits, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

// Spojovníkem je jeden bajt 0x0A, nikdy \\r\\n.
$mac = hash_hmac('sha256', $externalId . "\\n" . $jcs, $key, true);

// base64url BEZ doplňovacích rovnítek.
$signature = rtrim(strtr(base64_encode($mac), '+/', '-_'), '=');`;

const PYTHON_EXAMPLE = `import base64, hashlib, hmac, json

# api_key je privátní klíč projektu, tvar ml_live_xxxxxxxx_...
# Podepisuje se OTISKEM sekretu, ne sekretem samotným.
# Sekret je čtvrtá část klíče: sám obsahuje podtržítka, takže se nesmí
# oddělovat podle posledního z nich.
secret = api_key.split("_", 3)[3]
key = hashlib.sha256(secret.encode("ascii")).digest()

external_id = "customer_8472"
traits = {"first_name": "Jan", "email": "jan@example.cz"}

# Kanonizace podle RFC 8785: klíče seřazené, žádné mezery, diakritika bez escapování.
jcs = json.dumps(traits, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

# Spojovníkem je jeden bajt 0x0A, nikdy \\r\\n.
mac = hmac.new(key, external_id.encode() + b"\\n" + jcs.encode(), hashlib.sha256).digest()

# base64url BEZ doplňovacích rovnítek.
signature = base64.urlsafe_b64encode(mac).decode().rstrip("=")`;

const BROWSER_EXAMPLE = `// Podpis vyrobí VÁŠ SERVER a pošle ho do stránky. Nikdy ho nepočítejte
// v prohlížeči: musel by tam být privátní klíč a viděl by ho každý.
Mlain.identify(
  'customer_8472',
  { first_name: 'Jan', email: 'jan@example.cz' },
  { signature: podpisZeServeru },
);`;

type Block = { id: string; titleKey: string; code: string };

const BLOCKS: readonly Block[] = [
  { id: 'php', titleKey: 'settings.identify.php', code: PHP_EXAMPLE },
  { id: 'python', titleKey: 'settings.identify.python', code: PYTHON_EXAMPLE },
  { id: 'browser', titleKey: 'settings.identify.browser', code: BROWSER_EXAMPLE },
];

export function IdentifySignatureHelp() {
  const t = useTranslations('tracking');

  return (
    <section aria-labelledby="tracking-identify">
      <h2 id="tracking-identify" className="text-xl font-semibold">
        {t('settings.identify.title')}
      </h2>
      <p className="mt-2 text-text-muted">{t('settings.identify.description')}</p>

      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <dt className="font-medium">{t('settings.identify.unsigned_label')}</dt>
          <dd className="text-text-muted">{t('settings.identify.unsigned_hint')}</dd>
        </div>
        <div>
          <dt className="font-medium">{t('settings.identify.signed_label')}</dt>
          <dd className="text-text-muted">{t('settings.identify.signed_hint')}</dd>
        </div>
      </dl>

      {/* Vzorec zvlášť a doslova. Kdo si podpis píše v Ruby nebo v Go, potřebuje
          přesně tohle, ne převyprávění příkladu v cizím jazyce. */}
      <p className="mt-4 text-sm font-medium">{t('settings.identify.formula_label')}</p>
      <pre className="mt-1 overflow-x-auto rounded-md bg-surface-muted p-4 text-sm">
        <code>
          {'signature = base64url_bez_vyplne(\n' +
            '  HMAC-SHA256( sha256(sekret klíče),\n' +
            '               utf8(external_id) || 0x0A || jcs(traits) ) )'}
        </code>
      </pre>
      <p className="mt-2 text-sm text-text-muted">{t('settings.identify.key_note')}</p>

      {BLOCKS.map((block) => (
        <div key={block.id} className="mt-6">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-sm font-medium">{t(block.titleKey)}</h3>
            <CopyButton
              value={block.code}
              label={t(`settings.identify.copy_${block.id}`)}
              copiedLabel={t('settings.snippet.copied')}
              variant="link"
            />
          </div>
          <pre className="mt-2 overflow-x-auto rounded-md bg-surface-muted p-4 text-sm">
            <code>{block.code}</code>
          </pre>
        </div>
      ))}

      <p className="mt-4 text-sm text-text-muted">{t('settings.identify.ascii_note')}</p>
      <p className="mt-1 text-sm text-text-muted">{t('settings.identify.rejected_note')}</p>
    </section>
  );
}
