// Package outbox drží všechnu práci senderu nad tabulkou messages.
//
// Všechny normativní dotazy jsou v tomhle souboru jako konstanty a v registru
// AllStatements. Registr existuje kvůli scénáři OB-00, který každý dotaz spustí
// proti reálné databázi a ověří, že projde parserem a plánovačem. Kontrakt bez
// spustitelného testu není kontrakt: dřívější verze obsahovala SQL, které se
// nedalo vykonat, a kontrola grepem to nezachytila.
//
// Kdo přidá dotaz a nedá ho do registru, obejde OB-00. Test
// TestRegistryListsEveryNormativeStatement na to spadne.
package outbox

// StmtActiveCampaigns je krok 1 dvoukrokového claimu: seznam běžících kampaní.
// Bez tohohle kroku by pozastavená kampaň s půl milionem pending řádků měla
// nejstarší časy, řadila by se první a každý claim jakékoliv jiné kampaně by
// musel projít a zamknout jejích 500 tisíc řádků.
//
// Tahá jen identitu a revizi. Dotaz běží každou sekundu a compiled_html může mít
// stovky kilobajtů, takže hlavičku načítá až cache, a to jen při změně revize.
const StmtActiveCampaigns = `
SELECT c.id, c.revision
FROM campaigns c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.status IN ('queueing', 'sending')
  AND w.deleted_at IS NULL AND c.deleted_at IS NULL
ORDER BY c.scheduled_at NULLS FIRST, c.id`

// StmtCampaignHeader načte hlavičku kampaně do cache. Volá se jednou na dvojici
// (campaign_id, revision), ne na dávku a už vůbec ne na zprávu.
//
// compile_meta je nepovinný sloupec. Sender z něj čte clickMarkerCount pro kontrolu
// V4. Když sloupec ve schématu chybí, sender ho pozná při startu a kontrolu vypne,
// viz CampaignHeaderStatement níž.
const StmtCampaignHeader = `
SELECT c.id, c.workspace_id, c.status, c.subject, c.preheader,
       c.from_name, c.from_email, c.reply_to,
       c.compiled_html, c.compiled_text, c.revision,
       c.provider_id, c.track_opens, c.track_clicks, c.unsubscribe_list_id,
       c.compile_meta
FROM campaigns c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.id = $1 AND c.deleted_at IS NULL AND w.deleted_at IS NULL`

// StmtCampaignHeaderNoMeta je tentýž dotaz bez sloupce compile_meta. Používá se,
// když sloupec ve schématu neexistuje. Rozdíl je jediný sloupec a sender ho vybírá
// jednou při startu, ne za běhu.
const StmtCampaignHeaderNoMeta = `
SELECT c.id, c.workspace_id, c.status, c.subject, c.preheader,
       c.from_name, c.from_email, c.reply_to,
       c.compiled_html, c.compiled_text, c.revision,
       c.provider_id, c.track_opens, c.track_clicks, c.unsubscribe_list_id,
       NULL::jsonb
FROM campaigns c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.id = $1 AND c.deleted_at IS NULL AND w.deleted_at IS NULL`

// StmtProviderConfig načte zašifrovanou konfiguraci providera a závaznou kvótu.
// quota_max_send_rate aktualizuje aplikace každých 15 minut a je závazným zdrojem
// rychlosti; hodnota z dešifrované obálky se bere jen tehdy, když je sloupec NULL.
// Tahá i stav providera. Dřívější znění bralo jen konfiguraci a kvótu, takže
// když AWS účet zablokoval a aplikace nastavila status = 'blocked' nebo
// sending_enabled = false, sender to NEPOZNAL a tlačil zprávy do provideru,
// který je odmítá, dokud se nepřepálila pojistka. Sender má SELECT na celou
// tabulku, takže to nestojí žádný nový grant.
//
// p.type se čte kvůli křížové kontrole proti kind z dešifrované obálky. Když se
// rozejdou, je to tichý rozchod dvou zdrojů pravdy a kampaň se pozastaví.
const StmtProviderConfig = `
SELECT p.id, p.workspace_id, p.config_encrypted, p.quota_max_send_rate,
       p.type, p.status, p.sending_enabled
FROM sending_providers p
WHERE p.id = $1`

