import { z } from 'zod';

export type DeliverabilityInstallationLimits = {
  DELIVERABILITY_BOUNCE_GUARD_RATE: number;
  DELIVERABILITY_COMPLAINT_GUARD_RATE: number;
  DELIVERABILITY_BOUNCE_WARN_RATE: number;
  DELIVERABILITY_COMPLAINT_WARN_RATE: number;
  DELIVERABILITY_GUARD_MIN_SENT: number;
};

/**
 * Hodnota z konfigurace instalace je zaroven vychozi hodnota I STROP (cast 4a, 3.15.2.1).
 * Projekt smi nastavit prah PRISNEJSI (nizsi), nikdy volnejsi. Tri duvody:
 *  1. Cisla jsou odvozena z hranic Amazonu, ne z naseho odhadu. Volnejsi prah existuje
 *     jen jako zpusob, jak si znicit odesilaci ucet.
 *  2. Brzda chrani odesilaci ucet a ten je v tomhle produktu per projekt.
 *  3. Vypnout brzdu uplne jde jen zmenou instalacni promenne na 0, tedy rozhodnutim
 *     provozovatele, ne uzivatele projektu.
 * U guard_min_sent znamena "prisnejsi" take nizsi cislo: nizsi podlaha znamena,
 * ze brzda zabere driv, tedy s mensim poctem odeslanych zprav.
 */
/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ ZODEM 4. Plán předával `path: [key]`. V zodu 4 se `path`
 * z `refine` PŘIPOJUJE k cestě pole, takže by chyba u `bounce_guard_rate` vyšla jako
 * `['bounce_guard_rate','bounce_guard_rate']`. Ověřeno spuštěním. Cesta na konkrétní
 * klíč, kterou plán požaduje, vznikne sama tím, že je `refine` na tom poli; explicitní
 * `path` se proto vynechává.
 */
function boundedDown(max: number) {
  return z
    .number()
    .min(0)
    .refine((v) => v <= max, {
      message: `Hodnotu lze nastavit nejvýše na ${max}, tedy jen přísněji než instalace.`,
    });
}

export function buildDeliverabilitySettingsSchema(limits: DeliverabilityInstallationLimits) {
  return z
    .object({
      bounce_guard_rate: boundedDown(limits.DELIVERABILITY_BOUNCE_GUARD_RATE).optional(),
      complaint_guard_rate: boundedDown(limits.DELIVERABILITY_COMPLAINT_GUARD_RATE).optional(),
      bounce_warn_rate: boundedDown(limits.DELIVERABILITY_BOUNCE_WARN_RATE).optional(),
      complaint_warn_rate: boundedDown(limits.DELIVERABILITY_COMPLAINT_WARN_RATE).optional(),
      guard_min_sent: z
        .number()
        .int()
        .min(1)
        .refine((v) => v <= limits.DELIVERABILITY_GUARD_MIN_SENT, {
          message: `Podlahu lze nastavit nejvýše na ${limits.DELIVERABILITY_GUARD_MIN_SENT}.`,
        })
        .optional(),
    })
    .strict();
}

export type DeliverabilitySettings = z.infer<ReturnType<typeof buildDeliverabilitySettingsSchema>>;

export type ResolvedGuards = {
  bounceGuardRate: number;
  complaintGuardRate: number;
  bounceWarnRate: number;
  complaintWarnRate: number;
  guardMinSent: number;
  /** Zamerne stejna hodnota jako guardMinSent: podlaha plati na celou tabulku prahu. */
  warnMinSent: number;
};

export function resolveGuards(
  settings: DeliverabilitySettings,
  limits: DeliverabilityInstallationLimits,
): ResolvedGuards {
  const minSent = settings.guard_min_sent ?? limits.DELIVERABILITY_GUARD_MIN_SENT;
  return {
    bounceGuardRate: settings.bounce_guard_rate ?? limits.DELIVERABILITY_BOUNCE_GUARD_RATE,
    complaintGuardRate: settings.complaint_guard_rate ?? limits.DELIVERABILITY_COMPLAINT_GUARD_RATE,
    bounceWarnRate: settings.bounce_warn_rate ?? limits.DELIVERABILITY_BOUNCE_WARN_RATE,
    complaintWarnRate: settings.complaint_warn_rate ?? limits.DELIVERABILITY_COMPLAINT_WARN_RATE,
    guardMinSent: minSent,
    warnMinSent: minSent,
  };
}

/**
 * Undo okno ma strop opacnym smerem nez brzdy a je to schvalne. U brzd je nebezpecna
 * volba volnejsi prah, tady DELSI okno: uzivatel zmackne Odeslat, ceka, ze se odesila,
 * a ono se pet minut nic nedeje. Provozovatel instalace tedy urcuje, jak dlouhe
 * zdrzeni je jeste prijatelne, a projekt si smi okno zkratit nebo vypnout.
 */
export function buildCampaignSettingsSchema(limits: { CAMPAIGN_UNDO_WINDOW_SECONDS: number }) {
  return z
    .object({
      timezone: z.string().min(1).optional(),
      postal_address: z.string().max(500).optional(),
      undo_window_seconds: z
        .number()
        .int()
        .min(0)
        .refine((v) => v <= limits.CAMPAIGN_UNDO_WINDOW_SECONDS, {
          message: `Okno lze zkrátit, ne prodloužit. Strop instalace je ${limits.CAMPAIGN_UNDO_WINDOW_SECONDS} s.`,
        })
        .optional(),
      trial_mode: z.boolean().optional(),
      trial_verified: z
        .array(z.object({ email: z.email(), verified_at: z.iso.datetime().nullable() }))
        .max(10)
        .optional(),
    })
    .strict();
}
