import { createHash } from 'node:crypto';

/**
 * Důkaz o udělení souhlasu. Ukládá se do consents.evidence jako otevřený jsonb,
 * protože sada polí se liší podle kanálu a přidání dalšího nesmí vyžadovat migraci.
 */
export type ConsentEvidence = {
  ip?: string | null;
  user_agent?: string;
  page_url?: string;
  form_id?: string;
  /**
   * SHA-256 přesného znění zaškrtávátka, které člověk viděl, v hex.
   *
   * Dřívější znění tady mělo `form_version?: number` a plnilo ho z `form.version`.
   * Sloupec `forms.version` ve schématu NENÍ, takže by hodnota byla v TypeScriptu
   * `undefined`, v JSON by zmizela a evidence by se uložila neúplná, aniž by cokoli
   * selhalo. Otisk znění je navíc lepší důkaz než pořadové číslo: doloží, co přesně
   * bylo napsané, ne kolikátá to byla úprava, a nepotřebuje ke svému vzniku migraci.
   */
  consent_text_sha256?: string;
  /** Doslovné znění, pokud se vejde do limitu. Otisk zůstává vždy. */
  consent_text?: string;
  double_opt_in_at?: string;
  confirmation_ip?: string | null;
  import_id?: string;
  /**
   * Volný popis původu souhlasu od uživatele nástroje („veletrh Brno 2026",
   * „objednávkový formulář e-shopu").
   *
   * NENÍ to `consents.source`. Ten sloupec má omezení `ck_consents__source` s pevným
   * číselníkem kanálů (`import`, `form`, `api`, …) a volný text by ho shodil na 23514,
   * tedy pádem celé dávky importu. Kanál tedy zůstává ve sloupci a tvrzení uživatele
   * o tom, odkud souhlas doopravdy pochází, se ukládá sem, kde je doložitelné.
   */
  declared_source?: string;
  /** Prohlášení uživatele nástroje o doloženém souhlasu, typicky u importu. */
  declaration?: boolean;
};

/** Maximální délka doslovného znění v evidenci. Delší text se doloží jen otiskem. */
const CONSENT_TEXT_EVIDENCE_LIMIT = 2000;

/**
 * Důkaz o znění zaškrtávátka. Vrací otisk vždy a doslovné znění, když se vejde.
 *
 * Otisk je počítaný nad NORMALIZOVANÝM textem (NFC, sjednocené bílé znaky), aby se
 * dvě vizuálně totožná znění nelišila jen kvůli tomu, že jedno přišlo z editoru
 * s nezlomitelnou mezerou. Bez normalizace by otisk hlásil změnu tam, kde žádná není.
 */
export function consentTextEvidence(text: string | null | undefined): {
  consent_text_sha256?: string;
  consent_text?: string;
} {
  if (text === null || text === undefined || text.trim() === '') return {};
  const normalized = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  const hash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return normalized.length <= CONSENT_TEXT_EVIDENCE_LIMIT
    ? { consent_text_sha256: hash, consent_text: normalized }
    : { consent_text_sha256: hash };
}

export type EvidenceInput = ConsentEvidence & {
  /** Ukládat IP? Čte se z workspaces.settings.privacy.store_ip, výchozí false. */
  storeIp: boolean;
};

/**
 * Sestaví důkaz s ohledem na to, jestli si provozovatel přeje ukládat IP adresy.
 *
 * Rozhodnutí zadavatele: ukládání IP je volba provozovatele, ne naše, protože správcem
 * osobních údajů je on. Ve výchozím stavu je vypnuté.
 *
 * Když je vypnuté, vynechá se JEN IP. Zbytek důkazu (user agent, adresa stránky, čas,
 * znění) zůstává, protože bez něj by souhlas nebyl doložitelný vůbec, a to je horší
 * než uložená IP.
 */
export function buildConsentEvidence(input: EvidenceInput): ConsentEvidence {
  const { storeIp, ...rest } = input;
  const evidence: ConsentEvidence = { ...rest };
  if (!storeIp) {
    evidence.ip = null;
    evidence.confirmation_ip = null;
  }
  return evidence;
}
