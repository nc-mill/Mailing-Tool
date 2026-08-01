import { z } from 'zod';

/**
 * Jmenný prostor `tracking` ve workspaces.settings.
 *
 * ODCHYLKA OD PLÁNU (stejná jako u domény kontaktů): plán psal, že se schéma
 * „slučuje v packages/db do WorkspaceSettingsSchema". Taková konstanta
 * neexistuje, sloupec `workspaces.settings` je jsonb bez zod schématu a každá
 * doména parsuje jen svou větev. Cizí větve se nechávají být.
 */
export const TrackingSettingsSchema = z
  .object({
    /** Výchozí hodnota campaigns.track_opens u nové kampaně. */
    default_track_opens: z.boolean().default(true),
    /** Výchozí hodnota campaigns.track_clicks u nové kampaně. */
    default_track_clicks: z.boolean().default(true),
    /**
     * Přepínač odečítání automatických otevření od Apple Mail Privacy Protection.
     * Výchozí poloha je ta poctivější, tedy s odečtenými. Rozhodnutí zadavatele.
     * Data se tím nemění, mění se jen pohled v reportu, který vykresluje P14.
     */
    subtract_machine_opens: z.boolean().default(true),
    /** Sbírat webové události. Bez jediné tracking_domains se SDK stejně nespustí. */
    web_tracking_enabled: z.boolean().default(true),
    /**
     * Použít stažené Apple egress rozsahy při klasifikaci otevření.
     * Nikdy se nepoužijí pro webové události, viz 3.3.3.
     */
    use_apple_relay_ranges: z.boolean().default(false),
    /**
     * Ukládat IP adresu do context.ip. Vyžaduje navíc TRACKING_ALLOW_IP_STORAGE
     * na úrovni instalace. Rozhodnutí zadavatele: je to volba provozovatele
     * a jeho zodpovědnost, ne pevné chování produktu.
     */
    store_ip: z.boolean().default(false),
    /** Ukládat zemi odvozenou z IP. Vyžaduje TRACKING_STORE_COUNTRY a GeoIP databázi. */
    store_country: z.boolean().default(false),
    /** Přijmout veřejný klíč i u požadavku bez hlavičky Origin, viz 3.7.5. */
    allow_serverside_public_key: z.boolean().default(false),
  })
  .strict();

export type TrackingSettings = z.infer<typeof TrackingSettingsSchema>;

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = TrackingSettingsSchema.parse({});
