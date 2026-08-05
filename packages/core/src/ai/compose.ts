import { composeSchema, formatZodIssues, type ComposeOutput } from './compose-schema';
/*
 * Zkracování surové odpovědi dělá `truncateRawOutput`, ne `.slice()` na třech
 * místech. Dřív se odsud brala jen konstanta `MAX_RAW_OUTPUT_CHARS` a limit se
 * aplikoval ručně; byla to druhá implementace téhož pravidla vedle funkce,
 * kterou nikdo nevolal.
 */
import { truncateRawOutput } from './conversation-service';

export type ComposeParams = {
  variant: 'newsletter' | 'announcement' | 'transactional' | 'reengagement';
  brief: string;
  language: string;
  tone: 'formal' | 'friendly' | 'playful' | 'urgent';
  brand: unknown;
  model: unknown;
  sectionCount?: number;
  websiteUrl?: string;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
};

export type ComposeDeps = {
  generateStructured: (params: {
    model: unknown;
    schema: typeof composeSchema;
    schemaName: string;
    schemaDescription: string;
    system: string;
    prompt: string;
    maxOutputTokens: number;
    maxRetries: number;
    abortSignal?: AbortSignal;
  }) => Promise<{
    output: unknown;
    usage: { inputTokens: number; outputTokens: number };
    /**
     * Co o volání hlásí sám poskytovatel. Nepovinné schválně: testy si sem
     * dosazují jednoduchou dvojici tokenů a neměly by kvůli tomuhle poli
     * přestat kompilovat, když poskytovatel žádnou cenu nehlásí.
     */
    reported?: ComposeReportedUsage | undefined;
    finishReason: string;
  }>;
  isNoObjectGenerated: (error: unknown) => boolean;
  /**
   * Konkrétní důvody, proč výstup neprošel schématem. Dodává je adaptér nad AI
   * SDK, protože jen on smí sáhnout do jeho typů chyb. Bez nich dostane opravné
   * kolo jen obecnou větu a opravuje naslepo.
   */
  outputIssuesOf?: (error: unknown) => ComposeIssue[];
  buildBaseTemplate: (params: unknown) => unknown;
  validateDocument: (doc: unknown) => { ok: boolean; errors: unknown[] };
  validateLiquid: (doc: unknown) => { ok: boolean; errors: unknown[] };
};

/** Jeden nález, kvůli kterému se odpověď modelu zahodila. */
export type ComposeIssue = { path: string; code: string; message: string };

/**
 * Skutečná účtovaná částka a tokeny mezipaměti, jak je hlásí poskytovatel.
 * `null` znamená „nehlásil", nikdy nulu. Jednotku částky sem doplňuje až
 * `recordUsage` podle poskytovatele, protože skládání ho nezná.
 */
