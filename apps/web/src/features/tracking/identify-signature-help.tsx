'use client';

import { useTranslations } from 'next-intl';
import { CardTitle } from '@mlain/ui/components/card';
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
 * PŘÍKLADY JSOU ANGLICKY VE VŠECH JAZYCÍCH ROZHRANÍ, a je to oprava, ne
 * nedodělek. Do 7. 8. 2026 byly komentáře v nich česky a nebylo je z čeho
 * přeložit: v katalozích leží okolní text, ale samotné bloky kódu ne. Anglická
 * obrazovka tedy měla přeložené nadpisy a pod nimi tři české bloky, tedy
 * přesně tu část, kvůli které sem zákazník chodí. Odhalila to teprve prohlídka
 * obrazovky v angličtině; katalog přitom seděl.
 *
 * Do katalogů se bloky nepřesouvaly schválně. Kód, který se má zkopírovat
 * a spustit, musí být v obou jazycích ZNAKU PO ZNAKU týž: kdo ho vloží do
 * hlášení chyby, jinak pošle jiný text podle toho, jaký měl zapnutý jazyk,
 * a překlep v podepisovaném řetězci vznikne v překladu. Anglické komentáře
 * navíc odpovídají pravidlu projektu, že kód a identifikátory jsou anglicky.
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
// $apiKey is the workspace private key, shaped ml_live_xxxxxxxx_...
// You sign with the HASH of the secret, not with the secret itself.
// The secret is the fourth part of the key: it contains underscores itself,
// so never split on the last one.
$secret = explode('_', $apiKey, 4)[3];
$key = hash('sha256', $secret, true);

$externalId = 'customer_8472';
$traits = ['first_name' => 'Jan', 'email' => 'jan@example.cz'];

// Canonicalization per RFC 8785: sorted keys, no whitespace, no escaping of non-ASCII.
ksort($traits);
$jcs = json_encode($traits, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

// The separator is a single 0x0A byte, never \\r\\n.
$mac = hash_hmac('sha256', $externalId . "\\n" . $jcs, $key, true);

// base64url WITHOUT padding.
$signature = rtrim(strtr(base64_encode($mac), '+/', '-_'), '=');`;

const PYTHON_EXAMPLE = `import base64, hashlib, hmac, json

# api_key is the workspace private key, shaped ml_live_xxxxxxxx_...
# You sign with the HASH of the secret, not with the secret itself.
# The secret is the fourth part of the key: it contains underscores itself,
# so never split on the last one.
secret = api_key.split("_", 3)[3]
key = hashlib.sha256(secret.encode("ascii")).digest()

external_id = "customer_8472"
traits = {"first_name": "Jan", "email": "jan@example.cz"}

# Canonicalization per RFC 8785: sorted keys, no whitespace, no escaping of non-ASCII.
jcs = json.dumps(traits, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

# The separator is a single 0x0A byte, never \\r\\n.
mac = hmac.new(key, external_id.encode() + b"\\n" + jcs.encode(), hashlib.sha256).digest()

# base64url WITHOUT padding.
signature = base64.urlsafe_b64encode(mac).decode().rstrip("=")`;

const BROWSER_EXAMPLE = `// YOUR SERVER produces the signature and passes it into the page. Never compute
// it in the browser: the private key would have to be there and anyone could read it.
Mlain.identify(
  'customer_8472',
  { first_name: 'Jan', email: 'jan@example.cz' },
  { signature: signatureFromServer },
);`;

/**
 * Vzorec je záměrně bez češtiny, ze stejného důvodu jako bloky kódu. Zápis
 * odpovídá doslova komentáři u `verifyIdentifySignature` v `packages/core`,
 * takže se dá porovnat se zdrojem, který podpis ověřuje.
 */
const FORMULA =
  'signature = base64url_nopad(\n' +
  '  HMAC-SHA256( sha256(key secret),\n' +
  '               utf8(external_id) || 0x0A || jcs(traits) ) )';

type Block = { id: string; titleKey: string; code: string };

const BLOCKS: readonly Block[] = [
  { id: 'php', titleKey: 'settings.identify.php', code: PHP_EXAMPLE },
  { id: 'python', titleKey: 'settings.identify.python', code: PYTHON_EXAMPLE },
  { id: 'browser', titleKey: 'settings.identify.browser', code: BROWSER_EXAMPLE },
];

export function IdentifySignatureHelp() {
  const t = useTranslations('tracking');

  return (
    <section
      aria-labelledby="tracking-identify"
      className="flex flex-col gap-[var(--spacing-gutter)]"
    >
      <CardTitle>
        <span id="tracking-identify">{t('settings.identify.title')}</span>
      </CardTitle>
      <p className="text-meta text-text-muted">{t('settings.identify.description')}</p>

      <dl className="flex flex-col gap-[var(--spacing-hairline)] text-ui">
        <div>
          <dt className="text-ui font-semibold text-text">
            {t('settings.identify.unsigned_label')}
          </dt>
          <dd className="text-text-muted">{t('settings.identify.unsigned_hint')}</dd>
        </div>
        <div>
          <dt className="text-ui font-semibold text-text">{t('settings.identify.signed_label')}</dt>
          <dd className="text-text-muted">{t('settings.identify.signed_hint')}</dd>
        </div>
      </dl>

      {/* Vzorec zvlášť a doslova. Kdo si podpis píše v Ruby nebo v Go, potřebuje
          přesně tohle, ne převyprávění příkladu v cizím jazyce. */}
      <p className="mt-[var(--spacing-stack)] text-sm font-semibold text-text">
        {t('settings.identify.formula_label')}
      </p>
      <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-surface-muted p-[var(--spacing-gutter)] font-mono text-meta">
        <code>{FORMULA}</code>
      </pre>
      <p className="text-meta text-text-muted">{t('settings.identify.key_note')}</p>

      {BLOCKS.map((block) => (
        <div key={block.id} className="mt-[var(--spacing-gutter)]">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-sm font-semibold text-text">{t(block.titleKey)}</h3>
            <CopyButton
              value={block.code}
              label={t(`settings.identify.copy_${block.id}`)}
              copiedLabel={t('settings.snippet.copied')}
              variant="link"
            />
          </div>
          <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-surface-muted p-[var(--spacing-gutter)] font-mono text-meta">
            <code>{block.code}</code>
          </pre>
        </div>
      ))}

      <p className="text-meta text-text-muted">{t('settings.identify.ascii_note')}</p>
      <p className="text-meta text-text-muted">{t('settings.identify.rejected_note')}</p>
    </section>
  );
}
