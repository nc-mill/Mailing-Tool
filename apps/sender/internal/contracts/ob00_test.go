//go:build integration

package contracts

import (
	"context"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

// TestOB00EveryStatementExecutes je scénář OB-00.
//
// Netvrdí nic o výsledku, jen že každý normativní dotaz projde parserem
// a plánovačem proti čerstvě zmigrované databázi. Prázdný výsledek je úspěch.
// Běží jako první ze všech scénářů, protože spadne dřív, než by jeho selhání
// zamaskoval delší výpis jiného testu.
//
// Odhalil by obě chyby, které kontrakt v jednom vydání obsahoval: neplatný odkaz
// na cíl UPDATE v klauzuli ON a obrácené znaménko u reaperu. Obojí prošlo dvěma
// koly revize, protože se ověřovalo čtením, a čtení neumí zjistit, jestli je SQL
// platné.
func TestOB00EveryStatementExecutes(t *testing.T) {
	db := testsupport.New(t)
	ctx := context.Background()

	// Argumenty jsou typově správné výplně a o výsledku nic netvrdíme, ALE
	// identifikátory projektu a kampaně musí být SKUTEČNÉ.
	//
	// Dotazy, které jen čtou nebo mění, snesou náhodné UUID a vrátí nula řádků.
	// Zápis do tabulky s cizím klíčem ne: upsert_render_warnings odkazuje na
	// workspaces i campaigns, takže s vymyšleným UUID skončí na 23503. Ověřeno
	// spuštěním: s náhodnými UUID je to jediný z 23 dotazů, který selže, a byla
	// by to falešná porucha, ne nález.
	senderID := "ob00-sender"
	batch := 100
	ttl := 300
	seed := db.SeedCampaign(t, "sending")
	campaignID := seed.CampaignID
	workspaceID := seed.WorkspaceID
	ids := []uuid.UUID{uuid.New()}
	times := []time.Time{time.Now().UTC()}
	emails := []string{"nikdo@example.invalid"}
	prints := [][]byte{make([]byte, 32)}
	pauseReason := []byte(`{"code":"provider_unavailable","source":"sender","at":"2026-07-31T14:22:31Z"}`)

	args := map[string][]any{
		"active_campaigns":        {},
		"campaign_header":         {campaignID},
		"campaign_header_no_meta": {campaignID},
		"provider_config":         {uuid.New()},
		"has_compile_meta":        {},
		"claim_batch":             {senderID, batch, ttl, campaignID},
		"claim_test_batch":        {senderID, batch, ttl},
		"heartbeat":               {senderID, ttl, ids, times},
		"reaper_released":         {},
		"reaper_ambiguous":        {"retry", ttl},
		"recovery_pass":           {senderID},
		"release_remaining":       {senderID, ids, times},
		"mark_dispatch_started":   {ids[0], times[0], senderID},
		"result_sent":             {ids[0], times[0], senderID, "provider-id"},
		"result_retry":            {ids[0], times[0], senderID, 30, "network_error", "detail"},
		"result_failed":           {ids[0], times[0], senderID, "message_rejected", "detail"},
		"result_fatal":            {ids[0], times[0], senderID, "provider_auth_failed", "detail"},
		"result_throttled":        {ids[0], times[0], senderID, 5, "detail"},
		"suppression_batch":       {workspaceID, emails, prints},
		"pause_campaign":          {campaignID, pauseReason},
		"skip_suppressed":         {senderID, ids, times},
		// rank tady NENÍ: P03 ho zavedl jako generovaný sloupec, viz komentář
		// u StmtInsertMessageEvent.
		"insert_message_event": {workspaceID, ids[0], times[0], campaignID, uuid.New(),
			"nikdo@example.invalid", "render_failed", []byte(`{}`)},
		"upsert_render_warnings": {workspaceID, campaignID, "missing_value",
			"contact.attr.city", int64(1), []byte(`[]`)},
	}

	// campaigns.compile_meta je NEPOVINNÝ sloupec a v dnešním schématu P03
	// NEEXISTUJE. StmtCampaignHeader ho vybírá, takže proti skutečné databázi
	// skončí chybou 42703, a je to správné chování, ne vada dotazu: sender si
	// právě proto zjišťuje přítomnost sloupce při startu a přepíná na variantu
	// bez něj. OB-00 musí dělat totéž, jinak by hlásil poruchu u zdravého
	// systému. Ověřeno spuštěním: proti schématu bez sloupce je to jediný
	// z dotazů, který selže.
	var hasMeta int
	if err := db.Sender.QueryRow(ctx, outbox.StmtHasCompileMeta).Scan(&hasMeta); err != nil {
		t.Fatalf("zjištění sloupce compile_meta selhalo: %v", err)
	}
	skip := map[string]string{}
	if hasMeta == 0 {
		skip["campaign_header"] = "campaigns.compile_meta ve schématu není, platí varianta campaign_header_no_meta"
	} else {
		skip["campaign_header_no_meta"] = "campaigns.compile_meta ve schématu je, platí varianta campaign_header"
	}

	all := outbox.AllStatements()
	names := make([]string, 0, len(all))
	for name := range all {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			a, ok := args[name]
			if !ok {
				t.Fatalf("dotaz %q nemá v OB-00 argumenty. Nový dotaz musí dostat výplňové argumenty, jinak se nespustí", name)
			}
			// Vynechává se PRÁVĚ JEDNA ze dvou variant hlavičky kampaně a důvod
			// se vypíše. Přeskočení se nezapisuje natvrdo do seznamu: odvozuje
			// se z toho, co je opravdu ve schématu.
			if why, skipped := skip[name]; skipped {
				t.Skipf("%s", why)
			}
			// Připojení je pod rolí mlain_sender. Kdyby běželo pod migrátorem,
			// zamaskovalo by to chybějící politiku sender_bypass (AK-20.5).
			rows, err := db.Sender.Query(ctx, all[name], a...)
			if err != nil {
				t.Fatalf("dotaz %q se nespustil: %v", name, err)
			}
			defer rows.Close()
			for rows.Next() {
			}
			if err := rows.Err(); err != nil {
				t.Fatalf("dotaz %q selhal při čtení výsledku: %v", name, err)
			}
		})
	}
}