// StmtInsertMessageEvent zapisuje události, které vzniknou UVNITŘ senderu
// a nemá je odkud znát nikdo jiný: render_failed a circuit_breaker_open.
//
// Bez tohohle dotazu byl GRANT INSERT ON message_events i politika
// sender_bypass na téhle tabulce mrtvé právo a obě hodnoty slovníku
// ck_message_events__type neměly původce. Neodeslaná zpráva kvůli chybě šablony
// pak nezanechala žádnou stopu kromě messages.error_code, který se přepíše
// při dalším pokusu.
//
// source = 'internal' je jediná hodnota z ck_message_events__source, která
// senderu přísluší: 'ses_sns' a 'tracking' patří příjmu událostí zvenčí.
// ts NEMÁ default a je to schválně: u vlastní události je čas vzniku náš,
// kdežto received_at si databáze doplní sama.
//
// Sender má na tabulku JEN INSERT, ne SELECT, takže dotaz nesmí mít RETURNING
// ani ON CONFLICT. Ověřeno spuštěním pod rolí mlain_sender na PostgreSQL 18.4:
// INSERT projde, SELECT skončí na permission denied.
//
// rank se NEUVÁDÍ. P03 ho rozhodnutím R32 zavedl jako
// `GENERATED ALWAYS AS (CASE type ...) STORED`, tedy jako čistou funkci typu,
// a do generovaného sloupce nejde zapsat nic než DEFAULT: PostgreSQL zápis
// odmítne chybou 428C9 "cannot insert a non-DEFAULT value into column rank".
// Škálu drží schéma, ne sender, takže tady není co dublovat. Nalezl to scénář
// OB-00 spuštěním proti skutečným migracím; čtením kontraktu to vidět nebylo.
const StmtInsertMessageEvent = `
INSERT INTO message_events
  (workspace_id, message_id, message_created_at, campaign_id, contact_id,
   recipient, type, ts, source, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 'internal', $8)`

// StmtUpsertRenderWarnings zapisuje agregovaná varování z renderu. Sender je
// drží v paměti a splachuje jednou za 10 sekund, ne po zprávě: při milionové
// kampani by zápis po zprávě byl milion round tripů kvůli údaji, který je
// zajímavý jako počet.
//
// count se SČÍTÁ přes excluded.count, ne inkrementuje o jedničku, právě proto,
// že jedna dávka nese počet z celého okna.
//
// Tenhle zápis vyžaduje SELECT, INSERT i UPDATE a politiku sender_bypass
// s USING i WITH CHECK, protože větev DO UPDATE čte existující řádek. P03 obojí
// dodává a campaign_render_warnings je proto osmá tabulka v SENDER_BYPASS_TABLES.
// Ověřeno spuštěním pod rolí mlain_sender: dvě dávky s počty 3 a 4 dají 7.
const StmtUpsertRenderWarnings = `
INSERT INTO campaign_render_warnings
  (workspace_id, campaign_id, code, path, count, sample)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (workspace_id, campaign_id, code, path)
DO UPDATE SET count        = campaign_render_warnings.count + excluded.count,
              last_seen_at = now()`

// StmtHasCompileMeta zjistí při startu, jestli schéma nese sloupec compile_meta.
const StmtHasCompileMeta = `
SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'compile_meta'`

