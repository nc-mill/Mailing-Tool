package liquidx

import (
	"encoding/json"
	"testing"
)

func mustEngine(t *testing.T) *Engine {
	t.Helper()
	e, err := New(Options{Timezone: "Europe/Prague"})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func render(t *testing.T, src string, data map[string]any) string {
	t.Helper()
	p, err := Prepare(src, ContextText)
	if err != nil {
		t.Fatalf("Prepare(%q): %v", src, err)
	}
	out, err := mustEngine(t).Render(p.Source, data)
	if err != nil {
		t.Fatalf("Render(%q): %v", src, err)
	}
	return out
}

func renderHTML(t *testing.T, src string, data map[string]any) string {
	t.Helper()
	p, err := Prepare(src, ContextHTML)
	if err != nil {
		t.Fatalf("Prepare(%q): %v", src, err)
	}
	out, err := mustEngine(t).Render(p.Source, data)
	if err != nil {
		t.Fatalf("Render(%q): %v", src, err)
	}
	return out
}

// Filtr default vrací argument pro nil, false, prázdný řetězec a prázdné pole.
// Nula prázdná NENÍ.
func TestDefaultFilterMatchesContract(t *testing.T) {
	cases := []struct {
		name  string
		value any
		want  string
	}{
		{"nil", nil, "kolego"},
		{"prázdný řetězec", "", "kolego"},
		{"false", false, "kolego"},
		{"prázdné pole", []any{}, "kolego"},
		{"nula", json.Number("0"), "0"},
		{"hodnota", "Jana", "Jana"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			got := render(t, `{{ contact.first_name | default: "kolego" }}`,
				map[string]any{"contact": map[string]any{"first_name": c.value}})
			if got != c.want {
				t.Fatalf("got %q, chci %q", got, c.want)
			}
		})
	}
}

// Simple uppercase mapping: ß zůstává ß. Full mapping (SS) je chování JavaScriptu
// a kontrakt ho výslovně nechce.
func TestUpcaseUsesSimpleMapping(t *testing.T) {
	if got := render(t, `{{ contact.x | upcase }}`,
		map[string]any{"contact": map[string]any{"x": "ěščřžýáíé"}}); got != "ĚŠČŘŽÝÁÍÉ" {
		t.Errorf("české znaky: got %q", got)
	}
	if got := render(t, `{{ contact.x | upcase }}`,
		map[string]any{"contact": map[string]any{"x": "straße"}}); got != "STRAßE" {
		t.Errorf("ß: got %q, kontrakt předepisuje simple mapping, tedy ß zůstává", got)
	}
}

func TestDowncase(t *testing.T) {
	if got := render(t, `{{ contact.x | downcase }}`,
		map[string]any{"contact": map[string]any{"x": "JANA"}}); got != "jana" {
		t.Fatalf("got %q", got)
	}
}

// Filtr escape je v obou kontextech no-op. Escapuje se automaticky.
func TestEscapeFilterIsNoOp(t *testing.T) {
	got := render(t, `{{ contact.x | escape }}`,
		map[string]any{"contact": map[string]any{"x": `a<b`}})
	if got != "a<b" {
		t.Fatalf("got %q, v textovém kontextu se neescapuje nic", got)
	}
}

// AK-6.17: automatické escapování v HTML kontextu produkuje &quot; pro uvozovku,
// ne &#34;. Ověřuje, že se nepoužil vestavěný escaper Go.
func TestHTMLContextEscapesWithContractEntities(t *testing.T) {
	got := renderHTML(t, `{{ contact.x }}`,
		map[string]any{"contact": map[string]any{"x": `<a href="x">&'`}})
	want := `&lt;a href=&quot;x&quot;&gt;&amp;&#39;`
	if got != want {
		t.Fatalf("got %q\nchci %q", got, want)
	}
}

