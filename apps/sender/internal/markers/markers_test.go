package markers

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestReplaceLinksSwapsEveryMarker(t *testing.T) {
	a := "0192f3a0-1c2d-7e42-9c3d-4e5f60718293"
	b := "0192f3a0-1c2d-7e42-9c3d-4e5f60718294"
	src := `<a href="https://track.mlain.invalid/c/` + a + `">A</a>` +
		`<a href="https://track.mlain.invalid/c/` + b + `">B</a>`

	out, n, err := ReplaceLinks(src, func(id uuid.UUID) (string, error) {
		return "https://track.example.com/t/c/TOK-" + id.String()[:4], nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("počet náhrad = %d, chci 2", n)
	}
	if strings.Contains(out, "mlain.invalid") {
		t.Fatalf("ve výstupu zbyla značka:\n%s", out)
	}
	if !strings.Contains(out, "/t/c/TOK-0192") {
		t.Fatalf("náhrada se nevložila:\n%s", out)
	}
}

// AK-6.19: tlačítko s VML dvojčetem má po náhradě týž odkaz v obou místech.
func TestSameLinkIDGetsSameTokenTwice(t *testing.T) {
	id := "0192f3a0-1c2d-7e42-9c3d-4e5f60718293"
	src := `<v:roundrect href="https://track.mlain.invalid/c/` + id + `">` +
		`<a href="https://track.mlain.invalid/c/` + id + `">Koupit</a>`
	out, n, err := ReplaceLinks(src, func(uuid.UUID) (string, error) { return "https://x/t/c/TOK", nil })
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("počet náhrad = %d", n)
	}
	if strings.Count(out, "https://x/t/c/TOK") != 2 {
		t.Fatalf("odkazy se neshodují:\n%s", out)
	}
}

// AK-6.7: náhrada nesmí změnit nic jiného. Ověřuje se bajtovým porovnáním
// mimo nahrazené úseky.
func TestReplaceLeavesOutlookMarkupUntouched(t *testing.T) {
	src := `<!--[if mso]><table role="presentation"><tr><td></td></tr></table><![endif]-->` +
		`<a href="https://track.mlain.invalid/c/0192f3a0-1c2d-7e42-9c3d-4e5f60718293">x</a>`
	out, _, err := ReplaceLinks(src, func(uuid.UUID) (string, error) { return "URL", nil })
	if err != nil {
		t.Fatal(err)
	}
	want := `<!--[if mso]><table role="presentation"><tr><td></td></tr></table><![endif]--><a href="URL">x</a>`
	if out != want {
		t.Fatalf("markup se změnil\n got %q\nchci %q", out, want)
	}
}

// Neparsovatelné UUID za prefixem je chyba, ne tichý přeskok.
func TestUnparseableLinkIDIsAnError(t *testing.T) {
	src := `<a href="https://track.mlain.invalid/c/tohle-neni-uuid-vubec-a-je-dlouhe">x</a>`
	if _, _, err := ReplaceLinks(src, func(uuid.UUID) (string, error) { return "URL", nil }); err == nil {
		t.Fatal("neplatné UUID musí být chyba")
	}
}

func TestReplacePixelReplacesExactlyOnce(t *testing.T) {
	src := `<body>text<!--ML_OPEN_PIXEL--></body>`
	out, found := ReplacePixel(src, `<img src="URL" />`)
	if !found {
		t.Fatal("pixel se nenašel")
	}
	if out != `<body>text<img src="URL" /></body>` {
		t.Fatalf("got %q", out)
	}
}

// AK-6.9: při vypnutém sledování otevření se komentář nahradí prázdným řetězcem.
func TestReplacePixelWithEmptyString(t *testing.T) {
	out, found := ReplacePixel(`<body><!--ML_OPEN_PIXEL--></body>`, "")
	if !found {
		t.Fatal("pixel se nenašel")
	}
	if strings.Contains(out, "ML_OPEN_PIXEL") {
		t.Fatalf("komentář zůstal: %q", out)
	}
}

// Kontrakt garantuje právě jeden výskyt. Druhý zůstane a zachytí ho kontrola
// zbytků, proto se nahrazuje s počtem 1, ne ReplaceAll.
func TestReplacePixelLeavesSecondOccurrence(t *testing.T) {
	out, _ := ReplacePixel(`a<!--ML_OPEN_PIXEL-->b<!--ML_OPEN_PIXEL-->c`, "X")
	if strings.Count(out, "ML_OPEN_PIXEL") != 1 {
		t.Fatalf("got %q, druhý výskyt měl zůstat", out)
	}
}

// AK-6.20: kontrola zbytků běží per zpráva nad html i text.
func TestHasResidualMarker(t *testing.T) {
	if !HasResidual("a https://track.mlain.invalid/c/x b") {
		t.Error("zbytek značky se nenašel")
	}
	if HasResidual("čistý text") {
		t.Error("falešný poplach")
	}
}

// AK-6.22, CT-016: řetězec značky v datech kontaktu se do těla dostane doslova.
// Zaručuje to pořadí operací, protože v okamžiku interpolace už žádné značky
// neexistují. Tenhle test hlídá, že se pořadí nepřehodí.
func TestCountMarkersInSourceIsIndependentOfContactData(t *testing.T) {
	src := `<a href="https://track.mlain.invalid/c/0192f3a0-1c2d-7e42-9c3d-4e5f60718293">x</a>{{ contact.note }}`
	if n := CountLinkMarkers(src); n != 1 {
		t.Fatalf("počet značek ve zdroji = %d, chci 1", n)
	}
}
