//go:build integration

// Package testsupport drží pomůcky pro integrační testy senderu.
// Celý balíček je pod tagem integration, takže go test ./... ho nepřekládá.
package testsupport

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// senderPassword je heslo rolí, které si harness zakládá sám. Do produkce se
// nedostane: role s tímhle heslem zakládá jen tenhle soubor pod tagem integration.
//
// Hodnota je shodná s tou, kterou používá bootstrap scénáře OB-00 od P02
// (internal/contracts/outbox_ob00_test.go). Role je na sdíleném Postgres serveru
// CLUSTER-WIDE (na rozdíl od databáze níž, ta se klonuje na test), takže dvě
// různá hesla znamenají, že ten balíček, který běží druhý, skončí na
// "password authentication failed": role už existuje a CREATE ROLE ji podruhé
// nezaloží.
const senderPassword = "mlain"

// bootstrapLockID serializuje založení rolí a stavbu šablony mezi souběžnými
// testovacími binárkami, které sdílejí JEDEN Postgres server.
//
// PROČ TOHLE VŮBEC EXISTUJE: `go test ./...` pouští balíčky paralelně, ne
// sekvenčně. Dřívější verze tohohle souboru dělala `DROP SCHEMA public CASCADE`
// a přehrávala CELÉ migrace P03 do JEDINÉ sdílené databáze při KAŽDÉM zavolání
// New(t), tedy jednou na test. Nad sdíleným serverem to znamenalo, že dva
// souběžné balíčky (třeba internal/outbox a internal/contracts) mazaly a stavěly
// tutéž databázi zároveň. Pozorované chyby byly `duplicate key value violates
// unique constraint "pg_extension_name_index"` (dva CREATE EXTENSION citext
// najednou) a `type "citext" does not exist` (druhý běh viděl mezistav po DROP
// SCHEMA prvního). Řešení "spouštěj to sekvenčně" (`go test -p 1 ./...`)
// fungovalo, ale bylo křehké: platilo, jen dokud si na to všichni vzpomněli,
// a nechránilo nic, kdyby na to někdo zapomněl přidat do CI nebo do návodu.
//
// Skutečná oprava kopíruje rozhodnutí R31 plánu P03 a stejný vzor, jaký používá
// packages/core/src/test-support/pg-harness.ts: sdílený je JEN SERVER (jeden
// kontejner). Schéma se zmigruje JEDNOU do šablony pod tímhle zámkem a každý
// test dostane VLASTNÍ databázi klonovanou přes `CREATE DATABASE ... TEMPLATE`,
// což kopíruje tabulky, RLS politiky i granty. `go test -tags=integration ./...`
// je teď bezpečné i BEZ `-p 1`.
//
// Hodnota je záměrně JINÁ než 7264150402 z packages/core/src/test-support/pg-harness.ts:
// obě šablony jsou na sobě nezávislé (Go a TypeScript strana staví schéma
// zvlášť, viz templateDBPrefix) a nemá smysl je serializovat vzájemně, jen
// samy proti sobě.
const bootstrapLockID = 7264150410

// templateDBPrefix odlišuje šablony tohohle harnessu od `mlain_tpl_` v
// packages/core/src/test-support/pg-harness.ts. Obě strany aplikují STEJNÉ
// migrace z packages/db/migrations a mohly by si teoreticky sdílet jednu
// šablonu, ale schválně nesdílí: implicitní závislost na tom, že Go a
// TypeScript strana pojmenují šablonu identicky, by byla křehká vazba mimo
// dohled obou plánů (P09 na packages/core nesahá, viz kapitola 30 plánu).
const templateDBPrefix = "mlain_go_tpl_"

// perTestDBPrefix nese PID procesu, který databázi založil, aby úklid osiřelých
// databází (sweepOrphans) poznal, jestli ten proces ještě běží.
const perTestDBPrefix = "mlain_go_t"

// dbCounter odlišuje víc databází založených ZE STEJNÉHO procesu, kdyby jeden
// balíček volal New(t) vícekrát.
var dbCounter atomic.Int64

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

