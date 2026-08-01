package liquidx

import (
	"strings"
	"testing"
)

func TestPrepareInjectsOutputFilterIntoEveryOutput(t *testing.T) {
	p, err := Prepare(`Ahoj {{ contact.first_name }}, {{ contact.city | upcase }}!`, ContextHTML)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(p.Source, "ml_out_html") != 2 {
		t.Fatalf("injektáž proběhla %d krát, čekám 2:\n%s", strings.Count(p.Source, "ml_out_html"), p.Source)
	}
	if strings.Contains(p.Source, "ml_out_text") {
		t.Fatal("do HTML kontextu se vloudil textový výstupní filtr")
	}
}

func TestPrepareUsesTextFilterInTextContext(t *testing.T) {
	p, err := Prepare(`{{ contact.first_name }}`, ContextText)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(p.Source, "ml_out_text") {
		t.Fatalf("chybí textový výstupní filtr:\n%s", p.Source)
	}
}

func TestPrepareLeavesTagsAlone(t *testing.T) {
	p, err := Prepare(`{% if contact.is_vip %}ano{% endif %}`, ContextHTML)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(p.Source, "ml_out_html") {
		t.Fatal("výstupní filtr se vložil do tagu, tam nepatří")
	}
}

// Nález K4. Literály blank a empty v osteele/liquid neexistují, takže se
// porovnání přepisuje na dopočítanou vazbu _blank.
func TestPrepareRewritesBlankComparison(t *testing.T) {
	p, err := Prepare(`{% if contact.first_name == blank %}A{% else %}B{% endif %}`, ContextHTML)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(p.Source, "_blank.contact__first_name == true") {
		t.Fatalf("přepis neproběhl:\n%s", p.Source)
	}
	if len(p.BlankPaths) != 1 || p.BlankPaths[0] != "contact.first_name" {
		t.Fatalf("BlankPaths = %v", p.BlankPaths)
	}
}

func TestPrepareRewritesAllBlankAndEmptyForms(t *testing.T) {
	cases := []struct{ in, want string }{
		{`{% if a.b == blank %}x{% endif %}`, "_blank.a__b == true"},
		{`{% if a.b != blank %}x{% endif %}`, "_blank.a__b == false"},
		{`{% if a.b == empty %}x{% endif %}`, "_blank.a__b == true"},
		{`{% if a.b != empty %}x{% endif %}`, "_blank.a__b == false"},
		{`{% if blank == a.b %}x{% endif %}`, "_blank.a__b == true"},
		{`{% unless a.b == blank %}x{% endunless %}`, "_blank.a__b == true"},
		{`{% elsif a.b == blank %}x`, "_blank.a__b == true"},
	}
	for _, c := range cases {
		p, err := Prepare(c.in, ContextText)
		if err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if !strings.Contains(p.Source, c.want) {
			t.Errorf("%s\n got %s\nchci obsahovat %s", c.in, p.Source, c.want)
		}
	}
}

// AK-6.15: fixture s blank musí v Go vybrat stejnou větev jako v LiquidJS.
func TestBlankComparisonPicksSameBranchAsLiquidJS(t *testing.T) {
	src := `{% if contact.first_name == blank %}Dobrý den{% else %}Dobrý den, {{ contact.first_name }}{% endif %}`
	cases := []struct {
		name  string
		value any
		want  string
	}{
		{"prázdný řetězec", "", "Dobrý den"},
		{"jen mezery", "   ", "Dobrý den"},
		{"nil", nil, "Dobrý den"},
		{"prázdné pole", []any{}, "Dobrý den"},
		{"hodnota", "Jana", "Dobrý den, Jana"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			p, err := Prepare(src, ContextText)
			if err != nil {
				t.Fatal(err)
			}
			data := map[string]any{"contact": map[string]any{"first_name": c.value}}
			bindings := WithBlankBindings(data, p.BlankPaths)
			got, err := mustEngine(t).Render(p.Source, bindings)
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("got %q, chci %q", got, c.want)
			}
		})
	}
}

// AK-6.24, V1: HTML entita uvnitř konstrukce je chyba, ne tichý průchod.
func TestPrepareRejectsHTMLEntityInsideConstruct(t *testing.T) {
	for _, src := range []string{
		`{{ contact.first_name | default: &quot;kolego&quot; }}`,
		`{{ contact.x | default: &#39;a&#39; }}`,
		`{% if contact.score &gt; 5 %}x{% endif %}`,
		`{% if a &amp;&amp; b %}x{% endif %}`,
		`{{ a &lt; b }}`,
	} {
		_, err := Prepare(src, ContextHTML)
		if err == nil {
			t.Errorf("%s: escapovaná šablona prošla", src)
			continue
		}
		var pe *PrepareError
		if !asPrepareError(err, &pe) || pe.Code != "liquid_escaped_entity_in_construct" {
			t.Errorf("%s: chyba = %v, chci liquid_escaped_entity_in_construct", src, err)
		}
	}
}

// V2: filtr mimo pětici je contract_mismatch. Kryje i nález K11 o filtru safe.
func TestPrepareRejectsFilterOutsideWhitelist(t *testing.T) {
	for _, src := range []string{
		`{{ contact.x | safe }}`,
		`{{ contact.x | vocative }}`,
		`{{ contact.x | upcase | truncate: "5" }}`,
	} {
		_, err := Prepare(src, ContextHTML)
		if err == nil {
			t.Errorf("%s: prošlo", src)
			continue
		}
		var pe *PrepareError
		if !asPrepareError(err, &pe) || pe.Code != "contract_mismatch" {
			t.Errorf("%s: chyba = %v, chci contract_mismatch", src, err)
		}
	}
}

func TestPrepareAcceptsAllFiveContractFilters(t *testing.T) {
	src := `{{ a | default: "x" }}{{ a | upcase }}{{ a | downcase }}{{ a | date: "%H:%M" }}{{ a | escape }}`
	if _, err := Prepare(src, ContextHTML); err != nil {
		t.Fatalf("kontraktní filtry neprošly: %v", err)
	}
}

func TestPrepareRejectsUnclosedConstruct(t *testing.T) {
	if _, err := Prepare(`{{ contact.x `, ContextHTML); err == nil {
		t.Fatal("neuzavřená konstrukce musí být chyba")
	}
}

func TestBlankValueFollowsContractRuleFour(t *testing.T) {
	cases := []struct {
		value any
		want  bool
	}{
		{nil, true},
		{"", true},
		{"   ", true},
		{[]any{}, true},
		{map[string]any{}, true},
		{"a", false},
		{[]any{"a"}, false},
		{false, false},
		{map[string]any{"a": 1}, false},
	}
	for _, c := range cases {
		if got := IsBlank(c.value); got != c.want {
			t.Errorf("IsBlank(%#v) = %v, chci %v", c.value, got, c.want)
		}
	}
}