// Filtry se aplikují PŘED escapováním, jinak by upcase pracoval nad entitami.
func TestEscapingHappensAfterFilters(t *testing.T) {
	got := renderHTML(t, `{{ contact.x | upcase }}`,
		map[string]any{"contact": map[string]any{"x": "a&b"}})
	if got != "A&amp;B" {
		t.Fatalf("got %q, chci A&amp;B", got)
	}
}

// K11: filtr safe nesmí obejít automatické escapování. Náš safe je identita
// a stringifikace i escapování běží až za ním.
func TestSafeFilterCannotBypassEscaping(t *testing.T) {
	e := mustEngine(t)
	// Prepare by | safe odmítl, tady jde o chování engine samotného.
	out, err := e.Render(`{{ contact.x | safe | ml_out_html }}`,
		map[string]any{"contact": map[string]any{"x": "<b>"}})
	if err != nil {
		t.Fatal(err)
	}
	if out != "&lt;b&gt;" {
		t.Fatalf("got %q, safe nesmí escapování obejít", out)
	}
}

// Chybějící proměnná je prázdný řetězec, nikdy chyba. Platí i pro cestu
// s chybějícím mezičlenem.
func TestMissingVariableRendersEmpty(t *testing.T) {
	if got := render(t, `[{{ contact.address.city }}]`,
		map[string]any{"contact": map[string]any{}}); got != "[]" {
		t.Fatalf("got %q", got)
	}
}

// Pravdivost: falešné jsou JEN false a nil. Prázdný řetězec, nula a prázdné pole
// jsou pravdivé.
func TestTruthinessMatchesShopifySemantics(t *testing.T) {
	cases := []struct {
		name  string
		value any
		want  string
	}{
		{"prázdný řetězec", "", "ano"},
		{"nula", json.Number("0"), "ano"},
		{"prázdné pole", []any{}, "ano"},
		{"false", false, "ne"},
		{"nil", nil, "ne"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			got := render(t, `{% if contact.x %}ano{% else %}ne{% endif %}`,
				map[string]any{"contact": map[string]any{"x": c.value}})
			if got != c.want {
				t.Fatalf("got %q, chci %q", got, c.want)
			}
		})
	}
}

// Výstup čísel podle pravidla 6: celá bez desetinné části, desetinná s tečkou
// a bez koncových nul. Velká celá čísla nesmí projít přes float64.
func TestNumberOutputFollowsRuleSix(t *testing.T) {
	cases := []struct{ in, want string }{
		{"1", "1"},
		{"1.5", "1.5"},
		{"1.50", "1.5"},
		{"1.0", "1"},
		{"9007199254740993", "9007199254740993"},
	}
	for _, c := range cases {
		got := render(t, `{{ contact.x }}`,
			map[string]any{"contact": map[string]any{"x": json.Number(c.in)}})
		if got != c.want {
			t.Errorf("%s: got %q, chci %q", c.in, got, c.want)
		}
	}
}

func TestBooleanOutputIsLowercaseEnglish(t *testing.T) {
	if got := render(t, `{{ contact.x }}`,
		map[string]any{"contact": map[string]any{"x": true}}); got != "true" {
		t.Fatalf("got %q", got)
	}
}

// Pravidlo 8: prvky pole se spojí bez oddělovače.
func TestArrayOutputJoinsWithoutSeparator(t *testing.T) {
	got := render(t, `{{ contact.x }}`,
		map[string]any{"contact": map[string]any{"x": []any{"a", "b", "c"}}})
	if got != "abc" {
		t.Fatalf("got %q", got)
	}
}

// Neznámý filtr je chyba, ne tichý průchod. Kontraktní behaviorální test.
func TestUnknownFilterIsAnError(t *testing.T) {
	if _, err := mustEngine(t).Render(`{{ contact.x | vocative }}`,
		map[string]any{"contact": map[string]any{"x": "a"}}); err == nil {
		t.Fatal("neznámý filtr musí být chyba")
	}
}
