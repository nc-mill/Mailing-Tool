package liquidx

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

// Context rozlišuje, do jakého kontextu se šablona renderuje.
type Context int

const (
	// ContextHTML je HTML část zprávy. Výstup každého {{ }} se escapuje.
	ContextHTML Context = iota
	// ContextText je textová část, předmět a preheader. Neescapuje se nic.
	// Předmět není HTML a &amp; v předmětu vidí každý příjemce.
	ContextText
)

// PrepareError nese kód z katalogu chyb senderu. Výsledkem je vždy pozastavení
// kampaně, nikdy selhání jedné zprávy: obojí jsou vlastnosti zkompilované šablony,
// ne konkrétního příjemce.
type PrepareError struct {
	Code   string
	Detail string
}

func (e *PrepareError) Error() string { return e.Code + ": " + e.Detail }

func asPrepareError(err error, target **PrepareError) bool { return errors.As(err, target) }

// Prepared je zdroj šablony připravený k renderu.
type Prepared struct {
	// Source je zdroj po injektáži výstupního filtru a po přepisu blank a empty.
	Source string
	// BlankPaths jsou cesty, pro které se před renderem dopočítá vazba _blank.
	BlankPaths []string
}

var forbiddenEntities = []string{"&quot;", "&#39;", "&lt;", "&gt;", "&amp;"}

// Prepare zkontroluje a upraví zdroj kompilované šablony.
//
// Běží JEDNOU na dvojici (kampaň, revize), ne na zprávu. Dělá tři věci:
//
//  1. V1: odmítne HTML entitu uvnitř {{ }} nebo {% %}. Je to záchytná síť proti
//     tomu, aby se escapovaná šablona dostala k odeslání.
//  2. V2: odmítne filtr mimo kontraktní pětici. Je to zároveň implementace
//     kontraktního pravidla "render s filtrem mimo pětici musí selhat" a kryje
//     nález K11 o tichém filtru safe. Stejně tak odmítne TAG mimo kontraktní
//     seznam (viz tags.go): dokud se kontroloval jen filtr, prošlo
//     {% include %} a přečetlo libovolný soubor (nález N1).
//  3. Injektuje výstupní filtr do každého {{ }} a přepíše porovnání s blank
//     a empty, které lexer osteele/liquid nezná (nález K4).
func Prepare(source string, ctx Context) (Prepared, error) {
	outFilter := "ml_out_html"
	if ctx == ContextText {
		outFilter = "ml_out_text"
	}

	var b strings.Builder
	b.Grow(len(source) + len(source)/8)
	blank := map[string]bool{}

	i := 0
	for i < len(source) {
		j := strings.IndexByte(source[i:], '{')
		if j < 0 {
			b.WriteString(source[i:])
			break
		}
		j += i
		if j+1 >= len(source) || (source[j+1] != '{' && source[j+1] != '%') {
			b.WriteString(source[i : j+1])
			i = j + 1
			continue
		}
		isOutput := source[j+1] == '{'
		closeTok := "%}"
		if isOutput {
			closeTok = "}}"
		}
		rel := strings.Index(source[j+2:], closeTok)
		if rel < 0 {
			return Prepared{}, &PrepareError{
				Code:   "contract_mismatch",
				Detail: fmt.Sprintf("neuzavřená Liquid konstrukce na pozici %d", j),
			}
		}
		end := j + 2 + rel
		inner := source[j+2 : end]

		for _, ent := range forbiddenEntities {
			if strings.Contains(inner, ent) {
				return Prepared{}, &PrepareError{
					Code:   "liquid_escaped_entity_in_construct",
					Detail: fmt.Sprintf("entita %s uvnitř konstrukce %q", ent, strings.TrimSpace(inner)),
				}
			}
		}

		if err := checkComparisonOperators(inner, isOutput); err != nil {
			return Prepared{}, err
		}

		b.WriteString(source[i:j])
		if isOutput {
			if err := checkFilters(inner); err != nil {
				return Prepared{}, err
			}
			b.WriteString("{{")
			b.WriteString(inner)
			b.WriteString(" | ")
			b.WriteString(outFilter)
			b.WriteString(" }}")
		} else {
			// V2b: tag mimo kontraktní seznam. Musí se odmítnout HLASITĚ, ne
			// tiše přeskočit: {% include %} standardní sady knihovny čte soubory
			// z disku a předmět kampaně jde do Prepare přímo z databáze.
			if err := checkTag(inner); err != nil {
				return Prepared{}, err
			}
			rewritten, paths := rewriteBlank(inner)
			for _, p := range paths {
				blank[p] = true
			}
			b.WriteString("{%")
			b.WriteString(rewritten)
			b.WriteString("%}")
		}
		i = end + 2
	}

	paths := make([]string, 0, len(blank))
	for p := range blank {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	return Prepared{Source: b.String(), BlankPaths: paths}, nil
}

// checkComparisonOperators odmítá >, <, >= a <= v podmínkách.
//
// Rozhodl zadavatel 1. 8. 2026 (rozhodnutí R7): v MVP 0 se nepovolují ze stejného
// důvodu jako uvozovky, totiž že je renderer při převodu do HTML nahradí entitami
// &gt; a &lt; a podmínka přestane být platná. Kdo potřebuje porovnávat, použije
// segment. Zařazeno do MVP 1.
//
// Validátor na TypeScript straně je odmítá týmž kódem a existuje na to fixture
// LQ-509. Sender kontroluje totéž, protože kompilovanou šablonu dostává z databáze
// a nemá jak vědět, že prošla dnešní verzí validátoru: kampaň zkompilovaná dřív
// tuhle kontrolu minula.
//
// Kontroluje se AŽ PO kontrole entit, takže `&gt;` uvnitř konstrukce ohlásí
// liquid_escaped_entity_in_construct, což je přesnější popis téže vady.
func checkComparisonOperators(inner string, isOutput bool) error {
	// Ve výstupu je > jen uvnitř náhradní hodnoty filtru default, kterou kontrakt
	// stejně zakazuje, takže se kontrola pouští na obojí.
	for _, op := range []string{">=", "<=", ">", "<"} {
		if strings.Contains(inner, op) {
			return &PrepareError{
				Code: "liquid_comparison_operator_not_supported",
				Detail: fmt.Sprintf("operátor %s v konstrukci %q; v MVP 0 se nepovoluje, "+
					"renderer ho převede na entitu a podmínka přestane platit. Použij segment", op,
					strings.TrimSpace(inner)),
			}
		}
	}
	return nil
}

// checkFilters ověří, že každý použitý filtr je v kontraktní pětici.
func checkFilters(inner string) error {
	segments := splitPipes(inner)
	for _, seg := range segments[1:] {
		name := strings.TrimSpace(seg)
		if idx := strings.IndexByte(name, ':'); idx >= 0 {
			name = strings.TrimSpace(name[:idx])
		}
		if name == "" {
			return &PrepareError{Code: "contract_mismatch", Detail: "prázdný název filtru"}
		}
		if !FilterWhitelist[name] {
			return &PrepareError{
				Code:   "contract_mismatch",
				Detail: fmt.Sprintf("filtr %q není v kontraktní pětici", name),
			}
		}
	}
	return nil
}

// splitPipes rozdělí výraz na svislítkách mimo řetězcové literály.
func splitPipes(s string) []string {
	var out []string
	var cur strings.Builder
	inQuote := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"':
			inQuote = !inQuote
			cur.WriteByte(c)
		case c == '|' && !inQuote:
			out = append(out, cur.String())
			cur.Reset()
		default:
			cur.WriteByte(c)
		}
	}
	out = append(out, cur.String())
	return out
}