export type ComposeReportedUsage = {
  cost: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

/** Spotřeba jednoho skládání, včetně toho, co hlásí poskytovatel. */
export type ComposeUsage = {
  inputTokens: number;
  outputTokens: number;
  reported: ComposeReportedUsage;
};

export type ComposeResult =
  | {
      ok: true;
      document: unknown;
      composition: ComposeOutput;
      usage: ComposeUsage;
    }
  | {
      ok: false;
      code: 'ai_invalid_output';
      rawOutput: string | null;
      issues: string | null;
      /** Nálezy strojově, pro log. Bez hodnot polí, ty nesou obsah e-mailu. */
      issueList: ComposeIssue[];
      /**
       * Spotřeba i u neúspěchu. Neúspěšné kolo stálo peníze úplně stejně jako
       * úspěšné, takže se musí dostat do `ai_usage_daily`. Dokud se tady
       * nevracela, mizely tokeny za obě kola beze stopy.
       */
      usage: ComposeUsage;
    };

const SCHEMA_NAME = 'EmailComposition';

/**
 * Popis schématu jde do pole `description` u strukturovaného výstupu, a to má
 * u OpenAI TVRDÝ STROP 1024 znaků:
 *
 *   Invalid 'text.format.description': string too long.
 *   Expected a string with maximum length 1024, but got a string with length 1057.
 *
 * Proto je krátký a celý návod na tvar je v systémovém promptu `SHAPE_GUIDE`,
 * kde žádný takový strop není. Hlídá to `compose.test.ts`.
 */
export const SCHEMA_DESCRIPTION_SHORT = 'Obsah e-mailu rozdělený do sekcí. Nikdy negeneruj HTML.';

/** Strop délky popisu schématu u OpenAI. Překročení je chyba 400, ne varování. */
export const MAX_SCHEMA_DESCRIPTION_CHARS = 1024;

/**
 * POPIS TVARU, KTERÝ MODEL OPRAVDU DOSTANE.
 *
 * Dřív tu byla jediná věta („Obsah e-mailu rozdělený do sekcí."). To stačilo,
 * dokud tvar vynucoval přísný režim strukturovaného výstupu u poskytovatele.
 * Ten je ale vypnutý, protože naše schéma sekcí je rozlišená unie s volitelnými
 * poli, kterou přísný režim odmítá (`'oneOf' is not permitted`). Od té chvíle je
 * schéma pro model jen vodítko a závazné je TOHLE zadání. Když v něm tvar
 * sekcí není popsaný, model si ho domyslí a `safeParse` odpověď zahodí.
 *
 * Výčet druhů sekcí a jejich povinných polí je proto vypsaný, ne odkázaný.
 */
export const SHAPE_GUIDE = [
  'Vracíš obsah e-mailu rozdělený do sekcí. Nikdy negeneruj HTML ani Markdown, jen prostý text.',
  '',
  /*
   * Kostra se ukazuje NA PŘÍKLADU, ne popisem v odrážkách. Odrážkový seznam
   * („meta.name…, sections…, paletteHint…") model četl tak, že všechny klíče
   * patří dovnitř `meta`, a vracel `{"meta":{"name":…,"sections":[…]}}`, tedy
   * `sections: expected array, received undefined`. Naměřeno na třech zadáních
   * ze šesti. S doslovnou kostrou se to přestalo dít.
   */
  'Odpověď má přesně tyhle tři klíče na NEJVYŠŠÍ úrovni, žádný z nich není uvnitř jiného:',
  '{',
  '  "meta": { "name": "název šablony, 1 až 120 znaků", "previewText": "text do náhledu, 1 až 150 znaků" },',
  '  "sections": [ { "kind": "hero", "headline": "…" } ],',
  '  "paletteHint": "brand"',
  '}',
  'Klíč sections je pole 1 až 12 sekcí a leží vedle meta, ne uvnitř něj.',
  'Klíč paletteHint je "brand" nebo "neutral".',
  '',
  'Druhy sekcí. Povinná pole jsou vypsaná, volitelná jsou v závorce.',
  'Pole, které není vypsané ani v závorce, neexistuje a nesmíš ho poslat.',
  '- hero: headline (subhead, cta)',
  '- article: heading, body (link)',
  '- feature: headline, body, cta         <- cta je tu POVINNÉ',
  '- bullets: items, pole 1 až 20 řetězců (heading)',
  '- keyValue: rows, pole 1 až 20 objektů s poli label a value',
  '- quote: text (author)',
  '- cta: label, href (note)',
  '- spacer: žádná další pole',
  '',
  'Objekt cta i objekt link mají vždy obě pole: label a href.',
  'Pole imageAssetId nikdy neuváděj, žádný obrázek k dispozici nemáš.',
].join('\n');

/**
 * PRAVIDLO O ODKAZECH, kvůli kterému se skládání nedařilo vůbec nikdy.
 *
 * Naměřeno 3. 8. 2026 na třech různých zadáních, pokaždé stejně: model složil
 * dobrý e-mail, ale do odkazů dosadil `#`, `/eshop` nebo `#novinky`, protože
 * žádnou skutečnou adresu neznal a nikdo mu neřekl, že relativní odkaz je
 * nepřijatelný. Validace ho pak odmítla vždy na témž místě:
 *
 *   sections.0.cta.href: base_section_href_not_absolute_http
 *   sections.1.link.href: base_section_href_not_absolute_http
 *   sections.2.href: base_section_href_not_absolute_http
 *
 * Zákaz sám nestačí, model potřebuje ještě únikovou cestu pro případ, kdy
 * adresu opravdu nemá: vynechat volitelné odkazy a nepoužít druhy sekcí, které
 * mají `href` povinné. To jsou DVA druhy, `cta` a `feature`; na `feature` se
 * zapomnělo v prvním pokusu o opravu a model na něm hned spadl
 * (`sections.1.cta: expected object, received undefined`). Bez téhle věty by si
 * adresu vymyslel, což je horší než chyba: vymyšlený odkaz projde validací
 * a odejde zákazníkům.
 */
function linkRules(websiteUrl: string | undefined): string[] {
  if (websiteUrl === undefined) {
    return [
      'Odkazy: NEZNÁŠ žádnou adresu, na kterou by šlo odkázat, a žádnou si nesmíš vymyslet.',
      'Proto vynech volitelná pole cta a link a nepoužívej sekce druhu "cta" ani "feature",',
      'protože ty mají odkaz povinný. K akci vyzvi textem, ne odkazem.',
    ];
  }
  return [
    `Odkazy: jedinou povolenou adresou je ${websiteUrl}. Jinou si nevymýšlej.`,
    'Každé pole href musí být úplná adresa začínající na http:// nebo https://.',
    'Nikdy nepoužívej "#", kotvu ani relativní cestu jako "/eshop", odpověď by byla zahozena.',
  ];
}

function buildPrompt(params: ComposeParams): string {
  const lines = [
    `Druh e-mailu: ${params.variant}.`,
    `Tón: ${params.tone}. Jazyk: ${params.language}.`,
    params.sectionCount === undefined
      ? 'Počet sekcí zvol podle zadání.'
      : `Připrav přibližně ${params.sectionCount} sekcí.`,
    ...linkRules(params.websiteUrl),
    'Do textů nepiš personalizační pole ani značky Liquidu, tedy nic v {{ }} nebo {% %}.',
    '',
    'Zadání od uživatele:',
    params.brief,
  ];
  return lines.filter((line) => line !== '').join('\n');
}

/**
 * Jeden pokus, jedna oprava, pak se vzdáme bez poškození. Nikdy se nedělá
 * částečné použití odpovědi, dohadování chybějících polí ani zápis nevalidního
 * dokumentu s tím, že „uživatel to opraví". Editor se nikdy neotevře s rozbitým
 * dokumentem.
 */
export async function composeTemplateDraft(
  params: ComposeParams,
  deps: ComposeDeps,
): Promise<ComposeResult> {
  const system = SHAPE_GUIDE;
  const basePrompt = buildPrompt(params);
  const maxOutputTokens = params.maxOutputTokens ?? 16_000;

  const attempt = async (prompt: string) =>
    deps.generateStructured({
      model: params.model,
      schema: composeSchema,
      schemaName: SCHEMA_NAME,
      schemaDescription: SCHEMA_DESCRIPTION_SHORT,
      system,
      prompt,
      maxOutputTokens,
      // maxRetries řeší jen síťové chyby, ne neshodu se schématem: SDK
      // opakuje stejný požadavek, což nevalidní schéma neopraví.
      maxRetries: 2,
      ...(params.abortSignal === undefined ? {} : { abortSignal: params.abortSignal }),
    });

  let rawOutput: string | null = null;
  let issues: string | null = null;
  let issueList: ComposeIssue[] = [];
  /*
   * SČÍTÁ SE PŘES OBĚ KOLA, nepřepisuje se. Dokud se tu přiřazovalo
   * `usage = response.usage`, spolklo opravné kolo spotřebu toho prvního
   * a uživateli se v přehledu ukázala jen půlka tokenů, které opravdu zaplatil.
   */
  const usage: ComposeUsage = {
    inputTokens: 0,
    outputTokens: 0,
    reported: { cost: null, cacheReadTokens: null, cacheWriteTokens: null },
  };
  /*
   * SKUTEČNÁ ČÁSTKA SE SČÍTÁ PŘES KOLA STEJNĚ JAKO TOKENY. Opravné kolo je
   * druhý požadavek na poskytovatele a je na faktuře zvlášť.
   *
   * Sčítá se ale JEN TO, CO OPRAVDU PŘIŠLO: dokud nepřijde ani jedna částka,
   * zůstává `null`, protože nula by v přehledu znamenala „zadarmo".
   */
  const addReported = (target: number | null, value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? (target ?? 0) + value : target;

  const addUsage = (round: {
    inputTokens: number;
    outputTokens: number;
    reported?: ComposeReportedUsage | undefined;
  }): void => {
    usage.inputTokens += Number.isFinite(round.inputTokens) ? round.inputTokens : 0;
    usage.outputTokens += Number.isFinite(round.outputTokens) ? round.outputTokens : 0;
    usage.reported.cost = addReported(usage.reported.cost, round.reported?.cost);
    usage.reported.cacheReadTokens = addReported(
      usage.reported.cacheReadTokens,
      round.reported?.cacheReadTokens,
    );
    usage.reported.cacheWriteTokens = addReported(
      usage.reported.cacheWriteTokens,
      round.reported?.cacheWriteTokens,
    );
  };

  for (let round = 0; round < 2; round += 1) {
    let candidate: unknown;
    try {
      const prompt =
        round === 0
          ? basePrompt
          : [
              basePrompt,
              '',
              'Tvoje předchozí odpověď neprošla validací. Tady je, co jsi vrátil:',
              // Zkrácené je už při přiřazení, druhý ořez by byl jen zdvojení.
              rawOutput ?? '',
              '',
              'Konkrétní chyby:',
              issues ?? '(neuvedeno)',
              '',
              'Oprav je a vrať znovu celou odpověď podle schématu.',
            ].join('\n');
      const response = await attempt(prompt);
      addUsage(response.usage);
      candidate = response.output;
    } catch (error) {
      if (!deps.isNoObjectGenerated(error)) throw error;
      const typed = error as {
        text?: string;
        usage?: { inputTokens?: number; outputTokens?: number };
      };
      rawOutput = truncateRawOutput(typed.text);
      /*
       * I tenhle pokus se u poskytovatele odbavil a je na faktuře. SDK nese
       * spotřebu i na chybě, takže se přičte stejně jako u úspěšného kola.
       */
      addUsage({
        inputTokens: typed.usage?.inputTokens ?? 0,
        outputTokens: typed.usage?.outputTokens ?? 0,
      });
      /*
       * Konkrétní nálezy, ne obecná věta. Tuhle větev bere SDK vždycky, když
       * odpověď neprojde schématem, takže právě sem patří to nejpřesnější, co
       * o chybě víme. Dokud tu byla jen věta „odpověď neodpovídala schématu",
       * neměl druhý pokus co opravovat a v logu nezbylo nic použitelného.
       */
      issueList = deps.outputIssuesOf?.(error) ?? [];
      issues =
        issueList.length === 0
          ? 'Odpověď nešla naparsovat jako JSON nebo neodpovídala schématu.'
          : formatIssueList(issueList);
      continue;
    }

    const parsed = composeSchema.safeParse(candidate);
    if (!parsed.success) {
      rawOutput = truncateRawOutput(JSON.stringify(candidate));
      issueList = parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : '(kořen)',
        code: issue.code,
        message: issue.message,
      }));
      issues = formatZodIssues(parsed.error);
      continue;
    }

    const document = deps.buildBaseTemplate({
      variant: params.variant,
      brand: params.brand,
      language: params.language,
      sections: parsed.data.sections,
      websiteUrl: params.websiteUrl,
      darkMode: true,
    });

    // Structured output zaručuje tvar, ne to, že model nenapsal do textu
    // {% assign %}. Proto se výsledek vždy validuje ještě jednou naším
    // validátorem, i když ho postavil náš vlastní generátor.
    const documentCheck = deps.validateDocument(document);
    const liquidCheck = deps.validateLiquid(document);
    if (!documentCheck.ok || !liquidCheck.ok) {
      rawOutput = truncateRawOutput(JSON.stringify(candidate));
      const found = [...documentCheck.errors, ...liquidCheck.errors];
      issueList = found.map((raw) => {
        const issue = raw as { path?: unknown; code?: unknown; message?: unknown };
        return {
          path: typeof issue.path === 'string' ? issue.path : '(dokument)',
          code: typeof issue.code === 'string' ? issue.code : 'invalid',
          message: typeof issue.message === 'string' ? issue.message : '',
        };
      });
      issues = JSON.stringify(found).slice(0, 2000);
      continue;
    }

    return { ok: true, document, composition: parsed.data, usage };
  }

  return { ok: false, code: 'ai_invalid_output', rawOutput, issues, issueList, usage };
}

/** Nálezy pro model: cesta a důvod, jeden na řádek. */
function formatIssueList(list: readonly ComposeIssue[]): string {
  return list.map((issue) => `- ${issue.path}: ${issue.message || issue.code}`).join('\n');
}
