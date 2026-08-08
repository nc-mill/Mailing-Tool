package liquidx

import (
	"fmt"
	"strings"

	"github.com/osteele/liquid"
)

// TagWhitelist je uzavřený výčet tagů, které smí obsahovat kompilovaná šablona.
// Zdroj pravdy je ALLOWED_TAGS v packages/contracts/src/liquid/grammar.ts, tedy
// tři blokové tagy plus jejich větve a uzávěry. Cokoliv jiného je
// contract_mismatch a kampaň se pozastaví.
//
// PROČ TENHLE SEZNAM VŮBEC EXISTUJE. Do 8. 8. 2026 kontrolovala příprava zdroje
// jen FILTRY uvnitř {{ }}, kdežto tagy pouštěla, jak je knihovna zná. Standardní
// sada osteele/liquid obsahuje include, který čte soubory z disku, a cesta se
// skládá bez omezení na kořen. Předmět kampaně přitom míří do Prepare přímo
// z databáze, takže {% include "../../../../app/.env" %} v předmětu doručilo
// obsah souboru do hlavičky Subject. Ověřeno spuštěním, nález N1.
var TagWhitelist = map[string]bool{
	"if":        true,
	"elsif":     true,
	"else":      true,
	"endif":     true,
	"unless":    true,
	"endunless": true,
	"for":       true,
	"endfor":    true,
}

// removableStandardTags jsou standardní tagy registrované přes AddTag, které
// v kontraktu nemají co dělat. Knihovna umí odregistrovat jen tyhle: BLOKY
// (capture, case, comment, raw, tablerow) drží v neexportované mapě blockDefs
// a UnregisterBlock neexistuje. Blokům proto brání seznam výš v Prepare, což je
// stejně ta vrstva, která rozhoduje: kdyby se knihovna vyměnila za jinou se
// zcela jinou sadou tagů, seznam povolených jmen platí dál.
var removableStandardTags = []string{"include", "assign", "break", "continue", "cycle"}

// denyTemplateStore odmítá jakékoliv čtení šablony ze souborového systému.
//
// Je to druhá pojistka pod seznamem tagů: i kdyby budoucí verze knihovny
// přidala další tag nad ReadTemplate, nebo kdyby se Prepare někdy obešlo,
// vrátí se chyba místo obsahu souboru. Výchozí FileTemplateStore knihovny čte
// libovolnou cestu včetně ../, viz render/file_template_store.go.
type denyTemplateStore struct{}

func (denyTemplateStore) ReadTemplate(name string) ([]byte, error) {
	return nil, fmt.Errorf("čtení šablony ze souborového systému je zakázané (%q)", name)
}

// hardenTags odebere z enginu tagy, které kontrakt nezná, a zavře čtení souborů.
func hardenTags(eng *liquid.Engine) {
	for _, name := range removableStandardTags {
		eng.UnregisterTag(name)
	}
	eng.RegisterTemplateStore(denyTemplateStore{})
}

// tagName vytáhne jméno tagu z vnitřku konstrukce {% ... %}.
//
// Řízení bílých znaků (`{%- if x -%}`) kontrakt nepovoluje, ale odstranit
// pomlčky se tu musí přesto: bez toho by se jméno přečetlo jako "-" a útočník
// by seznam obešel jediným znakem.
func tagName(inner string) string {
	s := strings.TrimSpace(inner)
	s = strings.TrimPrefix(s, "-")
	s = strings.TrimSuffix(s, "-")
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

// checkTag ověří, že jméno tagu je v kontraktním seznamu.
func checkTag(inner string) error {
	name := tagName(inner)
	if name == "" {
		return &PrepareError{Code: "contract_mismatch", Detail: "prázdný tag {% %}"}
	}
	if !TagWhitelist[name] {
		return &PrepareError{
			Code: "contract_mismatch",
			Detail: fmt.Sprintf("tag %q není v kontraktu 4.10.2; povolené jsou "+
				"if, elsif, else, endif, unless, endunless, for a endfor", name),
		}
	}
	return nil
}
