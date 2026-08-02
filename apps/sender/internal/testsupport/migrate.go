//go:build integration

package testsupport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// migrationsDir vrací packages/db/migrations odvozené od tohohle zdrojového
// souboru, ne od pracovního adresáře.
func migrationsDir() string {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		panic("testsupport: nelze zjistit cestu ke zdrojovému souboru")
	}
	// migrate.go -> internal/testsupport -> internal -> apps/sender -> apps -> kořen repa.
	// Hopů je PĚT, ne čtyři: thisFile je cesta k SOUBORU, takže první Dir teprve
	// dává adresář balíčku. Se čtyřmi skončí cesta v apps/ a harness hlásí,
	// že migrace P03 neexistují, přestože leží na svém místě.
	root := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(thisFile)))))
	return filepath.Join(root, "packages", "db", "migrations")
}

// templateDatabase vrací jméno šablony odvozené z OBSAHU migrací, ne z pevného
// řetězce.
//
// Kontejner přežívá mezi běhy a migrace se podle rozhodnutí R39 (P03) upravují
// NA MÍSTĚ, ne novým souborem. Šablona s pevným jménem by tedy po úpravě staré
// migrace zůstala neaktuální a testy by běžely nad starým schématem, aniž by
// cokoli spadlo. S otiskem obsahu v názvu vznikne po každé změně migrací
// šablona nová automaticky, stejný princip jako templateDatabase()
// v packages/core/src/test-support/pg-harness.ts.
func templateDatabase() string {
	dir := migrationsDir()
	h := sha256.New()

	raw, err := os.ReadFile(filepath.Join(dir, "meta", "_journal.json"))
	if err != nil {
		panic(fmt.Sprintf("testsupport: _journal.json nejde přečíst z %s: %v", dir, err))
	}
	h.Write(raw)

	entries, err := os.ReadDir(dir)
	if err != nil {
		panic(fmt.Sprintf("testsupport: migrace nejdou vypsat z %s: %v", dir, err))
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		h.Write([]byte(name))
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			panic(fmt.Sprintf("testsupport: migrace %s nejde přečíst: %v", name, err))
		}
		h.Write(body)
	}
	return templateDBPrefix + hex.EncodeToString(h.Sum(nil))[:12]
}

type journalEntry struct {
	Idx int    `json:"idx"`
	Tag string `json:"tag"`
}

type journal struct {
	Entries []journalEntry `json:"entries"`
}

// noTransaction je značka P03 pro migrace, které nesmí běžet v transakci
// (CREATE INDEX CONCURRENTLY).
var noTransaction = regexp.MustCompile(`(?m)^--\s*mlain:no-transaction\s*$`)

// applyMigrations vykoná migrace P03 v pořadí z _journal.json.
//
// Čte SKUTEČNÉ soubory, ne kopii. Právě proto se testovací schéma nemůže
// rozejít s produkčním: neexistuje druhý zdroj, který by se rozešel.
func applyMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	dir := migrationsDir()
	raw, err := os.ReadFile(filepath.Join(dir, "meta", "_journal.json"))
	if err != nil {
		return fmt.Errorf("migrace P03 nejdou přečíst z %s: %w. "+
			"Integrační testy senderu běží proti skutečnému schématu, ne proti replice", dir, err)
	}
	var j journal
	if err := json.Unmarshal(raw, &j); err != nil {
		return fmt.Errorf("_journal.json není platný JSON: %w", err)
	}
	if len(j.Entries) == 0 {
		return fmt.Errorf("_journal.json neuvádí ani jednu migraci")
	}
	entries := append([]journalEntry(nil), j.Entries...)
	sort.Slice(entries, func(a, b int) bool { return entries[a].Idx < entries[b].Idx })

	for _, e := range entries {
		body, err := os.ReadFile(filepath.Join(dir, e.Tag+".sql"))
		if err != nil {
			return fmt.Errorf("migrace %s: %w", e.Tag, err)
		}
		sqlText := string(body)
		for _, stmt := range strings.Split(sqlText, "--> statement-breakpoint") {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if _, err := pool.Exec(ctx, stmt); err != nil {
				return fmt.Errorf("migrace %s: %w", e.Tag, err)
			}
		}
		_ = noTransaction // značku P03 respektuje jeho vlastní runner; tady běží každý příkaz sám
	}
	return nil
}

// ensurePartitions zakládá měsíční oddíly, protože migrace zakládají jen
// partitionované rodiče. Produkční runner na to má vlastní krok
// (createMonthlyPartitions), harness dělá totéž bez Node toolchainu.
//
// Rozsah je rok dozadu a dva roky dopředu, aby testy nezávisely na tom, kdy se
// pouštějí. Oddíl NEDOSTÁVÁ žádný grant, viz rozhodnutí R20 v P03.
func ensurePartitions(ctx context.Context, pool *pgxpool.Pool, tables ...string) error {
	start := time.Now().UTC().AddDate(0, -12, 0)
	start = time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
	for _, table := range tables {
		m := start
		for i := 0; i < 36; i++ {
			next := m.AddDate(0, 1, 0)
			name := fmt.Sprintf("%s_y%04dm%02d", table, m.Year(), int(m.Month()))
			_, err := pool.Exec(ctx, fmt.Sprintf(
				`CREATE TABLE IF NOT EXISTS %s PARTITION OF %s FOR VALUES FROM ('%s') TO ('%s')`,
				name, table, m.Format("2006-01-02"), next.Format("2006-01-02")))
			if err != nil {
				return fmt.Errorf("oddíl %s: %w", name, err)
			}
			m = next
		}
	}
	return nil
}
