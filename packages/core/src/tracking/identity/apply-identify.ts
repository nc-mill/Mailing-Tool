import { writeContact } from '../../contacts/repo/contacts';
import type { WorkspaceContext } from '../../tx';
import { trackingLogger } from '../logging';
import { findContactByExternalId, readIdentifySigningSecrets } from '../repo/identify.repo';
import { bindIdentity, type BindOutcome } from './bind';
import { hasPiiTraits, verifyIdentifySignature } from './signature';

/**
 * Promítnutí `identify` z web SDK na kontakt, viz plán P10 Task 28
 * a specifikace 3.6.3.
 *
 * Do téhle práce server podpis NEOVĚŘOVAL a `traits` nikam nepromítal: událost
 * `identify` se uložila jako obyčejná webová událost a tím to skončilo. SDK
 * přitom bez serverového podpisu odmítne e-mail vůbec odeslat, takže ochrana
 * existovala jen v prohlížeči, tedy tam, kde ji kdokoli obejde.
 *
 * DVA REŽIMY podle tabulky v 3.6.3:
 *
 * | Režim | Co přijde | Co server udělá |
 * |---|---|---|
 * | Nepodepsaný | `external_id` a traits BEZ `email` a `phone` | Najde kontakt podle `contacts.external_id`. Nikdy nezaloží nový a nikdy nezmění e-mail |
 * | Podepsaný | navíc `signature` | Ověří podpis a povolí i zápis e-mailu a založení kontaktu |
 *
 * Běží ve WORKERU, ne v odpovědi na `/e/track`. Ověření podpisu potřebuje klíče
 * z databáze a příjem událostí má odpovídat v desítkách milisekund.
 */

export type IdentifyPayload = {
  externalId: string;
  traits: Record<string, unknown>;
  signature?: string | null | undefined;
};

export type ApplyIdentifyOutcome =
  /** Traits s osobním údajem bez podpisu. Nesmí se stát, příjem to odmítá dřív. */
  | 'unsigned_pii'
  /** Podpis nesedí na žádný platný klíč projektu. Nezapíše se NIC. */
  | 'signature_invalid'
  /** Nepodepsané `identify` na identifikátor, který v projektu není. */
  | 'contact_not_found'
  /** Kontakt je na suppression listu z důvodu, který zápis zakazuje. */
  | 'suppressed'
  | 'applied';

export type ApplyIdentifyResult = {
  outcome: ApplyIdentifyOutcome;
  contactId: string | null;
  /** Výsledek vazby anonymního ID na kontakt, když se vazba dělala. */
  bind: BindOutcome | null;
};

export type ApplyIdentifyInput = {
  /**
   * Rozsah jako KONTEXT, ne jako řetězec. Volání sahá na kontakty a na klíče
   * projektu, takže kdyby se rozhodovalo podle holého identifikátoru, dala by
   * se podvržením hodnoty přepsat cizí databáze. Hlídá `identity/scope.test.ts`.
   */
  ctx: WorkspaceContext;
  anonymousId: string | null;
  payload: IdentifyPayload;
  now: Date;
  /** Testy si sem podstrčí špióny místo databáze. */
  deps?: {
    readSecrets?: (ctx: WorkspaceContext) => Promise<Buffer[]>;
    findByExternalId?: (
      ctx: WorkspaceContext,
      externalId: string,
    ) => Promise<{ id: string; email: string } | null>;
    write?: typeof writeContact;
    bind?: typeof bindIdentity;
  };
};

/**
 * Traits, které mají v `contacts` vlastní sloupec. Zbytek jde do `attributes`.
 *
 * `email` v seznamu ZÁMĚRNĚ NENÍ: zachází se s ním zvlášť, protože ho smí
 * zapsat jen podepsané volání a protože je to zároveň klíč, podle kterého se
 * kontakt páruje.
 */
const NAME_TRAITS = new Set(['first_name', 'last_name', 'full_name', 'name', 'locale']);