// StmtClaimBatch je krok 2: claim uvnitř jedné kampaně.
//
// Spojovací podmínky jsou ve WHERE, ne v ON. Cílová tabulka UPDATE je do dotazu
// přidaná mimo strom spojení ve FROM, takže na ni jde odkazovat ve WHERE, ale ne
// v ON bez LATERAL. Tvar s JOIN ... ON c.id = m.campaign_id PostgreSQL odmítne
// chybou "invalid reference to FROM-clause entry for table m".
//
// Filtr na běžící kampaň je ve druhém kroku, ne v CTE. Je to pojistka proti závodu:
// mezi krokem 1 a krokem 2 mohl uživatel kampaň pozastavit nebo smazat projekt.
// Vyhodnocuje se nad nejvýš LIMIT řádky, takže je levná.
const StmtClaimBatch = `
WITH claimable AS (
  SELECT m.id, m.created_at
  FROM messages m
  WHERE m.campaign_id = $4
    AND m.campaign_id IS NOT NULL
    AND m.status = 'pending'
    AND m.next_attempt_at <= now()
    AND m.kind = 'campaign'
  ORDER BY m.next_attempt_at, m.id
  LIMIT $2
  FOR UPDATE OF m SKIP LOCKED
)
UPDATE messages m
SET status           = 'claimed',
    claimed_by       = $1,
    claimed_at       = now(),
    claim_expires_at = now() + make_interval(secs => $3),
    updated_at       = now()
FROM claimable cl, campaigns c, workspaces w
WHERE m.id         = cl.id
  AND m.created_at = cl.created_at
  AND c.id         = m.campaign_id
  AND w.id         = m.workspace_id
  AND c.status IN ('queueing','sending')
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
          m.email, m.render_data, m.attempts, m.kind`

// StmtClaimTestBatch claimuje testovací odeslání napříč kampaněmi a přednostně.
// Schválně NEKONTROLUJE c.status: testovací odeslání musí fungovat u kampaně
// ve stavu draft, jinak nemá smysl. Kontrola smazané kampaně a smazaného
// workspace zůstává.
const StmtClaimTestBatch = `
WITH claimable AS (
  SELECT m.id, m.created_at
  FROM messages m
  WHERE m.status = 'pending'
    AND m.kind = 'test'
    AND m.campaign_id IS NOT NULL
    AND m.next_attempt_at <= now()
  ORDER BY m.next_attempt_at, m.id
  LIMIT $2
  FOR UPDATE OF m SKIP LOCKED
)
UPDATE messages m
SET status           = 'claimed',
    claimed_by       = $1,
    claimed_at       = now(),
    claim_expires_at = now() + make_interval(secs => $3),
    updated_at       = now()
FROM claimable cl, campaigns c, workspaces w
WHERE m.id         = cl.id
  AND m.created_at = cl.created_at
  AND c.id         = m.campaign_id
  AND w.id         = m.workspace_id
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
          m.email, m.render_data, m.attempts, m.kind`

// StmtHeartbeat prodlužuje claim rozpracovaných zpráv. Musí nést OBĚ složky
// klíče, jinak se neuplatní prořezání partition a heartbeat každých pár desítek
// sekund projde všechny partition tabulky messages.
const StmtHeartbeat = `
UPDATE messages m
SET claim_expires_at = now() + make_interval(secs => $2), updated_at = now()
FROM unnest($3::uuid[], $4::timestamptz[]) AS k(id, created_at)
WHERE m.id = k.id AND m.created_at = k.created_at
  AND m.status = 'claimed' AND m.claimed_by = $1`

// StmtReaperReleased je reaper A: prokazatelně neodeslané zprávy zpět do fronty.
// Podmínka dispatch_started_at IS NULL je klíčová, uvolní se jen zprávy,
// u kterých odesílání ještě nezačalo.
const StmtReaperReleased = `
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, next_attempt_at = now(), updated_at = now()
WHERE status = 'claimed' AND claim_expires_at < now()
  AND dispatch_started_at IS NULL
RETURNING id`

