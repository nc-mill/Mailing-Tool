// Package contracts drží Go stranu pěti zmrazených kontraktů TS <-> Go.
// Fixtures jsou jazykově neutrální JSON v packages/contracts/fixtures a Go je
// čte přes symlink apps/sender/testdata.
package contracts

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// FixturesDir vrací absolutní cestu k adresáři fixtures přes symlink testdata.
//
// Cesta se odvozuje od umístění tohoto zdrojového souboru, ne od pracovního
// adresáře: `go test ./internal/contracts` má pracovní adresář v balíčku,
// zatímco symlink podle kontraktu 4.10.5 leží v kořeni apps/sender.
func FixturesDir() string {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		panic("contracts: nelze zjistit cestu ke zdrojovému souboru")
	}
	// internal/contracts/fixtures.go -> internal/contracts -> internal -> apps/sender
	senderRoot := filepath.Dir(filepath.Dir(filepath.Dir(thisFile)))
	return filepath.Join(senderRoot, "testdata")
}

// ReportsDir vrací adresář, do kterého Go strana zapisuje počítadla pro test:parity.
func ReportsDir() string {
	return filepath.Join(filepath.Dir(FixturesDir()), "..", "..", "packages", "contracts", "reports")
}

// ReadFixture načte jeden soubor z fixtures.
func ReadFixture(relPath string) ([]byte, error) {
	return os.ReadFile(filepath.Join(FixturesDir(), relPath))
}

// ListFixtures vrací seřazená jména .json souborů v podadresáři fixtures.
func ListFixtures(sub string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(FixturesDir(), sub))
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".json") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// FixturesDigest počítá otisk vstupních souborů sekce STEJNĚ jako TypeScript
// strana: sha256 nad seřazeným "jméno\0sha256(obsah)\n". check-parity ho
// přepočítá z disku a vyžaduje shodu s oběma reporty, takže zelená parita nad
// reportem ze starého běhu není možná.
func FixturesDigest(sub string, names []string) (string, error) {
	sorted := append([]string(nil), names...)
	sort.Strings(sorted)
	outer := sha256.New()
	for _, name := range sorted {
		body, err := os.ReadFile(filepath.Join(FixturesDir(), sub, name))
		if err != nil {
			return "", err
		}
		inner := sha256.Sum256(body)
		outer.Write([]byte(name))
		outer.Write([]byte{0})
		outer.Write([]byte(hex.EncodeToString(inner[:])))
		outer.Write([]byte{'\n'})
	}
	return hex.EncodeToString(outer.Sum(nil)), nil
}
