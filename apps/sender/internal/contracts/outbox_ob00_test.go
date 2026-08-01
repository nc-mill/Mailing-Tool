//go:build integration

package contracts

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// adminURL vrací administrátorské spojení, ze kterého si test databázi připraví.
// Pořadí je dané: DATABASE_URL_MIGRATOR je to, co nastavuje CI, CONTRACTS_DATABASE_URL
// je lokální zkratka. Když není ani jedno, test SELŽE. Nikdy se nepřeskakuje:
// přeskočený OB-00 vypadá zeleně a přitom neověří nic.
func adminURL(t *testing.T) string {
	t.Helper()
	for _, name := range []string{"DATABASE_URL_MIGRATOR", "CONTRACTS_DATABASE_URL"} {
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	t.Fatal("DATABASE_URL_MIGRATOR nebo CONTRACTS_DATABASE_URL musí být nastavené; OB-00 se nesmí přeskočit")
	return ""
}

// withUser přepíše uživatele a heslo v připojovacím řetězci. Role zakládá bootstrap
// níž se stejným heslem, takže se nemusí předávat další proměnná.
func withUser(raw, user string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	parsed.User = url.UserPassword(user, "mlain")
	return parsed.String(), nil
}

// bootstrap založí role, doplní grant na databázi a aplikuje kontraktní schéma.
// Je to tentýž soubor, který používá TypeScript strana, takže se schéma neopisuje.
func bootstrap(ctx context.Context, t *testing.T, admin *pgx.Conn) {
	t.Helper()
	for _, role := range []string{"mlain_migrator", "mlain_app", "mlain_sender"} {
		if _, err := admin.Exec(ctx, fmt.Sprintf(`
			DO $$
			BEGIN
			  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN
			    CREATE ROLE %s LOGIN PASSWORD 'mlain';
			  END IF;
			END
			$$;`, role, role)); err != nil {
			t.Fatalf("role %s: %v", role, err)
		}
	}
	var dbName string
	if err := admin.QueryRow(ctx, "SELECT current_database()").Scan(&dbName); err != nil {
		t.Fatalf("current_database: %v", err)
	}
	// Bez tohohle grantu skončí CREATE EXTENSION citext hláškou
	// `permission denied to create extension`. Ověřeno na PostgreSQL 18.4.
	for _, stmt := range []string{
		fmt.Sprintf("GRANT CREATE ON DATABASE %s TO mlain_migrator", pgx.Identifier{dbName}.Sanitize()),
		"GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator",
		"DROP TABLE IF EXISTS messages, campaigns, workspaces, suppressions CASCADE",
	} {
		if _, err := admin.Exec(ctx, stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	schema, err := ReadFixture(filepath.Join("outbox", "schema.sql"))
	if err != nil {
		t.Fatalf("bootstrap schéma nejde přečíst: %v", err)
	}
	if _, err := admin.Exec(ctx, string(schema)); err != nil {
		t.Fatalf("bootstrap schéma se nezaložilo: %v", err)
	}
}

// TestOB00 spouští každý normativní dotaz kontraktu 4.10.1 proti reálné
// databázi. Netvrdí nic o výsledku, jen že dotaz projde parserem a plánovačem.
func TestOB00(t *testing.T) {
	ctx := context.Background()

	admin, err := pgx.Connect(ctx, adminURL(t))
	if err != nil {
		t.Fatalf("administrátorské spojení selhalo: %v", err)
	}
	defer admin.Close(ctx)
	bootstrap(ctx, t, admin)

	senderURL, err := withUser(adminURL(t), "mlain_sender")
	if err != nil {
		t.Fatalf("sender URL: %v", err)
	}
	appURL, err := withUser(adminURL(t), "mlain_app")
	if err != nil {
		t.Fatalf("app URL: %v", err)
	}

	sender, err := pgx.Connect(ctx, senderURL)
	if err != nil {
		t.Fatalf("spojení pod rolí mlain_sender selhalo: %v", err)
	}
	defer sender.Close(ctx)

	app, err := pgx.Connect(ctx, appURL)
	if err != nil {
		t.Fatalf("spojení pod rolí mlain_app selhalo: %v", err)
	}
	defer app.Close(ctx)

	// Pojistka proti nálezu z revize: kdyby scénáře běžely pod migrátorem,
	// prošly by a zamaskovaly chybějící politiku sender_bypass.
	var currentUser string
	if err := sender.QueryRow(ctx, "SELECT current_user").Scan(&currentUser); err != nil {
		t.Fatalf("current_user selhal: %v", err)
	}
	if currentUser != "mlain_sender" {
		t.Fatalf("scénáře musí běžet pod rolí mlain_sender, běží pod %s", currentUser)
	}

	dir := filepath.Join(FixturesDir(), "outbox", "sql")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("nelze číst %s: %v", dir, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	if len(names) != 11 {
		t.Fatalf("čekám jedenáct normativních dotazů, je jich %d", len(names))
	}

	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatalf("čtení selhalo: %v", err)
			}
			stmt, err := parseContractStatement(name, string(raw))
			if err != nil {
				t.Fatalf("%v", err)
			}
			conn := sender
			if stmt.Role == "app" {
				conn = app
			}
			prepared := "ob00_" + strings.NewReplacer(".", "_", "-", "_").Replace(name)
			// Prázdný seznam BEZ ZÁVOREK. `PREPARE jméno ()` i `EXECUTE jméno()`
			// jsou syntaktická chyba a dva z jedenácti dotazů parametry nemají.
			if _, err := conn.Exec(ctx,
				"PREPARE "+prepared+ParamList(stmt.ParamTypes)+" AS "+stmt.SQL); err != nil {
				t.Fatalf("PREPARE selhal: %v", err)
			}
			if _, err := conn.Exec(ctx,
				"EXPLAIN (COSTS OFF) EXECUTE "+prepared+ArgList(stmt.Args)); err != nil {
				t.Fatalf("EXPLAIN EXECUTE selhal: %v", err)
			}
			if _, err := conn.Exec(ctx, "DEALLOCATE ALL"); err != nil {
				t.Fatalf("DEALLOCATE selhal: %v", err)
			}
		})
	}
}