// StmtReaperAmbiguous je reaper B: rozpracované zprávy, u kterých nevíme, jestli
// odešly. Znaménko je MÍNUS. Rezerva $2 je jeden TTL navíc, takže se zpráva uvolní
// po dvojnásobku TTL od claimu.
//
// dispatch_started_at se nuluje, aby řádek vrácený na pending vypadal jako řádek,
// u kterého odesílání nezačalo. Bez toho by ho při dalším průchodu sebral zase
// dotaz B místo dotazu A a druhý nejednoznačný průchod by nastal, aniž by se
// doopravdy odesílalo.
//
// Rozhodnutí pending versus failed padá podle ambiguous_count PŘED inkrementem.
// Rozpoznávat opakování podle error_code nefunguje, protože ho ten samý dotaz sám
// nastavuje a další selhání ho přepíše.
const StmtReaperAmbiguous = `
UPDATE messages
SET ambiguous_count = ambiguous_count + 1,
    status = CASE
               WHEN $1 = 'retry' AND ambiguous_count = 0 THEN 'pending'
               ELSE 'failed'
             END,
    error_code          = 'ambiguous_dispatch',
    error_detail        = 'dispatch started but result was never recorded',
    claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
    dispatch_started_at = NULL,
    next_attempt_at     = now(),
    updated_at          = now()
WHERE status = 'claimed'
  AND claim_expires_at < now() - make_interval(secs => $2)
  AND dispatch_started_at IS NOT NULL
  AND provider_message_id IS NULL
RETURNING id, created_at, ambiguous_count`

// StmtRecoveryPass je jednorázový běh při startu. Reaper A bez časové podmínky
// a se svým claimed_by: o své předchozí inkarnaci sender jistě ví, že je mrtvá.
// Dotaz B se při startu NEPOUŠTÍ, nejednoznačné zprávy vždycky čekají plnou rezervu.
const StmtRecoveryPass = `
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, next_attempt_at = now(), updated_at = now()
WHERE status = 'claimed' AND claimed_by = $1 AND dispatch_started_at IS NULL
RETURNING id`

// StmtReleaseRemaining vrací při shutdownu zbytek dávky, u které odesílání
// nezačalo.
const StmtReleaseRemaining = `
UPDATE messages m
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, next_attempt_at = now(), updated_at = now()
FROM unnest($2::uuid[], $3::timestamptz[]) AS k(id, created_at)
WHERE m.id = k.id AND m.created_at = k.created_at
  AND m.status = 'claimed' AND m.claimed_by = $1
  AND m.dispatch_started_at IS NULL
RETURNING m.id`

// StmtMarkDispatchStarted je krok D1. Commituje se PŘED síťovým voláním, takže
// "marker chybí" implikuje "volání neproběhlo". Opačně to neplatí a právě tuhle
// asymetrii návrh záměrně používá: chybuje se ve prospěch neodeslání.
//
// Nula ovlivněných řádků znamená, že claim mezitím zmizel. Volání provideru se
// pak NEPROVEDE a zpráva se z lokální dávky zahodí bez zápisu.
const StmtMarkDispatchStarted = `
UPDATE messages
SET attempts = attempts + 1, dispatch_started_at = now(), updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3`

// StmtResultSent je D3a.
const StmtResultSent = `
UPDATE messages
SET status = 'sent', provider_message_id = $4, sent_at = now(),
    dispatch_started_at = NULL, error_code = NULL, error_detail = NULL,
    updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3`

// StmtResultRetry je D3b: opakovatelná chyba, ještě zbývají pokusy.
// dispatch_started_at se maže, protože o selhání máme důkaz.
const StmtResultRetry = `
UPDATE messages
SET status = 'pending', dispatch_started_at = NULL,
    claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
    next_attempt_at = now() + make_interval(secs => $4),
    error_code = $5, error_detail = $6, updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3`

// StmtResultFailed je D3c: trvalá chyba nebo vyčerpané pokusy.
const StmtResultFailed = `
UPDATE messages
SET status = 'failed', dispatch_started_at = NULL,
    error_code = $4, error_detail = $5, updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3`

