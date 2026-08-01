//go:build integration

package outbox_test

import (
	"context"
	"testing"
	"time"

	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

// AK-4.5: běžící dávka delší než TTL claimu není reaperem sebrána, protože
// heartbeat obnovuje claim_expires_at.
func TestHeartbeatExtendsOwnClaims(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 3, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	before := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)

	time.Sleep(1100 * time.Millisecond)
	n, err := st.Heartbeat(context.Background(), batch, 600)
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("heartbeat prodloužil %d claimů, čekám 3", n)
	}
	after := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt)
	if !after.ClaimExpiresAt.After(*before.ClaimExpiresAt) {
		t.Fatal("claim_expires_at se neposunul dopředu")
	}
}

// Heartbeat sahá jen na claimy své instance.
func TestHeartbeatIgnoresForeignClaims(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 2, "campaign")
	batch, err := store(t, db, "sender-A").ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	n, err := store(t, db, "sender-B").Heartbeat(context.Background(), batch, 600)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("cizí sender prodloužil %d claimů, čekám 0", n)
	}
}

// AK-6.14: restart s nezměněným SENDER_ID uvolní vlastní zaseknuté řádky bez
// markeru okamžitě, bez čekání na TTL.
func TestRecoveryPassReleasesOwnClaimsImmediately(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 4, "campaign")
	batch, err := store(t, db, "sender-A").ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	// Jedna zpráva má marker, ta se uvolnit NESMÍ.
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET dispatch_started_at = now() WHERE id = $1 AND created_at = $2`,
		batch[0].Key.ID, batch[0].Key.CreatedAt); err != nil {
		t.Fatal(err)
	}

	fresh := store(t, db, "sender-A")
	n, err := fresh.RecoveryPass(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("recovery pass uvolnil %d řádků, čekám 3", n)
	}
	if got := db.Read(t, batch[0].Key.ID, batch[0].Key.CreatedAt); got.Status != "claimed" {
		t.Fatalf("zpráva s markerem má status %q, měla zůstat claimed", got.Status)
	}
	if got := db.Read(t, batch[1].Key.ID, batch[1].Key.CreatedAt); got.Status != "pending" {
		t.Fatalf("zpráva bez markeru má status %q, měla se vrátit na pending", got.Status)
	}
}

// AK-6.12: po SIGTERM se claimnuté zprávy bez markeru vrátí na pending.
func TestReleaseRemainingReturnsUnstartedMessages(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 5, "campaign")
	st := store(t, db, "sender-A")
	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET dispatch_started_at = now() WHERE id = $1 AND created_at = $2`,
		batch[0].Key.ID, batch[0].Key.CreatedAt); err != nil {
		t.Fatal(err)
	}
	n, err := st.ReleaseRemaining(context.Background(), batch)
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Fatalf("uvolněno %d zpráv, čekám 4", n)
	}
	_ = outbox.MessageKey{}
}