func isBlankLiteral(tok string) bool { return tok == "blank" || tok == "empty" }

// pathSlug převádí cestu na klíč vazby _blank. Konvence je stejná jako
// u kontraktního kořene _present.<slug>, tedy tečka na dvojité podtržítko.
func pathSlug(path string) string { return strings.ReplaceAll(path, ".", "__") }

// rewriteBlank přepíše porovnání s literály blank a empty na porovnání
// s dopočítanou vazbou.
//
// Lexer osteele/liquid v1.8.1 zná jen true, false a nil (expressions/scanner.rl),
// takže by blank prolezl jako běžný identifikátor a vyhodnotil se na nil.
// "" == nil je v Go nepravda a v LiquidJS pravda, takže by uživatel viděl
// v náhledu jinou větev než v odeslaném mailu.
//
// blank a empty se přepisují stejně, protože kontraktní pravidlo 4 definuje
// pro obě literály JEDNU množinu pravdivosti.
func rewriteBlank(inner string) (string, []string) {
	f := strings.Fields(inner)
	out := make([]string, 0, len(f))
	var paths []string
	for i := 0; i < len(f); i++ {
		if i+2 < len(f) && (f[i+1] == "==" || f[i+1] == "!=") {
			lhs, op, rhs := f[i], f[i+1], f[i+2]
			path := ""
			switch {
			case isBlankLiteral(rhs) && !isBlankLiteral(lhs):
				path = lhs
			case isBlankLiteral(lhs) && !isBlankLiteral(rhs):
				path = rhs
			}
			if path != "" {
				want := "true"
				if op == "!=" {
					want = "false"
				}
				out = append(out, "_blank."+pathSlug(path), "==", want)
				paths = append(paths, path)
				i += 2
				continue
			}
		}
		out = append(out, f[i])
	}
	return " " + strings.Join(out, " ") + " ", paths
}