// StmtResultFatal je D3d: fatální chyba pro celou kampaň. Zpráva se vrací do
// fronty a pokus se jí vrací zpět, protože chyba nebyla její vina.
// ŽÁDNÁ chyba třídy Fatal nesmí zprávu označit jako failed.
//
// GREATEST(attempts - 1, 0) je POVINNÉ, ne opatrnost. D3d umí nastat DŘÍV, než
// kdokoliv attempts inkrementoval: resolveProvider volá RecordFatal při
// nedešifrovatelné konfiguraci ještě před krokem D1, takže u čerstvé zprávy je
// attempts = 0 a prostý dekrement zapíše -1. Schéma P03 to nezachytí, protože
// ck_messages__attempts tam podle rozhodnutí R29 SCHVÁLNĚ není: zápis projde
// a čítač jde do záporu. Zpráva pak dostane o pokus navíc a při opakované
// fatální chybě se čítač propadá dál, takže se strop MAX_ATTEMPTS nikdy
// nedosáhne a zpráva se vrací do fronty donekonečna. Ověřeno spuštěním
// na PostgreSQL 18.4: bez GREATEST vyjde attempts = -1, s ním 0.
const StmtResultFatal = `
UPDATE messages
SET status = 'pending', dispatch_started_at = NULL,
    claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
    attempts = GREATEST(attempts - 1, 0),
    next_attempt_at = now() + interval '5 minutes',
    error_code = $4, error_detail = $5, updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3`

// StmtResultThrottled je D3e. Existuje samostatně, protože throttling není chyba
// té zprávy: pokus se vrací zpět, což D3b neumí a dekrement má jinak jen fatální
// D3d. Ověřuje to AK-7.4.
const StmtResultThrottled = `
UPDATE messages
SET status = 'pending', dispatch_started_at = NULL,
    claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
    attempts = GREATEST(attempts - 1, 0),
    next_attempt_at = now() + make_interval(secs => $4),
    error_code = 'rate_limited', error_detail = $5, updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3`

// StmtSuppressionBatch je dávková kontrola suppression po claimu. Jeden dotaz na
// celou dávku, ne jeden na zprávu: po zprávách by to přidalo round trip do horké
// cesty a propustnost by spadla na polovinu.
//
// Obě větve disjunkce platí zároveň, ne jedna nebo druhá: u řádku vzniklého
// výmazem podle GDPR je v e-mailu jen zástupná hodnota a dohledatelný je pouze
// otisk. Sloupec je `citext NOT NULL`, takže NULL tam nikdy není a větev přes
// otisk existuje kvůli zástupné hodnotě, ne kvůli prázdnému sloupci.
//
// PŘETYPOVÁNÍ ::citext[] JE POVINNÉ. suppressions.email je citext, parametr je
// text[]. Při rozlišování operátoru najde PostgreSQL implicitní přetypování
// citext na text (opačný směr je jen ASSIGNMENT a při rozlišování se nepoužije),
// takže by se vybral operátor text = text a porovnání by bylo CASE-SENSITIVE.
// Go přitom posílá adresy malými písmeny, kdežto citext si v řádku drží původní
// zápis: suppression založená jako Jan.Novak@Example.cz by se nenašla a zpráva
// by odešla na odhlášenou adresu. Ověřeno spuštěním na PostgreSQL 18.4 pod rolí
// mlain_sender: bez přetypování vrátí dotaz 0 řádků, s ním 1.
//
// Přetypování je legální a levné: text na citext je binárně kompatibilní
// ASSIGNMENT cast, parametr zůstává text[], takže pgx nemusí znát OID pro
// citext[], a porovnání se vrátí k citext = citext, tedy i k unikátnímu indexu
// uq_suppressions__workspace_email.
const StmtSuppressionBatch = `
SELECT s.email, s.fingerprint
FROM suppressions s
WHERE s.workspace_id = $1
  AND s.removed_at IS NULL
  AND (s.email = ANY($2::text[]::citext[]) OR s.fingerprint = ANY($3::bytea[]))`

