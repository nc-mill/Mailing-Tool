package outbox

import (
	"regexp"
	"strings"
	"testing"
)

func TestRegistryListsEveryNormativeStatement(t *testing.T) {
	all := AllStatements()
	want := []string{
		"active_campaigns", "campaign_header", "campaign_header_no_meta",
		"provider_config", "has_compile_meta",
		"claim_batch", "claim_non_campaign_batch",
		"heartbeat", "reaper_released", "reaper_ambiguous", "recovery_pass",
		"release_remaining", "mark_dispatch_started",
		"result_sent", "result_retry", "result_failed", "result_fatal", "result_throttled",
		"suppression_batch", "pause_campaign", "skip_suppressed",
		"insert_message_event", "upsert_render_warnings",
	}
	for _, name := range want {
		if _, ok := all[name]; !ok {
			t.Errorf("registr neobsahuje dotaz %q", name)
		}
	}
	if len(all) != len(want) {
		t.Errorf("registr má %d dotazů, čekám %d. Nový dotaz musí být v registru, jinak ho OB-00 nespustí", len(all), len(want))
	}
}

// Kontraktní zákaz z 4.10.1. WITH TIES v kombinaci se zamykacími klauzulemi
// vrací v PostgreSQL nesprávný počet řádků. Prosté LIMIT postižené NENÍ.
func TestNoWithTiesAnywhere(t *testing.T) {
	for name, sql := range AllStatements() {
		if strings.Contains(strings.ToUpper(sql), "WITH TIES") {
			t.Errorf("dotaz %q obsahuje WITH TIES, což je v celém projektu zakázané", name)
		}
	}
}

// Každý dotaz mířící na konkrétní zprávu musí nést obě složky primárního klíče,
// jinak projde všechny partition.
func TestSingleMessageStatementsCarryBothKeyParts(t *testing.T) {
	targeted := []string{"mark_dispatch_started", "result_sent", "result_retry", "result_failed", "result_fatal", "result_throttled"}
	all := AllStatements()
	for _, name := range targeted {
		sql := all[name]
		if !strings.Contains(sql, "id = $1") || !strings.Contains(sql, "created_at = $2") {
			t.Errorf("dotaz %q neadresuje zprávu dvousložkovým klíčem (id, created_at)", name)
		}
	}
}

// Stráž claimed_by musí být v D1 i v D3. Bez ní existuje závod, na jehož konci
// odejde zpráva dvakrát. Byla to jediná skutečná chyba korektnosti části 4b.
func TestDispatchStatementsGuardClaimedBy(t *testing.T) {
	guarded := []string{"mark_dispatch_started", "result_sent", "result_retry", "result_failed", "result_fatal", "result_throttled"}
	all := AllStatements()
	for _, name := range guarded {
		sql := all[name]
		if !strings.Contains(sql, "status = 'claimed'") || !strings.Contains(sql, "claimed_by = $3") {
			t.Errorf("dotaz %q nemá stráž AND status = 'claimed' AND claimed_by = $3", name)
		}
	}
}

// Reaper B musí mít MÍNUS. Plus by práh posunulo do budoucnosti, takže by dotaz
// zabíral víc řádků, ne méně, a na každém tiku by ukradl každou právě odesílanou
// zprávu. Mechanismus proti duplicitám by duplicity sám vyráběl.
func TestAmbiguousReaperUsesMinus(t *testing.T) {
	sql := AllStatements()["reaper_ambiguous"]
	if !strings.Contains(sql, "now() - make_interval(secs => $2)") {
		t.Fatal("reaper_ambiguous musí mít claim_expires_at < now() - make_interval(secs => $2)")
	}
	if strings.Contains(sql, "now() + make_interval") {
		t.Fatal("reaper_ambiguous obsahuje PLUS, což je obrácené znaménko z nálezu K2")
	}
}

// Claim musí nekampáňové zprávy vyloučit VÝSLOVNOU podmínkou. Spoléhat na to,
// že je zahodí vnitřní spojení, nestačí: řádek s campaign_id IS NULL by ležel
// ve frontě navěky a nikde by se to neprojevilo jako porucha.
func TestClaimExcludesNonCampaignMessagesExplicitly(t *testing.T) {
	for _, name := range []string{"claim_batch", "claim_non_campaign_batch"} {
		if !strings.Contains(AllStatements()[name], "campaign_id IS NOT NULL") {
			t.Errorf("dotaz %q nemá výslovnou podmínku campaign_id IS NOT NULL", name)
		}
	}
}

// Dekrement pokusu nesmí jít pod nulu. D3d i D3e umí nastat dřív, než kdokoliv
// attempts inkrementoval, a schéma P03 to podle rozhodnutí R29 nezachytí,
// protože ck_messages__attempts tam schválně není. Prostý dekrement by čítač
// poslal do záporu a zpráva by dostávala pokusy navíc donekonečna.
func TestAttemptDecrementNeverGoesNegative(t *testing.T) {
	all := AllStatements()
	for _, name := range []string{"result_fatal", "result_throttled"} {
		if !strings.Contains(all[name], "GREATEST(attempts - 1, 0)") {
			t.Errorf("dotaz %q nemá GREATEST(attempts - 1, 0)", name)
		}
		if strings.Contains(all[name], "attempts = attempts - 1") {
			t.Errorf("dotaz %q má holý dekrement, který zapíše -1 u čerstvé zprávy", name)
		}
	}
}

// suppressions.email je citext. Bez přetypování pravé strany na citext[] vybere
// PostgreSQL operátor text = text, porovnání je case-sensitive a suppression
// založená s velkými písmeny se nenajde. Zpráva pak odejde na odhlášenou adresu,
// což je právní i doručovací problém.
func TestSuppressionComparesAsCitext(t *testing.T) {
	sql := AllStatements()["suppression_batch"]
	if !strings.Contains(sql, "$2::text[]::citext[]") {
		t.Fatal("suppression_batch neporovnává přes ::citext[], kontrola by byla case-sensitive")
	}
}

// Sender má na message_events JEN INSERT. RETURNING i ON CONFLICT čtou řádek,
// takže by skončily na permission denied až za běhu.
func TestMessageEventInsertNeitherReadsNorConflicts(t *testing.T) {
	sql := AllStatements()["insert_message_event"]
	if strings.Contains(strings.ToUpper(sql), "RETURNING") {
		t.Error("insert_message_event má RETURNING, na to sender nemá SELECT")
	}
	if strings.Contains(strings.ToUpper(sql), "ON CONFLICT") {
		t.Error("insert_message_event má ON CONFLICT, na to sender nemá SELECT")
	}
	if !strings.Contains(sql, "'internal'") {
		t.Error("insert_message_event nezapisuje source = 'internal', jedinou hodnotu, která senderu přísluší")
	}
}

// Žádný dotaz nesmí adresovat měsíční oddíl jménem. Oddíl nedědí RLS ani
// politiky, takže přímý přístup obchází izolaci projektů, a P03 mu proto
// rozhodnutím R20 nedává žádný grant: dotaz by skončil na permission denied.
func TestNoStatementNamesAPartition(t *testing.T) {
	partition := regexp.MustCompile(`\b(messages|message_events)_y\d{4}m\d{2}\b`)
	for name, sql := range AllStatements() {
		if m := partition.FindString(sql); m != "" {
			t.Errorf("dotaz %q adresuje oddíl %q jménem; piš přes rodičovskou tabulku "+
				"s podmínkou na partiční sloupec, prořezání udělá plánovač", name, m)
		}
	}
}