// New připraví databázi klonovanou z předmigrované šablony a vrátí obě připojení.
//
// Harness je SAMOBOOTSTRAPOVACÍ a chce jedinou proměnnou, DATABASE_URL_MIGRATOR,
// tedy tu, kterou job test-go-integration v P01 nastavuje a kterou používá
// i scénář OB-00 z P02. Připojení senderu se z ní ODVOZUJE, nečte se z prostředí:
// kdyby ho dodávalo prostředí, mohlo by omylem mířit na migrátora a všechny
// testy práv i RLS by byly zelené, přestože nic negarantují. Přesně tak vypadal
// job test-go-integration předtím: DATABASE_URL_SENDER v něm mířila na
// mlain_migrator.
//
// Databáze, kterou DATABASE_URL_MIGRATOR jmenuje (typicky mlain_test), se TADY
// NEPOUŽÍVÁ napřímo. Je to jen adresa serveru a přihlašovací údaje: každé
// volání New(t) dostane VLASTNÍ, čerstvě naklonovanou databázi, viz komentář
// u bootstrapLockID výš.
func New(t *testing.T) *DB {
	t.Helper()
	adminURL := os.Getenv("DATABASE_URL_MIGRATOR")
	if adminURL == "" {
		t.Fatal("DATABASE_URL_MIGRATOR není nastavená. Integrační testy se NEPŘESKAKUJÍ, " +
			"protože přeskočený test vypadá jako zelený a zamaskuje chybějící ochranu")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	template, err := ensureTemplate(ctx, adminURL)
	if err != nil {
		t.Fatalf("příprava rolí a šablony selhala: %v", err)
	}

	dbName := freshDatabaseName()
	if err := cloneDatabase(ctx, adminURL, dbName, template); err != nil {
		t.Fatalf("založení testovací databáze z šablony selhalo: %v", err)
	}
	// Registrováno PŘED založením poolů, takže se podle LIFO pořadí t.Cleanup
	// spustí AŽ PO jejich zavření (cleanup zavírající pool se registruje níž,
	// tedy později, a proto poběží dřív). DROP DATABASE ... WITH (FORCE) by
	// nezavřené spojení ukončil sám, ale zavřít je nejdřív sami je čistší.
	t.Cleanup(func() { dropDatabaseBestEffort(adminURL, dbName) })

	testURL, err := withDatabase(adminURL, dbName)
	if err != nil {
		t.Fatalf("sestavení připojení k testovací databázi: %v", err)
	}
	admin, err := pgxpool.New(ctx, testURL)
	if err != nil {
		t.Fatalf("připojení migrátora selhalo: %v", err)
	}

	senderURL, err := deriveSenderURL(testURL)
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

// ensureTemplate zaručí existenci rolí a předmigrované šablony pro AKTUÁLNÍ
// obsah packages/db/migrations. Volá ji každá testovací binárka na stroji,
// proto běží pod poradním zámkem: šablona se má postavit jednou, ne tolikrát,
// kolik je souběžných balíčků.
func ensureTemplate(ctx context.Context, adminURL string) (string, error) {
	template := templateDatabase()

	bootstrapURL, err := withDatabase(adminURL, "postgres")
	if err != nil {
		return "", err
	}
	// Vlastní pgx.Conn, ne pool: poradní zámek je session-scoped a MUSÍ se
	// zamknout a odemknout ze STEJNÉHO spojení. Pool by mezi jednotlivými
	// dotazy mohl přehodit fyzické spojení pod rukama a odemčení by šlo jinam
	// než zamčení. Session končí Close() níž, takže se zámek pustí i při chybě
	// uprostřed funkce.
	conn, err := pgx.Connect(ctx, bootstrapURL)
	if err != nil {
		return "", fmt.Errorf("bootstrap spojení na databázi postgres: %w", err)
	}
	defer conn.Close(context.Background())

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, bootstrapLockID); err != nil {
		return "", fmt.Errorf("poradní zámek: %w", err)
	}

	if err := ensureRoles(ctx, conn); err != nil {
		return "", fmt.Errorf("založení rolí selhalo: %w", err)
	}

	ready, err := templateReady(ctx, conn, template)
	if err != nil {
		return "", err
	}
	if ready {
		sweepOrphans(ctx, conn, template)
		return template, nil
	}

	// Nedostavěná šablona po spadlém běhu. IS_TEMPLATE se nastavuje až úplně
	// nakonec (viz konec funkce), takže existující-ale-nehotová šablona je
	// spolehlivá značka "k zahození", ne poškozený stav, který by šel opravit.
	if _, err := conn.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, template)); err != nil {
		return "", fmt.Errorf("úklid nedostavěné šablony: %w", err)
	}
	if _, err := conn.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %s`, template)); err != nil {
		return "", fmt.Errorf("založení šablony: %w", err)
	}

	tplURL, err := withDatabase(adminURL, template)
	if err != nil {
		return "", err
	}
	tplPool, err := pgxpool.New(ctx, tplURL)
	if err != nil {
		return "", fmt.Errorf("připojení k šabloně: %w", err)
	}
	defer tplPool.Close()

	if _, err := tplPool.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`); err != nil {
		return "", fmt.Errorf("vyčištění schématu šablony: %w", err)
	}
	if err := applyMigrations(ctx, tplPool); err != nil {
		return "", fmt.Errorf("aplikace migrací P03 do šablony: %w", err)
	}
	if err := ensurePartitions(ctx, tplPool, "messages", "message_events"); err != nil {
		return "", fmt.Errorf("založení oddílů v šabloně: %w", err)
	}

	// Až TADY je šablona použitelná. Do tohohle okamžiku ji nikdo neklonuje,
	// protože templateReady() se ptá právě na tenhle příznak.
	if _, err := conn.Exec(ctx, fmt.Sprintf(`ALTER DATABASE %s IS_TEMPLATE true`, template)); err != nil {
		return "", fmt.Errorf("označení šablony za hotovou: %w", err)
	}
	sweepOrphans(ctx, conn, template)
	return template, nil
}

