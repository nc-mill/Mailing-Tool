//go:build integration

package outbox_test

import (
	"context"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

func TestMarkDispatchStartedIncrementsAttempts(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := st.MarkDispatchStarted(context.Background(), batch[0].Key)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("marker neprošel, přestože claim drží")
	}
	row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if row.Attempts != 1 {
		t.Errorf("attempts = %d, chci 1", row.Attempts)
	}
	if row.DispatchStartedAt == nil {
		t.Error("dispatch_started_at zůstal prázdný, marker se nezapsal")
	}
}

// OB-19, AK-5.13: závod končí u D1. Sender A drží claim, reaper ho uvolní,
// claimne ho sender B, teprve pak se A pokusí o D1. D1 ovlivní 0 řádků a A
// NEODESÍLÁ NIC.
func TestOB19RaceEndsAtD1(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	a := store(t, db, "sender-A")
	b := store(t, db, "sender-B")

	batchA, err := a.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET claim_expires_at = now() - interval '1 second' WHERE status = 'claimed'`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ReapReleased(context.Background()); err != nil {
		t.Fatal(err)
	}
	batchB, err := b.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batchB) != 1 {
		t.Fatalf("sender B claimnul %d zpráv, čekám 1", len(batchB))
	}

	ok, err := a.MarkDispatchStarted(context.Background(), batchA[0].Key)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("D1 senderu A prošel, přestože už zprávu nevlastní. " +
			"Bez stráže claimed_by se zpráva odešle dvakrát")
	}
}

// OB-20, AK-5.12: závod končí u D3. Zpráva už je u providera, ale claim mezitím
// převzal někdo jiný. D3 ovlivní 0 řádků, A nezapisuje NIC a loguje
// claim_lost_after_dispatch. Ve výsledku existuje právě jeden zápis sent
// a právě jedno provider_message_id.
func TestOB20RaceEndsAtD3(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	a := store(t, db, "sender-A")
	b := store(t, db, "sender-B")

	batchA, err := a.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := a.MarkDispatchStarted(context.Background(), batchA[0].Key); err != nil || !ok {
		t.Fatalf("D1 senderu A: ok=%v err=%v", ok, err)
	}
	// A odeslal zprávu. Mezitím mu claim vzal reaper B a převzal ho sender B.
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
		        claim_expires_at = NULL, dispatch_started_at = NULL WHERE status = 'claimed'`); err != nil {
		t.Fatal(err)
	}
	batchB, err := b.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := b.MarkDispatchStarted(context.Background(), batchB[0].Key); err != nil || !ok {
		t.Fatalf("D1 senderu B: ok=%v err=%v", ok, err)
	}
	if ok, err := b.RecordSent(context.Background(), batchB[0].Key, "msg-from-B"); err != nil || !ok {
		t.Fatalf("D3 senderu B: ok=%v err=%v", ok, err)
	}

	ok, err := a.RecordSent(context.Background(), batchA[0].Key, "msg-from-A")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("D3 senderu A prošel a přepsal výsledek. Bez stráže claimed_by v D3 " +
			"existuje závod, na jehož konci má zpráva cizí provider_message_id")
	}
	row := db.Read(t, batchA[0].Key.ID, batchA[0].Key.CreatedAt)
	if row.Status != "sent" {
		t.Fatalf("status = %q, chci sent", row.Status)
	}
	if row.ProviderMessageID == nil || *row.ProviderMessageID != "msg-from-B" {
		t.Fatalf("provider_message_id = %v, chci msg-from-B", row.ProviderMessageID)
	}
}

