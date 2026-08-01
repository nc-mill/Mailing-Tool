//go:build integration

package outbox_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

func ring(t *testing.T, previous string) *keyring.Keyring {
	t.Helper()
	kr, err := keyring.Parse("2:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", previous)
	if err != nil {
		t.Fatal(err)
	}
	return kr
}

// AK-4.13: po claimu se pustí JEDEN dotaz na celou dávku a nalezené adresy
// přejdou na skipped s error_code = 'suppressed'.
func TestSuppressionFiltersByEmail(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 3, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	blocked := batch[1]
	if _, err := db.Admin.Exec(context.Background(),
		`INSERT INTO suppressions (id, workspace_id, email, fingerprint, fingerprint_key_id, reason, source)
		 VALUES ($1, $2, $3, '\x00'::bytea, 2, 'manual', 'ui')`,
		uuid.New(), s.WorkspaceID, blocked.Email); err != nil {
		t.Fatal(err)
	}

	kept, skipped, err := st.FilterSuppressed(context.Background(), ring(t, ""), s.WorkspaceID, batch)
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 2 || len(skipped) != 1 {
		t.Fatalf("kept=%d skipped=%d, čekám 2 a 1", len(kept), len(skipped))
	}
	row := db.Read(t, blocked.Key.ID, blocked.Key.CreatedAt)
	if row.Status != "skipped" {
		t.Fatalf("status = %q, chci skipped", row.Status)
	}
	if row.ErrorCode == nil || *row.ErrorCode != "suppressed" {
		t.Fatalf("error_code = %v, chci suppressed", row.ErrorCode)
	}
}

// AK-4.13 druhá polovina: adresa se najde jen podle otisku, a to i pro otisk
// STARÉHO pokolení klíče.
//
// suppressions.email je v P03 `citext NOT NULL`, takže po výmazu podle GDPR
// tam NENÍ NULL, ale zástupná hodnota. Původní znění tohohle testu vkládalo
// email = NULL a proti skutečnému schématu by skončilo na porušení NOT NULL.
// Funkčně se nemění nic: adresa je nedohledatelná stejně, protože zástupná
// hodnota se s žádným příjemcem neshoduje, a jediná cesta zůstává přes otisk.
func TestSuppressionFindsByOldGenerationFingerprint(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 2, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	blocked := batch[0]

	// Otisk vznikl pokolením 1, aktuální je pokolení 2.
	old, err := keyring.Parse("1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", "")
	if err != nil {
		t.Fatal(err)
	}
	prints, err := old.SuppressionFingerprints(blocked.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Admin.Exec(context.Background(),
		`INSERT INTO suppressions (id, workspace_id, email, fingerprint, fingerprint_key_id, reason, source)
		 VALUES ($1, $2, $3, $4, 1, 'gdpr_erasure', 'gdpr')`,
		uuid.New(), s.WorkspaceID, "erased+"+uuid.NewString()+"@invalid", prints[0]); err != nil {
		t.Fatal(err)
	}

	kr := ring(t, "1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
	kept, skipped, err := st.FilterSuppressed(context.Background(), kr, s.WorkspaceID, batch)
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 1 || len(kept) != 1 {
		t.Fatalf("kept=%d skipped=%d, čekám 1 a 1. Otisk starého pokolení se musí najít, "+
			"jinak by se smazaný člověk vrátil prvním dalším importem", len(kept), len(skipped))
	}
}

// Odebraný záznam (removed_at IS NOT NULL) neblokuje.
func TestSuppressionIgnoresRemovedEntries(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := store(t, db, "sender-A")
	batch, _ := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if _, err := db.Admin.Exec(context.Background(),
		`INSERT INTO suppressions (id, workspace_id, email, fingerprint, fingerprint_key_id, reason, source, removed_at)
		 VALUES ($1, $2, $3, '\x00'::bytea, 2, 'manual', 'ui', now())`,
		uuid.New(), s.WorkspaceID, batch[0].Email); err != nil {
		t.Fatal(err)
	}
	kept, skipped, err := st.FilterSuppressed(context.Background(), ring(t, ""), s.WorkspaceID, batch)
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 1 || len(skipped) != 0 {
		t.Fatalf("kept=%d skipped=%d, odebraný záznam nesmí blokovat", len(kept), len(skipped))
	}
}

func TestSuppressionOnEmptyBatchDoesNothing(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	kept, skipped, err := store(t, db, "sender-A").
		FilterSuppressed(context.Background(), ring(t, ""), s.WorkspaceID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 0 || len(skipped) != 0 {
		t.Fatal("prázdná dávka nemá co filtrovat")
	}
}
