//go:build integration

package testsupport

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Seed je jeden založený projekt s kampaní a providerem.
type Seed struct {
	WorkspaceID uuid.UUID
	CampaignID  uuid.UUID
	ProviderID  uuid.UUID
	// CreatedAt je audience_built_at zaokrouhlené na sekundy. Invariant I1
	// vyžaduje, aby ho měly VŠECHNY zprávy jednoho materializačního běhu shodné,
	// a zaokrouhlení dělá z hodnoty přesný uint32 pro trackovací token.
	CreatedAt time.Time
}

// SeedCampaign založí workspace, providera a kampaň v daném stavu.
func (db *DB) SeedCampaign(t *testing.T, status string) Seed {
	t.Helper()
	ctx := context.Background()
	s := Seed{
		WorkspaceID: uuid.New(),
		CampaignID:  uuid.New(),
		ProviderID:  uuid.New(),
		CreatedAt:   time.Now().UTC().Truncate(time.Second),
	}
	// slug je v P03 NOT NULL bez výchozí hodnoty a je unikátní, takže se odvozuje
	// z identifikátoru: dva projekty v jednom testu se jinak srazí na unikátním indexu.
	if _, err := db.Admin.Exec(ctx,
		`INSERT INTO workspaces (id, name, slug) VALUES ($1, 'test', $2)`,
		s.WorkspaceID, "test-"+s.WorkspaceID.String()[:18]); err != nil {
		t.Fatal(err)
	}
	// name, status a sending_enabled jsou v P03 povinné nebo je čte
	// StmtProviderConfig. Vynechaný sloupec by se projevil až tím, že by se dotaz
	// nespustil, ne chybou fixture.
	if _, err := db.Admin.Exec(ctx,
		`INSERT INTO sending_providers (id, workspace_id, name, type, config_encrypted,
		                                status, sending_enabled, quota_max_send_rate, verified_at)
		 VALUES ($1, $2, 'testovací provider', 'ses', 'enc:v1:placeholder',
		         'ready', true, 50, now())`,
		s.ProviderID, s.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	// audience_built_at MUSÍ být vyplněné dřív, než vznikne první zpráva:
	// složený cizí klíč fk_messages__campaign_audience míří na
	// campaigns (id, audience_built_at) a zpráva s created_at = now() by skončila
	// chybou 23503. Ověřeno spuštěním na PostgreSQL 18.
	if _, err := db.Admin.Exec(ctx,
		`INSERT INTO campaigns (id, workspace_id, name, status, subject, from_name, from_email,
		                        compiled_html, compiled_text, provider_id, revision, audience_built_at)
		 VALUES ($1, $2, 'testovací kampaň', $3, 'Předmět', 'Jan Novák', 'newsletter@example.cz',
		         '<!DOCTYPE html><html><body>ahoj<!--ML_OPEN_PIXEL--></body></html>', 'ahoj',
		         $4, 1, $5)`,
		s.CampaignID, s.WorkspaceID, status, s.ProviderID, s.CreatedAt); err != nil {
		t.Fatal(err)
	}
	return s
}

// SeedMessages vloží n zpráv ve stavu pending. Vrací jejich identifikátory
// v pořadí vložení.
func (db *DB) SeedMessages(t *testing.T, s Seed, n int, kind string) []uuid.UUID {
	t.Helper()
	ctx := context.Background()
	out := make([]uuid.UUID, 0, n)
	for i := 0; i < n; i++ {
		id := uuid.New()
		contact := uuid.New()
		if _, err := db.Admin.Exec(ctx,
			`INSERT INTO messages (id, workspace_id, campaign_id, kind, contact_id, email,
			                       render_data, status, created_at, next_attempt_at)
			 VALUES ($1, $2, $3, $4, $5, $6, '{"contact":{"first_name":"Jana"}}'::jsonb,
			         'pending', $7, now())`,
			id, s.WorkspaceID, s.CampaignID, kind, contact,
			"prijemce"+uuid.NewString()[:8]+"@example.cz", s.CreatedAt); err != nil {
			t.Fatal(err)
		}
		out = append(out, id)
	}
	return out
}

// MessageRow je stav jednoho řádku, jak ho testy potřebují ověřovat.
type MessageRow struct {
	Status            string
	ClaimedBy         *string
	ClaimExpiresAt    *time.Time
	DispatchStartedAt *time.Time
	Attempts          int16
	AmbiguousCount    int16
	ErrorCode         *string
	ProviderMessageID *string
	SentAt            *time.Time
	NextAttemptAt     time.Time
}

// Read načte řádek přes admin připojení, aby čtení v testu nezáviselo na tom,
// co zrovna vidí sender.
func (db *DB) Read(t *testing.T, id uuid.UUID, createdAt time.Time) MessageRow {
	t.Helper()
	var r MessageRow
	err := db.Admin.QueryRow(context.Background(),
		`SELECT status, claimed_by, claim_expires_at, dispatch_started_at, attempts,
		        ambiguous_count, error_code, provider_message_id, sent_at, next_attempt_at
		 FROM messages WHERE id = $1 AND created_at = $2`, id, createdAt).
		Scan(&r.Status, &r.ClaimedBy, &r.ClaimExpiresAt, &r.DispatchStartedAt, &r.Attempts,
			&r.AmbiguousCount, &r.ErrorCode, &r.ProviderMessageID, &r.SentAt, &r.NextAttemptAt)
	if err != nil {
		t.Fatalf("čtení zprávy %s: %v", id, err)
	}
	return r
}
