package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// Report má PŘESNĚ ta pole, která čte scripts/check-parity.ts. Jeden tvar pro
// obě strany, jinak by se porovnávaly dvě různé věci (rozhodnutí D14).
type Report struct {
	Language       string         `json:"language"`
	Section        string         `json:"section"`
	Total          int            `json:"total"`
	Executed       int            `json:"executed"`
	Skipped        int            `json:"skipped"`
	IDs            []string       `json:"ids"`
	Groups         map[string]int `json:"groups"`
	FixturesDigest string         `json:"fixturesDigest"`
}

// WriteGoldenReport zapíše report sekce. `Skipped` se POČÍTÁ jako rozdíl mezi
// použitelnými a skutečně provedenými, nikdy se nepíše jako literál: literál
// nula byl důvod, proč dřívější kontrola "nepřeskočené fixtures" neměřila nic.
//
// Report se zapisuje VŽDY, i když je běh neúplný. Tiché nezapsání by z chybějící
// parity udělalo zelenou, protože check-parity by neměl co porovnat.
func WriteGoldenReport(t *testing.T, section string, total int, ids []string, groups map[string]int, digest string) {
	t.Helper()
	sorted := append([]string(nil), ids...)
	sort.Strings(sorted)
	if groups == nil {
		groups = map[string]int{}
	}
	report := Report{
		Language:       "go",
		Section:        section,
		Total:          total,
		Executed:       len(sorted),
		Skipped:        total - len(sorted),
		IDs:            sorted,
		Groups:         groups,
		FixturesDigest: digest,
	}
	dir := ReportsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("reports: %v", err)
	}
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	path := filepath.Join(dir, "go-golden-"+section+".json")
	if err := os.WriteFile(path, append(body, '\n'), 0o644); err != nil {
		t.Fatalf("zápis reportu %s: %v", path, err)
	}
}
