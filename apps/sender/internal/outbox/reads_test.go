//go:build integration

package outbox_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

func TestCampaignHeaderIsLoadedWithAllContractColumns(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	st := store(t, db, "sender-A")

	if err := st.DetectCompileMeta(context.Background()); err != nil {
		t.Fatal(err)
	}
	raw, err := st.CampaignHeader(context.Background(), s.CampaignID)
	if err != nil {
		t.Fatal(err)
	}
	if raw.ID != s.CampaignID {
		t.Errorf("ID = %s", raw.ID)
	}
	if raw.FromEmail != "newsletter@example.cz" {
		t.Errorf("FromEmail = %q", raw.FromEmail)
	}
	if raw.Revision != 1 {
		t.Errorf("Revision = %d", raw.Revision)
	}
	if raw.CompiledHTML == "" {
		t.Error("compiled_html je prázdné")
	}
}

// Kontrola V4 se přeskočí, když kampaň nenese kompilační metadata.
func TestCampaignHeaderReportsMissingClickMarkerCount(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	st := store(t, db, "sender-A")
	if err := st.DetectCompileMeta(context.Background()); err != nil {
		t.Fatal(err)
	}
	raw, err := st.CampaignHeader(context.Background(), s.CampaignID)
	if err != nil {
		t.Fatal(err)
	}
	if raw.ClickMarkerCount != nil {
		t.Fatal("bez naplněného compile_meta má být hodnota prázdná")
	}
}

func TestCampaignHeaderReadsClickMarkerCountWhenPresent(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	// Sloupec vlastní P13 a v migracích zatím není. Test si ho proto doplní sám:
	// ověřuje větev "sloupec existuje", ne to, jestli ho už někdo přidal.
	// Až ho migrace ponesou, ADD COLUMN IF NOT EXISTS neudělá nic.
	if _, err := db.Admin.Exec(context.Background(),
		`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS compile_meta jsonb`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE campaigns SET compile_meta = '{"clickMarkerCount": 3}'::jsonb WHERE id = $1`,
		s.CampaignID); err != nil {
		t.Fatal(err)
	}
	st := store(t, db, "sender-A")
	if err := st.DetectCompileMeta(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !st.HasCompileMeta() {
		t.Fatal("sloupec byl právě doplněn, detekce ho musí vidět")
	}
	raw, err := st.CampaignHeader(context.Background(), s.CampaignID)
	if err != nil {
		t.Fatal(err)
	}
	if raw.ClickMarkerCount == nil || *raw.ClickMarkerCount != 3 {
		t.Fatalf("ClickMarkerCount = %v, chci 3", raw.ClickMarkerCount)
	}
}

// Když sloupec ve schématu chybí, sender to pozná při startu a kontrolu vypne.
// Tichá varianta, kdy by kontrola prostě neběžela a nikdo by se to nedozvěděl,
// je vyloučená právě tímhle testem.
func TestMissingCompileMetaColumnIsDetectedAtStartup(t *testing.T) {
	db := testsupport.New(t)
	// IF EXISTS, protože sloupec vlastní P13 a v migracích zatím není. Test má
	// ověřit chování BEZ sloupce, ne to, že ho někdo předtím přidal.
	if _, err := db.Admin.Exec(context.Background(),
		`ALTER TABLE campaigns DROP COLUMN IF EXISTS compile_meta`); err != nil {
		t.Fatal(err)
	}
	st := store(t, db, "sender-A")
	if err := st.DetectCompileMeta(context.Background()); err != nil {
		t.Fatal(err)
	}
	if st.HasCompileMeta() {
		t.Fatal("sloupec neexistuje, příznak má být false")
	}
	s := db.SeedCampaign(t, "sending")
	raw, err := st.CampaignHeader(context.Background(), s.CampaignID)
	if err != nil {
		t.Fatalf("bez sloupce musí načtení hlavičky pořád fungovat: %v", err)
	}
	if raw.ClickMarkerCount != nil {
		t.Fatal("bez sloupce nemůže být hodnota vyplněná")
	}
}

func TestProviderDescriptorIsLoaded(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	st := store(t, db, "sender-A")
	d, err := st.ProviderRow(context.Background(), s.ProviderID)
	if err != nil {
		t.Fatal(err)
	}
	if d.WorkspaceID != s.WorkspaceID {
		t.Errorf("WorkspaceID = %s", d.WorkspaceID)
	}
	if d.ConfigEncrypted == "" {
		t.Error("config_encrypted je prázdné")
	}
	if d.QuotaMaxSendRate == nil || *d.QuotaMaxSendRate != 50 {
		t.Errorf("QuotaMaxSendRate = %v", d.QuotaMaxSendRate)
	}
}

func TestMissingCampaignIsNotFound(t *testing.T) {
	db := testsupport.New(t)
	st := store(t, db, "sender-A")
	if err := st.DetectCompileMeta(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CampaignHeader(context.Background(), uuid.New()); err == nil {
		t.Fatal("neexistující kampaň musí být chyba")
	}
}