// StmtSkipSuppressed překlopí vyloučené zprávy na skipped. Vypadnou z dávky
// ještě před krokem D0, tedy dřív, než se čerpá povolenka throttleru.
const StmtSkipSuppressed = `
UPDATE messages m
SET status = 'skipped', error_code = 'suppressed',
    claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL,
    updated_at = now()
FROM unnest($2::uuid[], $3::timestamptz[]) AS k(id, created_at)
WHERE m.id = k.id AND m.created_at = k.created_at
  AND m.status = 'claimed' AND m.claimed_by = $1
RETURNING m.id`

// StmtPauseCampaign je jediný zápis, kterým sender kampaň pozastaví.
// Ve výčtu je i queueing, ne jen sending: claim bere zprávy obou stavů, takže
// kampaň v queueing s nedešifrovatelnými credentials by jinak pozastavit nešla,
// UPDATE by zasáhl nula řádků a nikde by se to neprojevilo jako porucha.
//
// Nula ovlivněných řádků NENÍ chyba, znamená to, že kampaň už není v odesílacím
// stavu. Sender to zaloguje na úrovni INFO a dál se o kampaň nepokouší.
const StmtPauseCampaign = `
UPDATE campaigns
SET status = 'paused', pause_reason = $2
WHERE id = $1 AND status IN ('queueing', 'sending')`

// AllStatements je registr pro OB-00. Klíč je jméno scénáře, hodnota je SQL.
func AllStatements() map[string]string {
	return map[string]string{
		"active_campaigns":        StmtActiveCampaigns,
		"campaign_header":         StmtCampaignHeader,
		"campaign_header_no_meta": StmtCampaignHeaderNoMeta,
		"provider_config":         StmtProviderConfig,
		"has_compile_meta":        StmtHasCompileMeta,
		"claim_batch":             StmtClaimBatch,
		"claim_test_batch":        StmtClaimTestBatch,
		"heartbeat":               StmtHeartbeat,
		"reaper_released":         StmtReaperReleased,
		"reaper_ambiguous":        StmtReaperAmbiguous,
		"recovery_pass":           StmtRecoveryPass,
		"release_remaining":       StmtReleaseRemaining,
		"mark_dispatch_started":   StmtMarkDispatchStarted,
		"result_sent":             StmtResultSent,
		"result_retry":            StmtResultRetry,
		"result_failed":           StmtResultFailed,
		"result_fatal":            StmtResultFatal,
		"result_throttled":        StmtResultThrottled,
		"suppression_batch":       StmtSuppressionBatch,
		"pause_campaign":          StmtPauseCampaign,
		"skip_suppressed":         StmtSkipSuppressed,
		"insert_message_event":    StmtInsertMessageEvent,
		"upsert_render_warnings":  StmtUpsertRenderWarnings,
	}
}

// CanTransition je tabulka povolených přechodů stavu zprávy.
//
// Existuje kvůli kontraktu 1: uzavřený výčet stavů a jediná pojmenovaná výjimka
// failed -> sent by jinak žily jen v TypeScriptu, přestože přechody provádí
// i sender. Runner RunOutboxTransitions z P02 ji pouští nad fixture
// outbox/scenarios.json, takže se obě strany nemohou rozejít.
//
// actor je "sender" nebo "app". errorCode je prázdný řetězec pro NULL, protože
// tak ho nese sloupec messages.error_code.
func CanTransition(from, to, actor, errorCode string) bool {
	if from == to {
		return false
	}
	switch from {
	case "pending":
		// pending -> sent NIKDY, ani pro aplikaci: odeslání vždy prochází claimem.
		return to == "claimed" || to == "skipped" || to == "failed"
	case "claimed":
		return to == "sent" || to == "failed" || to == "pending" || to == "skipped"
	case "failed":
		// JEDINÁ výjimka celého modelu. Zpětné smíření nejednoznačných zpráv
		// podle metadat providera provádí VÝHRADNĚ aplikace a jen u zpráv,
		// které sender označil jako ambiguous_dispatch. Sender tenhle přechod
		// nikdy nedělá a nemá na něj práva.
		return to == "sent" && actor == "app" && errorCode == "ambiguous_dispatch"
	case "sent", "skipped":
		return false
	default:
		return false
	}
}
