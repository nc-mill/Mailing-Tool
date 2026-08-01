//go:build integration

package testsupport

import (
	"context"
	"testing"
)

func TestHarnessConnectsAsSenderRole(t *testing.T) {
	db := New(t)
	var role string
	if err := db.Sender.QueryRow(context.Background(), "SELECT current_user").Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "mlain_sender" {
		t.Fatalf("current_user = %q, testy senderu musí běžet pod mlain_sender (AK-20.5)", role)
	}
}

// Role NESMÍ mít BYPASSRLS. S ním by chybějící politika sender_bypass prošla
// a claim by v produkci vracel nula řádků, aniž by cokoliv selhalo.
func TestSenderRoleHasNoBypassRLS(t *testing.T) {
	db := New(t)
	var bypass bool
	if err := db.Sender.QueryRow(context.Background(),
		`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`).Scan(&bypass); err != nil {
		t.Fatal(err)
	}
	if bypass {
		t.Fatal("mlain_sender má BYPASSRLS; ochrana má být politikou, ne atributem role")
	}
}

// Tenhle test je náhrada za zrušenou repliku schématu. Neptá se seznamu v kódu
// senderu ani migrací P03; ptá se ŽIVÉHO KATALOGU na přesně ty vlastnosti,
// o které se opírá SQL senderu. Když je P03 změní, spadne tady, a ne až
// v produkci na zprávě, která se neodeslala.
func TestSchemaMatchesWhatSenderSQLAssumes(t *testing.T) {
	db := New(t)
	ctx := context.Background()

	t.Run("suppressions.email je citext", func(t *testing.T) {
		var typ string
		if err := db.Admin.QueryRow(ctx, `
			SELECT format_type(a.atttypid, a.atttypmod)
			FROM pg_attribute a
			WHERE a.attrelid = 'suppressions'::regclass AND a.attname = 'email'`).Scan(&typ); err != nil {
			t.Fatal(err)
		}
		if typ != "citext" {
			t.Fatalf("suppressions.email je %s, sender porovnává přes ::citext[]; "+
				"s typem text by byla kontrola suppression case-sensitive a odešlo by se na odhlášenou adresu", typ)
		}
	})

	t.Run("messages.contact_id je NOT NULL", func(t *testing.T) {
		var notNull bool
		if err := db.Admin.QueryRow(ctx, `
			SELECT a.attnotnull FROM pg_attribute a
			WHERE a.attrelid = 'messages'::regclass AND a.attname = 'contact_id'`).Scan(&notNull); err != nil {
			t.Fatal(err)
		}
		if !notNull {
			t.Fatal("messages.contact_id je nullable; renderer na tom staví větev pro preferences_url a webview_url")
		}
	})

	t.Run("messages je partitionovaná podle created_at", func(t *testing.T) {
		var col string
		if err := db.Admin.QueryRow(ctx, `
			SELECT a.attname FROM pg_partitioned_table p
			JOIN pg_attribute a ON a.attrelid = p.partrelid AND a.attnum = p.partattrs[0]
			WHERE p.partrelid = 'messages'::regclass`).Scan(&col); err != nil {
			t.Fatal(err)
		}
		if col != "created_at" {
			t.Fatalf("messages je dělená podle %q, sender adresuje zprávu klíčem (id, created_at)", col)
		}
	})

	t.Run("message_events je partitionovaná podle received_at", func(t *testing.T) {
		var col string
		if err := db.Admin.QueryRow(ctx, `
			SELECT a.attname FROM pg_partitioned_table p
			JOIN pg_attribute a ON a.attrelid = p.partrelid AND a.attnum = p.partattrs[0]
			WHERE p.partrelid = 'message_events'::regclass`).Scan(&col); err != nil {
			t.Fatal(err)
		}
		if col != "received_at" {
			t.Fatalf("message_events je dělená podle %q, sender zapisuje událost bez ts od providera", col)
		}
	})

	// Invariant I1. Kvůli tomuhle cizímu klíči NESMÍ zpráva vzniknout
	// s created_at = now(); musí se rovnat campaigns.audience_built_at.
	t.Run("cizí klíč invariantu I1 existuje", func(t *testing.T) {
		var n int
		if err := db.Admin.QueryRow(ctx, `
			SELECT count(*) FROM pg_constraint
			WHERE conrelid = 'messages'::regclass AND conname = 'fk_messages__campaign_audience'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatal("chybí fk_messages__campaign_audience; fixtures by směly zakládat zprávy, které v produkci nevzniknou")
		}
	})

	// Rozhodnutí R29 v P03: tyhle CHECK constrainty tam SCHVÁLNĚ nejsou.
	// Kdyby přibyly, StmtResultFatal by musel na GREATEST spoléhat i kvůli
	// tvrdé chybě 23514, ne jen kvůli správnosti čítače. Test hlídá OBA směry.
	t.Run("messages nemá ck_messages__attempts", func(t *testing.T) {
		var n int
		if err := db.Admin.QueryRow(ctx, `
			SELECT count(*) FROM pg_constraint
			WHERE conrelid = 'messages'::regclass AND conname = 'ck_messages__attempts'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatal("P03 zavedl ck_messages__attempts (rozhodnutí R29 se změnilo). " +
				"Projdi StmtResultFatal a StmtResultThrottled: bez GREATEST by zápis výsledku vracel 23514")
		}
	})

	// Rozhodnutí R20 v P03: oddíl nedostane ŽÁDNÝ grant, protože nedědí RLS.
	// Nahrazuje zrušené kritérium AK-20.2 a je to opačné tvrzení než dřív.
	t.Run("žádný měsíční oddíl nemá vlastní granty", func(t *testing.T) {
		rows, err := db.Admin.Query(ctx, `
			SELECT c.relname FROM pg_class c
			JOIN pg_inherits i ON i.inhrelid = c.oid
			WHERE i.inhparent IN ('messages'::regclass, 'message_events'::regclass)
			  AND c.relacl IS NOT NULL`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			t.Errorf("oddíl %s má vlastní granty. Oddíl nedědí relrowsecurity ani politiky, "+
				"takže grant na něm je díra vedle RLS (P03, rozhodnutí R20)", name)
		}
	})
}
