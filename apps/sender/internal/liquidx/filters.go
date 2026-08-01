package liquidx

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/osteele/liquid"
)

// FilterWhitelist je uzavřený výčet filtrů, které smí obsahovat kompilovaná
// šablona. Cokoliv jiného je contract_mismatch a kampaň se pozastaví.
// Filtry ml_out_html, ml_out_text a safe do šablony nikdy nepíše autor ani
// kompilace, injektuje je Prepare.
var FilterWhitelist = map[string]bool{
	"default":  true,
	"upcase":   true,
	"downcase": true,
	"date":     true,
	"escape":   true,
}

// htmlEscaper je přesně pět kontraktních náhrad. Vestavěný escaper Go se
// NEPOUŽÍVÁ: html.EscapeString produkuje &#34; místo kontraktem předepsaného
// &quot; a golden fixtures se porovnávají bajt po bajtu.
var htmlEscaper = strings.NewReplacer(
	"&", "&amp;",
	"<", "&lt;",
	">", "&gt;",
	`"`, "&quot;",
	"'", "&#39;",
)

func registerFilters(eng *liquid.Engine, loc *time.Location) {
	eng.RegisterFilter("default", filterDefault)
	eng.RegisterFilter("upcase", filterUpcase)
	eng.RegisterFilter("downcase", filterDowncase)
	eng.RegisterFilter("escape", filterEscape)
	eng.RegisterFilter("date", makeDateFilter(loc))

	// safe se registruje jako identita. Knihovna si vlastní safe zaregistruje jen
	// tehdy, když pod tím jménem nic není, takže náš zůstane. Ani kdyby se přesto
	// prosadil vestavěný, escapování se neobejde, protože ho dělá až ml_out_html.
	eng.RegisterFilter("safe", func(in any) any { return in })

	// Výstupní filtry. Prepare je injektuje do KAŽDÉHO {{ }} podle kontextu.
	// Existují proto, aby stringifikace hodnoty (pravidla 6, 7 a 8 kontraktu)
	// byla v HTML i v textu identická a aby escapování proběhlo až po filtrech.
	eng.RegisterFilter("ml_out_text", func(in any) string { return stringify(in) })
	eng.RegisterFilter("ml_out_html", func(in any) string { return htmlEscaper.Replace(stringify(in)) })
}

// filterDefault vrací argument, když je hodnota nil, false, prázdný řetězec nebo
// prázdné pole. Nula prázdná NENÍ. Argument je vždy literál doplněný kompilací.
func filterDefault(in any, def string) any {
	switch v := in.(type) {
	case nil:
		return def
	case bool:
		if !v {
			return def
		}
		return v
	case string:
		if v == "" {
			return def
		}
		return v
	case []any:
		if len(v) == 0 {
			return def
		}
		return v
	default:
		return in
	}
}

// filterUpcase používá simple uppercase mapping. Go strings.ToUpper se ho drží,
// tedy ß zůstává ß, zatímco JavaScript toUpperCase vrací SS.
func filterUpcase(in any) string { return strings.ToUpper(stringify(in)) }

func filterDowncase(in any) string { return strings.ToLower(stringify(in)) }

// filterEscape je no-op v obou kontextech. Zůstává v povolené sadě, aby seděl
// výčet z hlavní specifikace a aby šablony zkopírované odjinud nepadaly.
func filterEscape(in any) any { return in }

// stringify převádí hodnotu na text podle normativních pravidel 6, 7 a 8.
//
// Je to naše odpovědnost, ne knihovny: kdyby stringifikaci dělala knihovna,
// lišila by se mezi HTML a textovým kontextem, protože v HTML jde hodnota přes
// escapovací filtr a v textu ne.
func stringify(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case json.Number:
		return normalizeNumber(t.String())
	case float64:
		return normalizeNumber(strconv.FormatFloat(t, 'f', -1, 64))
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case []any:
		var b strings.Builder
		for _, item := range t {
			b.WriteString(stringify(item))
		}
		return b.String()
	case map[string]any:
		// Kontrakt výstup objektu nedefinuje a validátor na něj dává varování.
		// Prázdný řetězec je jediná volba, která nemůže vypsat vnitřek objektu
		// do těla e-mailu.
		return ""
	default:
		return ""
	}
}

// normalizeNumber ořízne koncové nuly za desetinnou tečkou a osamocenou tečku.
// Celočíselný zápis zůstává beze změny, takže se velká čísla neztratí v float64.
func normalizeNumber(s string) string {
	if !strings.Contains(s, ".") {
		return s
	}
	s = strings.TrimRight(s, "0")
	s = strings.TrimSuffix(s, ".")
	if s == "" || s == "-" {
		return "0"
	}
	return s
}
