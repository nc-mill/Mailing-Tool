//go:build integration

package outbox_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

func store(t *testing.T, db *testsupport.DB, senderID string) *outbox.Store {
	t.Helper()
	return outbox.NewStore(db.Sender, senderID)
}

// AK-4.1
func TestClaimRespectsBatchSizeAndStampsOwnership(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	ids := db.SeedMessages(t, s, 250, "campaign")
	st := store(t, db, "sender-A")

	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 100 {
		t.Fatalf("claim vrátil %d řádků, čekám 100", len(batch))
	}
	row := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if row.Status != "claimed" {
		t.Errorf("status = %q, chci claimed", row.Status)
	}
	if row.ClaimedBy == nil || *row.ClaimedBy != "sender-A" {
		t.Errorf("claimed_by = %v, chci sender-A", row.ClaimedBy)
	}
	if row.ClaimExpiresAt == nil {
		t.Error("claim_expires_at zůstal prázdný")
	}
	_ = ids
}

// AK-4.11, první polovina: odesílat jde už ve stavu queueing.
func TestClaimWorksForQueueingCampaign(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "queueing")
	db.SeedMessages(t, s, 5, "campaign")
	batch, err := store(t, db, "sender-A").ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 5 {
		t.Fatalf("claim ve stavu queueing vrátil %d řádků, čekám 5", len(batch))
	}
}

// OB-05
func TestPausedCampaignReturnsNothing(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 5, "campaign")
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE campaigns SET status = 'paused' WHERE id = $1`, s.CampaignID); err != nil {
		t.Fatal(err)
	}
	batch, err := store(t, db, "sender-A").ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 0 {
		t.Fatalf("pozastavená kampaň vrátila %d řádků", len(batch))
	}
}

// OB-06
func TestSoftDeletedWorkspaceReturnsNothing(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 5, "campaign")
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE workspaces SET deleted_at = now() WHERE id = $1`, s.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	batch, err := store(t, db, "sender-A").ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 0 {
		t.Fatalf("smazaný workspace vrátil %d řádků", len(batch))
	}
}

// OB-18, AK-4.11 druhá polovina
func TestSoftDeletedCampaignReturnsNothingInBothSteps(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 5, "campaign")
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE campaigns SET deleted_at = now() WHERE id = $1`, s.CampaignID); err != nil {
		t.Fatal(err)
	}
	st := store(t, db, "sender-A")
	active, err := st.ActiveCampaigns(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range active {
		if c.ID == s.CampaignID {
			t.Fatal("krok 1 vrátil smazanou kampaň")
		}
	}
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 0 {
		t.Fatalf("krok 2 vrátil %d řádků u smazané kampaně", len(batch))
	}
}

// AK-4.12. Test musí selhat, když se z claim dotazu odebere podmínka
// AND m.campaign_id IS NOT NULL. Spoléhat na to, že řádek vyhodí spojení
// na campaigns, nestačí.
func TestMessageWithoutCampaignIsNeverClaimed(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	orphan := uuid.New()
	if _, err := db.Admin.Exec(context.Background(),
		`INSERT INTO messages (id, workspace_id, campaign_id, kind, contact_id, email, status, created_at, next_attempt_at)
		 VALUES ($1, $2, NULL, 'campaign', $3, 'sirotek@example.cz', 'pending', $4, now())`,
		orphan, s.WorkspaceID, uuid.New(), s.CreatedAt); err != nil {
		t.Fatal(err)
	}
	batch, err := store(t, db, "sender-A").ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range batch {
		if m.Key.ID == orphan {
			t.Fatal("claim vzal nekampáňovou zprávu")
		}
	}
	row := db.Read(t, orphan, s.CreatedAt)
	if row.Status != "pending" {
		t.Fatalf("nekampáňová zpráva má status %q, měla zůstat pending", row.Status)
	}
}

// AK-4.2: dvě instance si nikdy neclaimnou tentýž řádek.
func TestTwoSendersNeverClaimTheSameRow(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 300, "campaign")
	a := store(t, db, "sender-A")
	b := store(t, db, "sender-B")

	seen := map[uuid.UUID]string{}
	for i := 0; i < 6; i++ {
		for _, pair := range []struct {
			name string
			st   *outbox.Store
		}{{"A", a}, {"B", b}} {
			batch, err := pair.st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
			if err != nil {
				t.Fatal(err)
			}
			for _, m := range batch {
				if prev, dup := seen[m.Key.ID]; dup {
					t.Fatalf("zprávu %s claimnul %s i %s", m.Key.ID, prev, pair.name)
				}
				seen[m.Key.ID] = pair.name
			}
		}
	}
	if len(seen) != 300 {
		t.Fatalf("claimnuto %d z 300 zpráv", len(seen))
	}
}

// Krátká dávka je normální stav, ne chyba. Konec práce se pozná JEN z nuly řádků.
func TestClaimShortBatchIsNormal(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 7, "campaign")
	st := store(t, db, "sender-A")
	first, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 7 {
		t.Fatalf("první dávka má %d řádků, čekám 7", len(first))
	}
	second, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 0 {
		t.Fatalf("druhá dávka má %d řádků, čekám 0", len(second))
	}
}
