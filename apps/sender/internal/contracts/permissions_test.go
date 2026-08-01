//go:build integration

package contracts

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

// AK-20.1, OB-09
func TestSenderCannotReadContacts(t *testing.T) {
	db := testsupport.New(t)
	_, err := db.Sender.Exec(context.Background(), `SELECT * FROM contacts`)
	if err == nil {
		t.Fatal("sender přečetl contacts. Bezpečnostní hranice neexistuje")
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("čekám permission denied, dostal jsem %v", err)
	}
}

// AK-4.10, AK-20.3, OB-08
func TestSenderCannotDeleteOrInsertMessages(t *testing.T) {
	db := testsupport.New(t)
	if _, err := db.Sender.Exec(context.Background(), `DELETE FROM messages`); err == nil {
		t.Error("sender smazal zprávy, chybí odebrané právo DELETE")
	}
	_, err := db.Sender.Exec(context.Background(),
		`INSERT INTO messages (id, workspace_id, email, created_at) VALUES ($1, $2, 'x@y.cz', now())`,
		uuid.New(), uuid.New())
	if err == nil {
		t.Error("sender vložil zprávu, chybí odebrané právo INSERT")
	}
}

// AK-20.3: sloupcový grant nesmí pustit zápis do email ani render_data.
func TestSenderCannotRewriteMessagePayload(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	if _, err := db.Sender.Exec(context.Background(), `UPDATE messages SET email = 'utok@example.cz'`); err == nil {
		t.Error("sender přepsal email")
	}
	if _, err := db.Sender.Exec(context.Background(), `UPDATE messages SET render_data = '{}'::jsonb`); err == nil {
		t.Error("sender přepsal render_data")
	}
	// created_at ve výčtu schválně není: sender nesmí přesunout zprávu do jiné partition.
	if _, err := db.Sender.Exec(context.Background(), `UPDATE messages SET created_at = now()`); err == nil {
		t.Error("sender přepsal created_at a mohl by zprávu přesunout do jiné partition")
	}
}

// Nahrazuje zrušené kritérium AK-20.2 a tvrdí OPAČNOU věc než ono.
//
// Původní znění chtělo, aby byl nový měsíční oddíl pro sender čitelný, a P03 na
// to měl copyGrantsFromParent. Rozhodnutím R20 se to ruší: oddíl NEDĚDÍ
// relrowsecurity ani politiky, takže grant na oddílu je díra vedle RLS. Pod
// mlain_app by SELECT z oddílu vrátil řádky všech projektů. Oddíl proto žádný
// grant nedostane a přímý dotaz na něj skončí na permission denied pod kteroukoli
// rolí, kdežto dotaz přes rodiče projde a RLS na něm platí.
//
// Test je tady dvakrát schválně: jednou přes rodiče, že claim funguje, a jednou
// přímo na oddíl, že to NEJDE.
func TestSenderReadsThroughParentButNeverThePartitionItself(t *testing.T) {
	db := testsupport.New(t)
	ctx := context.Background()
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 3, "campaign")

	var visible int
	if err := db.Sender.QueryRow(ctx,
		`SELECT count(*) FROM messages WHERE campaign_id = $1`, s.CampaignID).Scan(&visible); err != nil {
		t.Fatalf("čtení přes rodičovskou tabulku selhalo: %v", err)
	}
	if visible != 3 {
		t.Fatalf("sender vidí přes rodiče %d zpráv, čekám 3", visible)
	}

	// Jméno oddílu si zjistíme z katalogu, ne z výpočtu, aby test nezávisel na
	// tom, kdy se pouští.
	var partition string
	if err := db.Admin.QueryRow(ctx, `
		SELECT c.relname FROM pg_class c
		JOIN pg_inherits i ON i.inhrelid = c.oid
		WHERE i.inhparent = 'messages'::regclass
		ORDER BY c.relname LIMIT 1`).Scan(&partition); err != nil {
		t.Fatalf("oddíl se nenašel: %v", err)
	}
	if _, err := db.Sender.Exec(ctx, `SELECT count(*) FROM `+partition); err == nil {
		t.Fatalf("sender přečetl oddíl %s přímo. Oddíl nedědí RLS, takže přímý přístup "+
			"obchází izolaci projektů (P03, rozhodnutí R20)", partition)
	}
}

// AK-20.6: claim pod rolí mlain_sender nad tabulkou s RLS vrátí NEPRÁZDNOU dávku.
// Test musí selhat, když se politika sender_bypass odebere. Bez ní by claim vracel
// nula řádků vždycky, kampaň by tiše stála a NIC by se nezalogovalo, protože
// prázdná dávka je legitimní stav.
func TestSenderSeesRowsUnderRowLevelSecurity(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 5, "campaign")

	var enabled bool
	if err := db.Admin.QueryRow(context.Background(),
		`SELECT relrowsecurity FROM pg_class WHERE relname = 'messages'`).Scan(&enabled); err != nil {
		t.Fatal(err)
	}
	if !enabled {
		t.Fatal("na messages není zapnutá RLS, takže tenhle test nic negarantuje")
	}

	var visible int
	if err := db.Sender.QueryRow(context.Background(),
		`SELECT count(*) FROM messages WHERE campaign_id = $1`, s.CampaignID).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible == 0 {
		t.Fatal("sender nevidí ani jeden řádek. Skoro jistě chybí permisivní politika sender_bypass")
	}
}

// AK-20.5: kontrola, že testy neběží pod migrátorem. Pod migrátorem by chybějící
// politika prošla, protože migrátor i aplikační role RLS obcházejí.
func TestScenariosRunAsSenderRole(t *testing.T) {
	db := testsupport.New(t)
	var role string
	if err := db.Sender.QueryRow(context.Background(), `SELECT current_user`).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "mlain_sender" {
		t.Fatalf("scénáře běží pod rolí %q. Test, který se připojí jinou rolí, je neplatný", role)
	}
	var bypass bool
	if err := db.Sender.QueryRow(context.Background(),
		`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`).Scan(&bypass); err != nil {
		t.Fatal(err)
	}
	if bypass {
		t.Fatal("role mlain_sender má BYPASSRLS. Kontrakt to zakazuje, ochrana má být politikou")
	}
}

// Sender má na message_events jen INSERT, nikdy SELECT ani UPDATE.
func TestSenderCanOnlyInsertIntoMessageEvents(t *testing.T) {
	db := testsupport.New(t)
	if _, err := db.Sender.Exec(context.Background(), `SELECT * FROM message_events`); err == nil {
		t.Error("sender čte message_events, čekám jen INSERT")
	}
	if _, err := db.Sender.Exec(context.Background(), `UPDATE message_events SET type = 'x'`); err == nil {
		t.Error("sender mění message_events, čekám jen INSERT")
	}
}
