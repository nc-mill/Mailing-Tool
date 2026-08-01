package campaign

import (
	"strings"
	"testing"
)

func rawHeader(html, text string, markerCount *int) *Raw {
	return &Raw{
		Subject:          "Letní výprodej",
		Preheader:        "Sleva do neděle",
		CompiledHTML:     html,
		CompiledText:     text,
		Revision:         1,
		ClickMarkerCount: markerCount,
	}
}

func count(n int) *int { return &n }

func TestPrepareHeaderAcceptsValidTemplate(t *testing.T) {
	html := `<!DOCTYPE html><html><body>Ahoj {{ contact.first_name }} ` +
		`<a href="https://track.mlain.invalid/c/0192f3a0-1c2d-7e42-9c3d-4e5f60718293">x</a>` +
		`<!--ML_OPEN_PIXEL--></body></html>`
	h, err := PrepareHeader(rawHeader(html, "Ahoj {{ contact.first_name }}", count(1)))
	if err != nil {
		t.Fatalf("platná šablona neprošla: %v", err)
	}
	if !strings.Contains(h.HTMLSource, "ml_out_html") {
		t.Error("do HTML se neinjektoval escapovací filtr")
	}
	if !strings.Contains(h.TextSource, "ml_out_text") {
		t.Error("do textu se neinjektoval výstupní filtr")
	}
	if h.ClickMarkers != 1 {
		t.Errorf("ClickMarkers = %d, chci 1", h.ClickMarkers)
	}
}

// V4, AK-6.21: neshoda počtu značek pozastaví kampaň DŘÍV, než odejde první zpráva.
func TestPrepareHeaderRejectsMarkerCountMismatch(t *testing.T) {
	html := `<a href="https://track.mlain.invalid/c/0192f3a0-1c2d-7e42-9c3d-4e5f60718293">x</a>`
	_, err := PrepareHeader(rawHeader(html, "", count(5)))
	if err == nil {
		t.Fatal("neshoda počtu značek musí být chyba")
	}
	if ve, ok := err.(*ValidationError); !ok || ve.Detail != "contract_mismatch" {
		t.Fatalf("chyba = %v, chci contract_mismatch", err)
	}
}

// Když clickMarkerCount není k dispozici, kontrola V4 se přeskočí a ostatní běží.
func TestPrepareHeaderSkipsMarkerCountWhenUnknown(t *testing.T) {
	html := `<a href="https://track.mlain.invalid/c/0192f3a0-1c2d-7e42-9c3d-4e5f60718293">x</a>`
	h, err := PrepareHeader(rawHeader(html, "", nil))
	if err != nil {
		t.Fatalf("bez clickMarkerCount se ostatní kontroly nemají zastavit: %v", err)
	}
	if !h.MarkerCountUnverified {
		t.Fatal("chybí příznak, že kontrola V4 neproběhla")
	}
}

// V3: neparsovatelné UUID za značkou.
func TestPrepareHeaderRejectsBrokenLinkID(t *testing.T) {
	html := `<a href="https://track.mlain.invalid/c/NENI-UUID-NENI-UUID-NENI-UUID-NENIUU">x</a>`
	if _, err := PrepareHeader(rawHeader(html, "", nil)); err == nil {
		t.Fatal("neplatné UUID za značkou musí kampaň zastavit")
	}
}

// V1, AK-6.24: HTML entita uvnitř konstrukce.
func TestPrepareHeaderRejectsEscapedEntity(t *testing.T) {
	html := `{{ contact.first_name | default: &quot;kolego&quot; }}`
	_, err := PrepareHeader(rawHeader(html, "", nil))
	if err == nil {
		t.Fatal("escapovaná šablona prošla")
	}
	ve, ok := err.(*ValidationError)
	if !ok || ve.Detail != "liquid_escaped_entity_in_construct" {
		t.Fatalf("chyba = %v", err)
	}
}

// V2, AK-6.16: filtr safe je odmítnutý při načtení kampaně, ne až u zprávy.
func TestPrepareHeaderRejectsSafeFilter(t *testing.T) {
	_, err := PrepareHeader(rawHeader(`{{ contact.x | safe }}`, "", nil))
	if err == nil {
		t.Fatal("filtr safe prošel")
	}
	ve, ok := err.(*ValidationError)
	if !ok || ve.Detail != "contract_mismatch" {
		t.Fatalf("chyba = %v", err)
	}
	if ve.PauseCode != "render_failure_rate" {
		t.Fatalf("PauseCode = %q, chci render_failure_rate", ve.PauseCode)
	}
}

// V5: šablona, která se nezparsuje, zastaví kampaň, ne jednu zprávu.
func TestPrepareHeaderRejectsUnparseableTemplate(t *testing.T) {
	if _, err := PrepareHeader(rawHeader(`{% if contact.x %}bez konce`, "", nil)); err == nil {
		t.Fatal("nezparsovatelná šablona prošla")
	}
}

func TestCacheReusesEntryUntilRevisionChanges(t *testing.T) {
	loads := 0
	c := NewCache(func(id string) (*Raw, error) {
		loads++
		return rawHeader("<p>{{ contact.x }}</p>", "{{ contact.x }}", nil), nil
	})
	for i := 0; i < 3; i++ {
		if _, err := c.Get("kampan", 1); err != nil {
			t.Fatal(err)
		}
	}
	if loads != 1 {
		t.Fatalf("hlavička se načetla %d krát, čekám 1", loads)
	}
	if _, err := c.Get("kampan", 2); err != nil {
		t.Fatal(err)
	}
	if loads != 2 {
		t.Fatalf("po změně revize se hlavička načetla %d krát, čekám 2", loads)
	}
}
