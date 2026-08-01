//go:build integration

package outbox_test

import (
	"context"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

// AK-4.3: řádek claimed s prošlým claimem a bez markeru se vrátí na pending
// BEZ značky ambiguous_dispatch.
func TestReaperAReleasesUnstartedRows(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 2, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET claim_expires_at = now() - interval '1 second' WHERE status = 'claimed'`); err != nil {
		t.Fatal(err)
	}

	n, err := st.ReapReleased(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("reaper A uvolnil %d řádků, čekám 2", n)
	}
	row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if row.Status != "pending" {
		t.Fatalf("status = %q, chci pending", row.Status)
	}
	if row.ErrorCode != nil {
		t.Fatalf("error_code = %v, reaper A značku nedává", *row.ErrorCode)
	}
	if row.Attempts != 0 {
		t.Fatalf("attempts = %d, reaper A je nemění", row.Attempts)
	}
}

// AK-4.4, OB-03: rozpracovaná zpráva po dvojnásobku TTL dostane ambiguous_dispatch,
// ambiguous_count o jedna vyšší a vynulovaný dispatch_started_at. Politika retry
// a ambiguous_count 0 před inkrementem znamená pending.
func TestReaperBFirstPassWithRetryPolicy(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET dispatch_started_at = now(), attempts = 1,
		        claim_expires_at = now() - interval '400 seconds' WHERE status = 'claimed'`); err != nil {
		t.Fatal(err)
	}

	n, err := st.ReapAmbiguous(context.Background(), "retry", 300)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("reaper B zpracoval %d řádků, čekám 1", n)
	}
	row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if row.Status != "pending" {
		t.Fatalf("status = %q, při politice retry a prvním výskytu chci pending", row.Status)
	}
	if row.ErrorCode == nil || *row.ErrorCode != "ambiguous_dispatch" {
		t.Fatalf("error_code = %v, chci ambiguous_dispatch", row.ErrorCode)
	}
	if row.AmbiguousCount != 1 {
		t.Fatalf("ambiguous_count = %d, chci 1", row.AmbiguousCount)
	}
	if row.DispatchStartedAt != nil {
		t.Fatal("dispatch_started_at se musí vynulovat, jinak by řádek při dalším průchodu " +
			"sebral zase dotaz B místo dotazu A")
	}
	if row.Attempts != 1 {
		t.Fatalf("attempts = %d, reaper B je nemění", row.Attempts)
	}
}

// AK-5.6, OB-04: druhý nejednoznačný průchod končí na failed bez ohledu na politiku.
func TestReaperBSecondPassAlwaysFails(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	// AK-5.7: mezi průchody proběhl běžný neúspěch, který přepsal error_code.
	// Bez samostatného čítače by se značka ztratila a zpráva by mohla cyklit.
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET dispatch_started_at = now(), ambiguous_count = 1,
		        error_code = 'network_error',
		        claim_expires_at = now() - interval '400 seconds' WHERE status = 'claimed'`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ReapAmbiguous(context.Background(), "retry", 300); err != nil {
		t.Fatal(err)
	}
	row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if row.Status != "failed" {
		t.Fatalf("status = %q, druhý průchod musí skončit na failed i při politice retry", row.Status)
	}
	if row.AmbiguousCount != 2 {
		t.Fatalf("ambiguous_count = %d, chci 2", row.AmbiguousCount)
	}
}

// Politika fail končí na failed už při prvním výskytu.
func TestReaperBFailPolicyFailsOnFirstPass(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET dispatch_started_at = now(),
		        claim_expires_at = now() - interval '400 seconds' WHERE status = 'claimed'`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ReapAmbiguous(context.Background(), "fail", 300); err != nil {
		t.Fatal(err)
	}
	if row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt); row.Status != "failed" {
		t.Fatalf("status = %q, politika fail musí končit na failed", row.Status)
	}
}

// AK-4.6, regrese na K2: zpráva s živým heartbeatem a vyplněným
// dispatch_started_at NENÍ reaperem nikdy uvolněná, ani po deseti tikách.
// Tenhle test odhalí obrácené znaménko v podmínce.
func TestReaperBNeverStealsLiveDispatch(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET dispatch_started_at = now() WHERE status = 'claimed'`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		if _, err := st.Heartbeat(context.Background(), batch, 300); err != nil {
			t.Fatal(err)
		}
		n, err := st.ReapAmbiguous(context.Background(), "retry", 300)
		if err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("tik %d: reaper B sebral %d právě odesílaných zpráv. "+
				"Skoro jistě je v podmínce PLUS místo MÍNUS", i, n)
		}
	}
	if row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt); row.Status != "claimed" {
		t.Fatalf("status = %q, zpráva měla zůstat claimed", row.Status)
	}
}