func templateReady(ctx context.Context, conn *pgx.Conn, template string) (bool, error) {
	var ready bool
	err := conn.QueryRow(ctx, `SELECT datistemplate FROM pg_database WHERE datname = $1`, template).Scan(&ready)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return ready, nil
}

// sweepOrphans zahazuje databáze tohohle harnessu, jejichž proces už neběží,
// a staré šablony jiného otisku migrací. Bez tohohle by ve sdíleném kontejneru
// databáze přibývaly donekonečna, protože server přežívá jednotlivé běhy i pády.
//
// Chyby se schválně polykají: úklid je best effort. Když do databáze mezitím
// někdo píše, DROP neprojde a je to v pořádku, uklidí se příště.
func sweepOrphans(ctx context.Context, conn *pgx.Conn, currentTemplate string) {
	rows, err := conn.Query(ctx, `SELECT datname FROM pg_database WHERE datname LIKE $1 OR datname LIKE $2`,
		perTestDBPrefix+"%", templateDBPrefix+"%")
	if err != nil {
		return
	}
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			names = append(names, name)
		}
	}
	rows.Close()

	for _, name := range names {
		if name == currentTemplate {
			continue
		}
		if strings.HasPrefix(name, perTestDBPrefix) {
			if pid, ok := pidFromDatabaseName(name); ok && processAlive(pid) {
				continue
			}
		} else if !strings.HasPrefix(name, templateDBPrefix) {
			continue
		}
		_, _ = conn.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, name))
	}
}

// pidFromDatabaseName čte PID z názvu ve tvaru perTestDBPrefix + "<pid>_<čítač>_<náhoda>".
func pidFromDatabaseName(name string) (int, bool) {
	rest := strings.TrimPrefix(name, perTestDBPrefix)
	i := strings.IndexByte(rest, '_')
	if i <= 0 {
		return 0, false
	}
	pid, err := strconv.Atoi(rest[:i])
	if err != nil {
		return 0, false
	}
	return pid, true
}

// processAlive posílá signál 0, což proces nezabije, jen ověří, že existuje.
func processAlive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

// freshDatabaseName vyrobí jméno nové testovací databáze. PID je v názvu
// schválně: podle něj pozná sweepOrphans, že databáze patří mrtvému procesu
// a smí se zahodit. Náhodná přípona je pojistka proti souběhu víc volání
// New(t) ze stejného procesu.
func freshDatabaseName() string {
	n := dbCounter.Add(1)
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	return fmt.Sprintf("%s%d_%d_%s", perTestDBPrefix, os.Getpid(), n, suffix)
}

// cloneDatabase naklonuje databázi ze šablony. CREATE DATABASE ... TEMPLATE
// kopíruje tabulky, RLS politiky i granty, takže klon je nerozeznatelný od
// databáze, do které by se migrace přehrály znovu.
func cloneDatabase(ctx context.Context, adminURL, dbName, template string) error {
	bootstrapURL, err := withDatabase(adminURL, "postgres")
	if err != nil {
		return err
	}
	conn, err := pgx.Connect(ctx, bootstrapURL)
	if err != nil {
		return fmt.Errorf("bootstrap spojení pro klonování: %w", err)
	}
	defer conn.Close(context.Background())
	_, err = conn.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %s TEMPLATE %s`, dbName, template))
	return err
}

// dropDatabaseBestEffort zahazuje databázi jednoho testu. Chyba se nehlásí:
// nezahozená databáze se neztratí, sebere ji sweepOrphans při příštím startu,
// protože její proces už tou dobou nežije.
func dropDatabaseBestEffort(adminURL, dbName string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	bootstrapURL, err := withDatabase(adminURL, "postgres")
	if err != nil {
		return
	}
	conn, err := pgx.Connect(ctx, bootstrapURL)
	if err != nil {
		return
	}
	defer conn.Close(context.Background())
	_, _ = conn.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, dbName))
}

// ensureRoles zakládá role, které migrace P03 jmenují.
//
// Seznam není jen mlain_sender: migrace 0004 a 0005 jmenují i mlain_app,
// mlain_maintenance, mlain_gdpr a mlain_backup v politikách a grantech
// a P03 je rozhodnutím R19 vědomě neobaluje výjimkou, takže bez nich migrace
// hlasitě spadne. Seznam se odvozuje z toho, co migrace opravdu jmenují;
// když P03 přidá roli, spadne tady, ne v produkci.
func ensureRoles(ctx context.Context, admin *pgx.Conn) error {
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

// withDatabase přepíše jméno databáze v připojovacím řetězci a nechá zbytek
// (uživatele, heslo, host, port) beze změny.
func withDatabase(rawURL, dbName string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	u.Path = "/" + dbName
	return u.String(), nil
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
