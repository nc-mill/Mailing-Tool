package liquidx

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// K20: velká celá čísla nesmí projít přes float64, jinak se výstup rozejde
// s LiquidJS a pravidlo 6 přestane platit.
func TestDecodeKeepsLargeIntegersExact(t *testing.T) {
	data, _, err := DecodeRenderData([]byte(`{"contact":{"vs":9007199254740993}}`))
	if err != nil {
		t.Fatal(err)
	}
	v := LookupPath(data, "contact.vs")
	n, ok := v.(json.Number)
	if !ok {
		t.Fatalf("typ = %T, chci json.Number. Bez UseNumber se velká čísla ztratí", v)
	}
	if n.String() != "9007199254740993" {
		t.Fatalf("hodnota = %s", n.String())
	}
}

// K15: limit 200 iterací nejde vynutit v knihovně. Řeší se oříznutím pole
// PŘED renderem a obě strany to musí dělat identicky, jinak se výstup rozejde
// u 201. prvku.
func TestDecodeTruncatesArraysAtTwoHundred(t *testing.T) {
	items := make([]string, 250)
	for i := range items {
		items[i] = fmt.Sprintf(`"i%d"`, i)
	}
	raw := []byte(`{"contact":{"orders":[` + strings.Join(items, ",") + `]}}`)

	data, warnings, err := DecodeRenderData(raw)
	if err != nil {
		t.Fatal(err)
	}
	arr, ok := LookupPath(data, "contact.orders").([]any)
	if !ok {
		t.Fatalf("typ = %T", LookupPath(data, "contact.orders"))
	}
	if len(arr) != 200 {
		t.Fatalf("pole má %d prvků, chci 200", len(arr))
	}
	if arr[199] != "i199" {
		t.Fatalf("poslední prvek = %v, chci i199", arr[199])
	}
	if len(warnings) != 1 || warnings[0].Code != "array_truncated" || warnings[0].Path != "contact.orders" {
		t.Fatalf("varování = %+v", warnings)
	}
}

func TestDecodeKeepsNullValues(t *testing.T) {
	data, _, err := DecodeRenderData([]byte(`{"contact":{"city":null}}`))
	if err != nil {
		t.Fatal(err)
	}
	c, ok := data["contact"].(map[string]any)
	if !ok {
		t.Fatal("contact chybí")
	}
	if _, present := c["city"]; !present {
		t.Fatal("null se nesmí vynechávat, kontrakt to výslovně říká")
	}
}

func TestDecodeEmptyObject(t *testing.T) {
	data, warnings, err := DecodeRenderData([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(data) != 0 || len(warnings) != 0 {
		t.Fatalf("data = %v, warnings = %v", data, warnings)
	}
}

func TestDecodeRejectsInvalidJSON(t *testing.T) {
	if _, _, err := DecodeRenderData([]byte(`{není json`)); err == nil {
		t.Fatal("neplatný JSON musí být chyba")
	}
}

// Limit velikosti výstupu vede na body_too_large.
func TestRenderRejectsOversizedOutput(t *testing.T) {
	e, err := New(Options{Timezone: "UTC", MaxOutputBytes: 64})
	if err != nil {
		t.Fatal(err)
	}
	p, err := Prepare(`{{ contact.x }}`, ContextHTML)
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.Render(p.Source, map[string]any{"contact": map[string]any{"x": strings.Repeat("a", 200)}})
	if err != ErrOutputTooLarge {
		t.Fatalf("chyba = %v, chci ErrOutputTooLarge", err)
	}
}