// Z1 v čisté podobě. TestOB20 sám o sobě stráž claimed_by v D3 NEPROKÁŽE:
// v jeho pořadí kroků stihne sender B zapsat výsledek dřív, než se o zápis
// pokusí A, takže řádek už není claimed a odmítne ho podmínka na status.
// Test proto zůstane zelený i po odebrání AND claimed_by = $3, ověřeno spuštěním.
//
// Skutečné okno závodu je jiné: A odešle, jeho claim vyprší, reaper A ho uvolní,
// zprávu claimne B a JEŠTĚ NEDOPÍŠE výsledek. V tu chvíli je řádek claimed
// a jediné, co dělí zprávu od cizího provider_message_id, je stráž claimed_by.
func TestD3GuardIsClaimedByNotOnlyStatus(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	a := store(t, db, "sender-A")
	b := store(t, db, "sender-B")

	batchA, err := a.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := a.MarkDispatchStarted(context.Background(), batchA[0].Key); err != nil || !ok {
		t.Fatalf("D1 senderu A: ok=%v err=%v", ok, err)
	}
	// Claim senderu A vypršel a reaper A ho vrátil do fronty.
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
		        claim_expires_at = NULL, dispatch_started_at = NULL WHERE status = 'claimed'`); err != nil {
		t.Fatal(err)
	}
	batchB, err := b.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batchB) != 1 {
		t.Fatalf("sender B claimnul %d zpráv, čekám 1", len(batchB))
	}
	// B zprávu drží a výsledek ještě NEZAPSAL. Řádek je claimed, takže podmínka
	// na status tady nechrání vůbec nic.
	if row := db.Read(t, batchA[0].Key.ID, batchA[0].Key.CreatedAt); row.Status != "claimed" {
		t.Fatalf("status = %q, scénář vyžaduje claimed", row.Status)
	}

	ok, err := a.RecordSent(context.Background(), batchA[0].Key, "msg-from-A")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("D3 senderu A přepsal výsledek zprávy, kterou drží sender B. " +
			"Chybí stráž claimed_by v StmtResultSent")
	}
	row := db.Read(t, batchA[0].Key.ID, batchA[0].Key.CreatedAt)
	if row.Status != "claimed" || row.ClaimedBy == nil || *row.ClaimedBy != "sender-B" {
		t.Fatalf("status = %q, claimed_by = %v; zpráva měla zůstat senderu B", row.Status, row.ClaimedBy)
	}
	if row.ProviderMessageID != nil {
		t.Fatalf("provider_message_id = %v, zapsal ho cizí sender", *row.ProviderMessageID)
	}
}

func TestRecordRetryReturnsMessageToQueue(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, _ := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if ok, err := st.MarkDispatchStarted(context.Background(), batch[0].Key); err != nil || !ok {
		t.Fatalf("D1: ok=%v err=%v", ok, err)
	}
	if ok, err := st.RecordRetry(context.Background(), batch[0].Key, 30, "network_error", "spojení spadlo"); err != nil || !ok {
		t.Fatalf("D3b: ok=%v err=%v", ok, err)
	}
	row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if row.Status != "pending" {
		t.Errorf("status = %q, chci pending", row.Status)
	}
	if row.Attempts != 1 {
		t.Errorf("attempts = %d, D3b pokus nevrací", row.Attempts)
	}
	if row.DispatchStartedAt != nil {
		t.Error("dispatch_started_at se má smazat, o selhání máme důkaz")
	}
	if row.ErrorCode == nil || *row.ErrorCode != "network_error" {
		t.Errorf("error_code = %v", row.ErrorCode)
	}
}

// AK-7.4: zpráva odmítnutá throttlingem nezvýší attempts. Měří se hodnotou
// v databázi před a po, ne stavem v paměti senderu.
func TestRecordThrottledGivesTheAttemptBack(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, _ := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	before := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt).Attempts

	if ok, err := st.MarkDispatchStarted(context.Background(), batch[0].Key); err != nil || !ok {
		t.Fatalf("D1: ok=%v err=%v", ok, err)
	}
	if ok, err := st.RecordThrottled(context.Background(), batch[0].Key, 5, "TooManyRequestsException"); err != nil || !ok {
		t.Fatalf("D3e: ok=%v err=%v", ok, err)
	}
	after := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if after.Attempts != before {
		t.Fatalf("attempts %d → %d, throttling se do pokusů nezapočítává", before, after.Attempts)
	}
	if after.ErrorCode == nil || *after.ErrorCode != "rate_limited" {
		t.Fatalf("error_code = %v, chci rate_limited", after.ErrorCode)
	}
}

// Fatální chyba vrací zprávu do fronty a pokus jí vrací zpět. ŽÁDNÁ chyba
// třídy Fatal nesmí zprávu označit jako failed.
func TestRecordFatalNeverFailsTheMessage(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, _ := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if ok, err := st.MarkDispatchStarted(context.Background(), batch[0].Key); err != nil || !ok {
		t.Fatalf("D1: ok=%v err=%v", ok, err)
	}
	if ok, err := st.RecordFatal(context.Background(), batch[0].Key, "credentials_undecryptable", "crypto_auth_failed"); err != nil || !ok {
		t.Fatalf("D3d: ok=%v err=%v", ok, err)
	}
	row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if row.Status != "pending" {
		t.Fatalf("status = %q, fatální chyba zastavuje kampaň, ne zprávu", row.Status)
	}
	if row.Attempts != 0 {
		t.Fatalf("attempts = %d, fatální chyba nesmí spotřebovat pokus", row.Attempts)
	}
}

func TestRecordFailedIsTerminal(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, _ := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if ok, err := st.MarkDispatchStarted(context.Background(), batch[0].Key); err != nil || !ok {
		t.Fatalf("D1: ok=%v err=%v", ok, err)
	}
	if ok, err := st.RecordFailed(context.Background(), batch[0].Key, "smtp_recipient_rejected", "550: no such user"); err != nil || !ok {
		t.Fatalf("D3c: ok=%v err=%v", ok, err)
	}
	row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if row.Status != "failed" {
		t.Fatalf("status = %q, chci failed", row.Status)
	}
	if row.Attempts != 1 {
		t.Fatalf("attempts = %d, chci 1", row.Attempts)
	}
}
