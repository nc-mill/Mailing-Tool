package liquidx_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/liquidx"
)

// TestIncludeNeprecteSoubor je regresní test nálezu N1. Do 8. 8. 2026 vracel
// {% include %} v předmětu kampaně OBSAH SOUBORU, tedy třeba SECRET_KEY z .env.
func TestIncludeNeprecteSoubor(t *testing.T) {
	dir := t.TempDir()
	secret := filepath.Join(dir, "secret.env")
	if err := os.WriteFile(secret, []byte("SECRET_KEY=topsecret-poc\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	// Průchod nad kořen. Knihovna z absolutní cesty uřízne úvodní lomítko
	// a skládá ji vůči pracovnímu adresáři, takže PoC musí být relativní;
	// s dvaceti úrovněmi nahoru se z libovolného pracovního adresáře v repozitáři
	// dojde ke kořeni. Ověřeno spuštěním: bez opravy vrátí obsah souboru.
	traversal := strings.Repeat("../", 20) + strings.TrimPrefix(secret, "/")
	sources := []string{
		`{% include "` + secret + `" %}`,
		`{% include "` + traversal + `" %}`,
	}
	for _, src := range sources {
		if _, err := liquidx.Prepare(src, liquidx.ContextText); err == nil {
			t.Fatalf("Prepare pustil %q", src)
		}

		// Druhá vrstva: i kdyby se Prepare obešlo, engine soubor nepřečte.
		eng, err := liquidx.New(liquidx.Options{})
		if err != nil {
			t.Fatal(err)
		}
		out, err := eng.Render(src, map[string]any{})
		if err == nil {
			t.Fatalf("Render pustil %q a vrátil %q", src, out)
		}
		if strings.Contains(out, "topsecret-poc") {
			t.Fatalf("obsah souboru unikl do výstupu: %q", out)
		}
	}
}

// TestZakazaneTagySelzouHlasite ověří, že se tag mimo kontrakt neignoruje tiše.
func TestZakazaneTagySelzouHlasite(t *testing.T) {
	cases := []string{
		`{% include "x" %}`,
		`{%- include "x" -%}`,
		`{% assign x = 1 %}`,
		`{% capture x %}y{% endcapture %}`,
		`{% case x %}{% when 1 %}a{% endcase %}`,
		`{% comment %}x{% endcomment %}`,
		`{% raw %}x{% endraw %}`,
		`{% tablerow x in y %}{% endtablerow %}`,
		`{% cycle "a", "b" %}`,
		`{% break %}`,
		`{% continue %}`,
		`{%  %}`,
	}
	for _, src := range cases {
		_, err := liquidx.Prepare(src, liquidx.ContextText)
		if err == nil {
			t.Fatalf("Prepare pustil zakázaný tag: %q", src)
		}
		var pe *liquidx.PrepareError
		if !errors.As(err, &pe) {
			t.Fatalf("%q: čekal se PrepareError, přišlo %T", src, err)
		}
		if pe.Code != "contract_mismatch" {
			t.Fatalf("%q: kód %q, čekal se contract_mismatch", src, pe.Code)
		}
	}
}

// TestPovoleneTagyProchazeji hlídá druhou půlku opravy: legitimní Liquid se
// nesmí rozbít. Bez tohohle testu by seznam povolených tagů šel "opravit"
// tak, že přestanou fungovat podmínky a cykly v kampaních.
func TestPovoleneTagyProchazeji(t *testing.T) {
	eng, err := liquidx.New(liquidx.Options{})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		src  string
		want string
	}{
		{`{{ contact.first_name }}`, "Jana"},
		{`{% if contact.vip %}A{% else %}B{% endif %}`, "A"},
		{`{% if contact.nic %}A{% elsif contact.vip %}C{% else %}B{% endif %}`, "C"},
		{`{% unless contact.vip %}U{% endunless %}`, ""},
		{`{% for t in contact.tags %}{{ t }},{% endfor %}`, "a,b,"},
		{`{{ contact.first_name | upcase }}`, "JANA"},
	}
	data := map[string]any{
		"contact": map[string]any{
			"first_name": "Jana",
			"vip":        true,
			"tags":       []any{"a", "b"},
		},
	}
	for _, c := range cases {
		prepared, err := liquidx.Prepare(c.src, liquidx.ContextText)
		if err != nil {
			t.Fatalf("Prepare odmítl legitimní %q: %v", c.src, err)
		}
		out, err := eng.Render(prepared.Source, liquidx.WithBlankBindings(data, prepared.BlankPaths))
		if err != nil {
			t.Fatalf("Render selhal na %q: %v", c.src, err)
		}
		if out != c.want {
			t.Fatalf("%q: výstup %q, čekalo se %q", c.src, out, c.want)
		}
	}
}
