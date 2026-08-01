package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFixturesDirJeSymlinkNaContracts(t *testing.T) {
	dir := FixturesDir()

	info, err := os.Lstat(dir)
	if err != nil {
		t.Fatalf("testdata neexistuje: %v", err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("testdata musí být symlink, ne kopie; je to %s", info.Mode())
	}

	target, err := os.Readlink(dir)
	if err != nil {
		t.Fatalf("readlink selhal: %v", err)
	}
	if target != filepath.Join("..", "..", "packages", "contracts", "fixtures") {
		t.Fatalf("symlink míří jinam: %s", target)
	}

	if _, err := os.Stat(filepath.Join(dir, "outbox")); err != nil {
		t.Fatalf("přes symlink nejde číst adresář outbox: %v", err)
	}
}

// TestReadFixtureNactePlatnaData ověřuje, že ReadFixture přes symlink skutečně
// přečte obsah fixtury, ne jen to, že cesta existuje.
func TestReadFixtureNactePlatnaData(t *testing.T) {
	body, err := ReadFixture(filepath.Join("outbox", "scenarios.json"))
	if err != nil {
		t.Fatalf("ReadFixture selhal: %v", err)
	}
	if len(body) == 0 {
		t.Fatal("ReadFixture vrátil prázdný obsah")
	}

	var parsed struct {
		ContractVersion int `json:"contractVersion"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("obsah fixtury není platný JSON: %v", err)
	}
	if parsed.ContractVersion != 1 {
		t.Fatalf("contractVersion je %d, čeká se 1", parsed.ContractVersion)
	}
	if !strings.Contains(string(body), "runner") {
		t.Fatal("obsah fixtury neobsahuje očekávané pole runner")
	}
}
