//go:build integration

// Package testsupport drží pomůcky pro integrační testy senderu.
// Celý balíček je pod tagem integration, takže go test ./... ho nepřekládá.
package testsupport

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// senderPassword je heslo rolí, které si harness zakládá sám. Do produkce se
// nedostane: role s tímhle heslem zakládá jen tenhle soubor pod tagem integration.
//
// Hodnota je shodná s tou, kterou používá bootstrap scénáře OB-00 od P02
// (internal/contracts/outbox_ob00_test.go). Role je v testovací databázi
// SDÍLENÁ napříč balíčky, takže dvě různá hesla znamenají, že ten balíček,
// který běží druhý, skončí na "password authentication failed": role už
// existuje a CREATE ROLE ji podruhé nezaloží.
const senderPassword = "mlain"

// DB drží dvě připojení. Admin zakládá schéma a data, Sender je připojení pod
// rolí mlain_sender a jde přes něj VŠECHNA práce senderu v testech.
//
// Kdyby testy běžely pod migrátorem nebo aplikační rolí, chybějící politika
// sender_bypass by se nikdy neprojevila, protože obě role RLS obcházejí.
// Je to AK-20.5 a je to nejcennější věc na celém nálezu.
type DB struct {
	Admin  *pgxpool.Pool
	Sender *pgxpool.Pool
	// SenderURL je odvozené připojení pod rolí mlain_sender. Testy, které
	// sestavují celou aplikaci, ho potřebují jako konfigurační hodnotu.
	SenderURL string
}

// New připraví čerstvé schéma a vrátí obě připojení.
//
// Harness je SAMOBOOTSTRAPOVACÍ a chce jedinou proměnnou, DATABASE_URL_MIGRATOR,
// tedy tu, kterou job test-go-integration v P01 nastavuje a kterou používá
// i scénář OB-00 z P02. Připojení senderu se z ní ODVOZUJE, nečte se z prostředí:
// kdyby ho dodávalo prostředí, mohlo by omylem mířit na migrátora a všechny
// testy práv i RLS by byly zelené, přestože nic negarantují. Přesně tak vypadal
// job test-go-integration předtím: DATABASE_URL_SENDER v něm mířila na
// mlain_migrator.
func New(t *testing.T) *DB {
	t.Helper()
	adminURL := os.Getenv("DATABASE_URL_MIGRATOR")
	if adminURL == "" {
		t.Fatal("DATABASE_URL_MIGRATOR není nastavená. Integrační testy se NEPŘESKAKUJÍ, " +
			"protože přeskočený test vypadá jako zelený a zamaskuje chybějící ochranu")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Fatalf("připojení migrátora selhalo: %v", err)
	}

	// Pořadí je pevné: role musí existovat DŘÍV, než se pustí migrace, protože
	// 0004 i 0005 roli mlain_sender jmenují a P03 je vědomě neobaluje výjimkou
	// (rozhodnutí R19). Bez role by migrace hlasitě spadla, což je záměr.
	if err := ensureRoles(ctx, admin); err != nil {
		admin.Close()
		t.Fatalf("založení rolí selhalo: %v", err)
	}
	if _, err := admin.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`); err != nil {
		admin.Close()
		t.Fatalf("vyčištění schématu selhalo: %v", err)
	}
	if err := applyMigrations(ctx, admin); err != nil {
		admin.Close()
		t.Fatalf("aplikace migrací P03 selhala: %v", err)
	}
	if err := ensurePartitions(ctx, admin, "messages", "message_events"); err != nil {
		admin.Close()
		t.Fatalf("založení oddílů selhalo: %v", err)
	}

	senderURL, err := deriveSenderURL(adminURL)
	if err != nil {
		admin.Close()
		t.Fatalf("odvození připojení senderu: %v", err)
	}
	sender, err := pgxpool.New(ctx, senderURL)
	if err != nil {
		admin.Close()
		t.Fatalf("připojení senderu selhalo: %v", err)
	}
	if err := sender.Ping(ctx); err != nil {
		admin.Close()
		sender.Close()
		t.Fatalf("ping pod rolí mlain_sender selhal: %v", err)
	}

	t.Cleanup(func() {
		sender.Close()
		admin.Close()
	})
	return &DB{Admin: admin, Sender: sender, SenderURL: senderURL}
}

// ensureRoles zakládá role, které migrace P03 jmenují.
//
// Seznam není jen mlain_sender: migrace 0004 a 0005 jmenují i mlain_app,
// mlain_maintenance, mlain_gdpr a mlain_backup v politikách a grantech
// a P03 je rozhodnutím R19 vědomě neobaluje výjimkou, takže bez nich migrace
// hlasitě spadne. Seznam se odvozuje z toho, co migrace opravdu jmenují;
// když P03 přidá roli, spadne tady, ne v produkci.
func ensureRoles(ctx context.Context, admin *pgxpool.Pool) error {
	for _, role := range []string{
		"mlain_sender", "mlain_app", "mlain_maintenance", "mlain_gdpr", "mlain_backup",
	} {
		// ALTER za CREATE je tam schválně. Databáze bývá sdílená mezi běhy
		// i mezi balíčky, takže role často UŽ existuje a CREATE se přeskočí.
		// Bez ALTER by pak platilo heslo z toho běhu, který roli založil první,
		// a harness by se nepřipojil s hláškou o špatném heslu, přestože je
		// všechno ostatní v pořádku.
		_, err := admin.Exec(ctx, fmt.Sprintf(`
			DO $$
			BEGIN
			  CREATE ROLE %[1]s LOGIN PASSWORD %[2]s;
			EXCEPTION WHEN duplicate_object THEN
			  NULL;
			END $$;
			ALTER ROLE %[1]s LOGIN PASSWORD %[2]s;`, role, quoteLiteral(senderPassword)))
		if err != nil {
			return fmt.Errorf("role %s: %w", role, err)
		}
	}
	return nil
}

func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// deriveSenderURL vymění uživatele a heslo, zbytek připojovacího řetězce nechá.
func deriveSenderURL(base string) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	u.User = url.UserPassword("mlain_sender", senderPassword)
	return u.String(), nil
}
