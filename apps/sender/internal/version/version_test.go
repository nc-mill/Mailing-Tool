package version_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/version"
)

// senderRoot vrací kořen apps/sender odvozený od tohohle zdrojového souboru,
// ne od pracovního adresáře: `go test ./...` má pracovní adresář v balíčku.
func senderRoot(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("nelze zjistit cestu ke zdrojovému souboru")
	}
	// internal/version/version_test.go -> internal/version -> internal -> apps/sender
	return filepath.Dir(filepath.Dir(filepath.Dir(thisFile)))
}

// Odchylka od plánu: P01 dodal Get() s výchozí hodnotou "0.0.0-dev", ne String()
// s hodnotou "dev". internal/version vlastní P01, takže se přizpůsobuje test,
// ne implementace.
func TestVersionFallsBackWhenUnset(t *testing.T) {
	if got := version.Get(); got != "0.0.0-dev" {
		t.Fatalf("Get() = %q, chci %q", got, "0.0.0-dev")
	}
}

// Modul zakládá P01 a cesta je závazná: P02 na ni odkazuje ve všech runnerech
// golden fixtures. Kdyby se rozešla, nepřeložil by se ani jeden z nich.
func TestModulePathIsTheOneP01Created(t *testing.T) {
	body, err := os.ReadFile(filepath.Join(senderRoot(t), "go.mod"))
	if err != nil {
		t.Fatalf("go.mod chybí: %v. Modul zakládá P01 (úkol 15), P09 ho NIKDY neinicializuje znovu", err)
	}
	const want = "module github.com/nc-mill/mlain/apps/sender"
	if !strings.Contains(string(body), want) {
		t.Fatalf("go.mod nemá %q. Cestu modulu vlastní P01 a P02 ji používá v runnerech", want)
	}
	if !strings.Contains(string(body), "go 1.26") {
		t.Error("go.mod nemá go 1.26; crypto/hkdf ze standardní knihovny vyžaduje aspoň 1.24 a CI staví 1.26")
	}
}

// Symlink vlastní P02. Kopie by se rozešla a nikdo by si toho nevšiml.
func TestFixturesSymlinkFromP02Exists(t *testing.T) {
	path := filepath.Join(senderRoot(t), "testdata")
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatalf("apps/sender/testdata neexistuje: %v. Symlink zakládá P02 (úkol 1), ne P09", err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("testdata je %s, musí to být symlink; kopie fixtures se rozejde a nikdo to nepozná", info.Mode())
	}
	target, err := os.Readlink(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join("..", "..", "packages", "contracts", "fixtures"); target != want {
		t.Fatalf("symlink míří na %s, chci %s", target, want)
	}
}

// Runnery golden fixtures vlastní P02 a leží v internal/contracts. P09 do toho
// balíčku NEPÍŠE; dodává jen tenká volání ve svých produkčních balíčcích.
func TestGoldenRunnersFromP02Exist(t *testing.T) {
	dir := filepath.Join(senderRoot(t), "internal", "contracts")
	for _, name := range []string{"fixtures.go", "report.go", "golden.go"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("chybí %s z P02: %v. Bez runnerů nemá P09 co volat", name, err)
		}
	}
	// Regrese na rozhodnutí R1: dokud tady ležely runnery obou plánů, balíček
	// se nepřeložil kvůli dvojím symbolům TestGoldenCrypto a writeGoldenReport.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		// `golden_test.go` je runner P02 a plán ho v úkolu 11 přímo předepisuje,
		// takže se z kontroly vyjímá jmenovitě.
		//
		// Bez té výjimky ho stráž chytala taky, a to nenápadným způsobem:
		// prefix `golden_` má 7 znaků, suffix `_test.go` osm, dohromady patnáct,
		// jenže `golden_test.go` má znaků jen čtrnáct. Obě podmínky proto platí
		// naráz nad JEDNÍM podtržítkem, které si prefix se suffixem sdílejí.
		// Stráž tak hlásila jako porušení soubor, který tam podle plánu patří.
		if e.Name() != "golden_test.go" &&
			strings.HasPrefix(e.Name(), "golden_") && strings.HasSuffix(e.Name(), "_test.go") {
			t.Errorf("%s je runner P09 v cizím balíčku. Runnery vlastní P02, P09 dodává volání "+
				"v internal/token, internal/credentials, internal/liquidx, internal/markers, "+
				"internal/mimebuild a internal/outbox", e.Name())
		}
	}
}
