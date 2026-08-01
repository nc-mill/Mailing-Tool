//go:build integration

package outbox_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

func readPauseReason(t *testing.T, db *testsupport.DB, campaignID any) (string, map[string]any) {
	t.Helper()
	var status string
	var raw []byte
	err := db.Admin.QueryRow(context.Background(),
		`SELECT status, pause_reason FROM campaigns WHERE id = $1`, campaignID).Scan(&status, &raw)
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if raw != nil {
		if err := json.Unmarshal(raw, &obj); err != nil {
			t.Fatalf("pause_reason není platný JSON: %v", err)
		}
	}
	return status, obj
}

// OB-16, AK-20.7, AK-20.8
func TestPauseFromSendingSucceedsAndWritesContractualReason(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	st := store(t, db, "mlain-sender-7f3a")

	ok, err := st.PauseCampaign(context.Background(), s.CampaignID, outbox.PauseReason{
		Code:     outbox.PauseProviderUnavailable,
		Detail:   "provider_auth_failed: SignatureDoesNotMatch",
		SenderID: "mlain-sender-7f3a",
		At:       time.Date(2026, 7, 31, 14, 22, 31, 0, time.UTC),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("pozastavení neprošlo")
	}
	status, obj := readPauseReason(t, db, s.CampaignID)
	if status != "paused" {
		t.Fatalf("status = %q, chci paused", status)
	}
	if obj["code"] != "provider_unavailable" {
		t.Errorf("code = %v", obj["code"])
	}
	if obj["source"] != "sender" {
		t.Errorf("source = %v, u senderu je vždycky sender", obj["source"])
	}
	if obj["at"] != "2026-07-31T14:22:31Z" {
		t.Errorf("at = %v, chci ISO 8601 v UTC", obj["at"])
	}
	if obj["sender_id"] != "mlain-sender-7f3a" {
		t.Errorf("sender_id = %v", obj["sender_id"])
	}
}

// Ve výčtu musí být i queueing, jinak by kampaň v queueing s rozbitými
// credentials pozastavit nešla a sender by ji donekonečna recykloval.
func TestPauseFromQueueingSucceeds(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "queueing")
	ok, err := store(t, db, "sender-A").PauseCampaign(context.Background(), s.CampaignID, outbox.PauseReason{
		Code: outbox.PauseCredentialsUndecryptable, At: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("kampaň ve stavu queueing musí jít pozastavit")
	}
}

// OB-16 druhá polovina: tentýž UPDATE nad kampaní, která už není v odesílacím
// stavu, ovlivní 0 řádků a NENÍ to chyba.
func TestPauseOnFinishedCampaignAffectsNoRowsAndIsNotAnError(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sent")
	ok, err := store(t, db, "sender-A").PauseCampaign(context.Background(), s.CampaignID, outbox.PauseReason{
		Code: outbox.PauseProviderUnavailable, At: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("nula ovlivněných řádků nesmí být chyba: %v", err)
	}
	if ok {
		t.Fatal("pozastavení mělo ovlivnit 0 řádků")
	}
	if status, _ := readPauseReason(t, db, s.CampaignID); status != "sent" {
		t.Fatalf("status = %q, kampaň se neměla změnit", status)
	}
}

// OB-17, AK-20.7: pokus o zápis do jiného sloupce campaigns skončí chybou
// oprávnění ze sloupcového grantu.
func TestSenderCannotWriteOtherCampaignColumns(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	_, err := db.Sender.Exec(context.Background(),
		`UPDATE campaigns SET subject = 'unesený předmět' WHERE id = $1`, s.CampaignID)
	if err == nil {
		t.Fatal("sender přepsal subject, sloupcový grant nefunguje")
	}
}

// OB-17 druhá polovina: sender nesmí kampaň rozjet zpět.
func TestSenderCannotResumeCampaign(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "paused")
	tag, err := db.Sender.Exec(context.Background(),
		`UPDATE campaigns SET status = 'sending' WHERE id = $1 AND status IN ('queueing','sending')`,
		s.CampaignID)
	if err != nil {
		t.Fatal(err)
	}
	if tag.RowsAffected() != 0 {
		t.Fatal("podmínka ve WHERE musí odpauzování zabránit na úrovni databáze")
	}
}

// Sender smí zapsat jen svoje čtyři kódy.
func TestPauseRejectsCodesOutsideSenderRegistry(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	_, err := store(t, db, "sender-A").PauseCampaign(context.Background(), s.CampaignID, outbox.PauseReason{
		Code: "user", At: time.Now().UTC(),
	})
	if err == nil {
		t.Fatal("kód user patří aplikaci, sender ho zapsat nesmí")
	}
}
