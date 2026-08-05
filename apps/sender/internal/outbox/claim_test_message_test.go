//go:build integration

package outbox_test

import (
	"context"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

// AK-4.9, AK-19.1: testovací odeslání se claimne i u kampaně ve stavu draft.
func TestTestMessageIsClaimedForDraftCampaign(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "draft")
	db.SeedMessages(t, s, 3, "test")

	batch, err := store(t, db, "sender-A").ClaimNonCampaignBatch(context.Background(), 20, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 3 {
		t.Fatalf("claim testovacích zpráv vrátil %d řádků, čekám 3", len(batch))
	}
	if !batch[0].IsTest() {
		t.Fatal("claimnutá zpráva se netváří jako testovací")
	}
}

// Běžný claim testovací zprávy nebere, mají vlastní dotaz.
func TestRegularClaimIgnoresTestMessages(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 4, "test")
	db.SeedMessages(t, s, 2, "campaign")

	batch, err := store(t, db, "sender-A").ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 2 {
		t.Fatalf("běžný claim vrátil %d řádků, čekám 2", len(batch))
	}
	for _, m := range batch {
		if m.IsTest() {
			t.Fatal("běžný claim vzal testovací zprávu")
		}
	}
}

// Testovací odeslání u smazané kampaně se neclaimne.
func TestTestClaimSkipsDeletedCampaign(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "draft")
	db.SeedMessages(t, s, 3, "test")
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE campaigns SET deleted_at = now() WHERE id = $1`, s.CampaignID); err != nil {
		t.Fatal(err)
	}
	batch, err := store(t, db, "sender-A").ClaimNonCampaignBatch(context.Background(), 20, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 0 {
		t.Fatalf("claim vzal %d testovacích zpráv u smazané kampaně", len(batch))
	}
}