function textTrait(traits: Record<string, unknown>, key: string): string | null {
  const value = traits[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Zbytek traits, tedy to, co půjde do `attributes`.
 *
 * Osobní údaje se odsud NEFILTRUJÍ a je to správně: nepodepsané volání
 * s osobním údajem skončí o kus níž jako celek kódem `unsigned_pii`, takže sem
 * s telefonem dojde jedině podepsané. Filtr navíc by byl mrtvý kód, který
 * tvrdí něco, co se nikdy nestane.
 */
function attributeTraits(traits: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(traits)) {
    const lower = key.toLowerCase();
    if (lower === 'email' || NAME_TRAITS.has(lower)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Ověří podpis proti VŠEM platným klíčům projektu.
 *
 * Projektů s víc než hrstkou klíčů není a porovnání je jedno HMAC, takže je to
 * levné. Zkoušet jen jeden klíč by znamenalo, že po vydání druhého klíče přestane
 * podepisování fungovat tomu, kdo má ten starší, a nikde by nebylo vidět proč.
 */
function signatureMatches(
  secrets: readonly Buffer[],
  payload: IdentifyPayload,
  signature: string,
): boolean {
  let matched = false;
  for (const secret of secrets) {
    // Bez zkratky `break`: počet porovnání pak nezávisí na tom, který klíč sedl.
    if (
      verifyIdentifySignature({
        externalId: payload.externalId,
        traits: payload.traits,
        signature,
        secret,
      })
    ) {
      matched = true;
    }
  }
  return matched;
}

export async function applyIdentify(input: ApplyIdentifyInput): Promise<ApplyIdentifyResult> {
  const readSecrets = input.deps?.readSecrets ?? readIdentifySigningSecrets;
  const findByExternalId = input.deps?.findByExternalId ?? findContactByExternalId;
  const write = input.deps?.write ?? writeContact;
  const bind = input.deps?.bind ?? bindIdentity;

  const { ctx, payload } = input;
  const signature = payload.signature ?? null;
  const traits = payload.traits;

  // 1. Nepodepsané osobní údaje. Příjem je odmítá dřív, tohle je druhá závora
  // pro cesty, které by příjem obešly (import jobu, budoucí serverové volání).
  if (signature === null && hasPiiTraits(traits)) {
    return { outcome: 'unsigned_pii', contactId: null, bind: null };
  }

  // 2. Ověření podpisu. Neplatný podpis nezapíše NIC, ani ty traits, které by
  // směly projít i bez něj: podepsané volání, kterému podpis nesedí, je pokus
  // o podvrh, ne nepodepsané volání.
  let signed = false;
  if (signature !== null) {
    let valid = false;
    try {
      valid = signatureMatches(await readSecrets(ctx), payload, signature);
    } catch (error) {
      // `external_id` s bajtem 0x0A skončí výjimkou, viz `signature.ts`.
      trackingLogger().warn(
        { err: error, workspaceId: ctx.workspaceId },
        'tracking_identify_signature_error',
      );
      valid = false;
    }
    if (!valid) return { outcome: 'signature_invalid', contactId: null, bind: null };
    signed = true;
  }

  // 3. Spárování kontaktu
  const existing = await findByExternalId(ctx, payload.externalId);
  const email = signed ? textTrait(traits, 'email') : null;
  const targetEmail = existing?.email ?? email;

  if (targetEmail === null) {
    // Nepodepsané volání na neznámý identifikátor a podepsané bez e-mailu.
    // Ani jedno nesmí kontakt založit: bez adresy by vznikl kontakt, kterému
    // nejde nic poslat, a šlo by jich takhle nasypat kolik kdo chce.
    return { outcome: 'contact_not_found', contactId: null, bind: null };
  }

  // 4. Zápis. Jde přes `writeContact`, ne vlastním UPDATE, protože to je jediné
  // místo, které drží všech šest pravidel zápisu kontaktu ze 4.1.2 části 2
  // (suppression, zamknuté stavy, dopočet oslovení a 5. pádu).
  const fullName = textTrait(traits, 'full_name') ?? textTrait(traits, 'name');
  const locale = textTrait(traits, 'locale');
  const attributes = attributeTraits(traits);

  const result = await write(ctx, {
    // Podepsané volání smí e-mail změnit, nepodepsané ho jen zopakuje.
    email: signed && email !== null ? email : targetEmail,
    firstName: textTrait(traits, 'first_name'),
    lastName: textTrait(traits, 'last_name'),
    ...(fullName === null ? {} : { fullName }),
    ...(locale === null ? {} : { locale }),
    externalId: payload.externalId,
    attributes,
    source: 'api',
    sourceRef: 'sdk_identify',
    // `update`, ne `overwrite`: traits, které volání neposlalo, se nemají mazat.
    mode: 'update',
  });

  if (result.rejected === 'suppressed' || result.id === null) {
    return { outcome: 'suppressed', contactId: null, bind: null };
  }

  // 5. Vazba prohlížeče na kontakt. Bez ní by se traits zapsaly, ale dosavadní
  // anonymní historie by ke kontaktu nikdy nepřipadla.
  let bindOutcome: BindOutcome | null = null;
  if (input.anonymousId !== null) {
    bindOutcome = await bind({
      workspaceId: ctx.workspaceId,
      anonymousId: input.anonymousId,
      contactId: result.id,
      source: 'sdk_identify',
      evidence: { external_id: payload.externalId, signed },
      now: input.now,
    });
  }

  return { outcome: 'applied', contactId: result.id, bind: bindOutcome };
}
