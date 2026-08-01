package liquidx

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// MaxLoopItems je kontraktní limit iterací v jednom for cyklu.
const MaxLoopItems = 200

// Warning je běhové varování renderu.
type Warning struct {
	Code string
	Path string
}

// DecodeRenderData převede messages.render_data na bindings.
//
// Dekóduje s UseNumber. Bez toho by encoding/json namapoval všechna čísla na
// float64, celé číslo nad 2^53 by ztratilo přesnost a vypsalo by se jinak než
// v LiquidJS. Reálný případ je číslo objednávky nebo variabilní symbol.
//
// Pole delší než 200 prvků se ořízne na prvních 200, protože limit iterací nejde
// vynutit uvnitř knihovny. Obě strany to musí dělat identicky, jinak se výstup
// rozejde u 201. prvku.
func DecodeRenderData(raw []byte) (map[string]any, []Warning, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var root map[string]any
	if err := dec.Decode(&root); err != nil {
		return nil, nil, fmt.Errorf("render_data není platný JSON objekt: %w", err)
	}
	if root == nil {
		root = map[string]any{}
	}
	var warnings []Warning
	truncate(root, "", &warnings)
	sort.Slice(warnings, func(i, j int) bool { return warnings[i].Path < warnings[j].Path })
	return root, warnings, nil
}

// RenderSchema je Go protějšek typu z kontraktu. Presence jsou cesty, pro které
// TypeScript strana počítá kořen _present.
type RenderSchema struct {
	Presence []string
}

// PrepareRenderData je Go protějšek sdílené funkce prepareRenderData z kontraktu.
//
// V PROVOZU ji volá aplikace při materializaci outboxu a sender dostane hotová
// data; tahle funkce existuje proto, aby šlo pouštět golden fixtures, které nesou
// syrová data a seznam cest zvlášť, a aby se obě strany daly porovnat.
//
// Pravdivost musí sedět BAJT NA BAJT s TypeScriptem, jinak náhled ukáže jiné
// bloky než odeslaný mail.
func PrepareRenderData(raw []byte, schema RenderSchema) (map[string]any, []Warning, error) {
	data, warnings, err := DecodeRenderData(raw)
	if err != nil {
		return nil, nil, err
	}
	ctx, _ := data["_context"].(map[string]any)
	if ctx == nil {
		ctx = map[string]any{}
	}
	tz, _ := ctx["timezone"].(string)
	if tz == "" {
		tz = "UTC"
	}
	loc, _ := ctx["locale"].(string)
	if loc == "" {
		loc = "cs"
	}
	data["_context"] = map[string]any{"timezone": tz, "locale": loc}

	if len(schema.Presence) > 0 {
		present := map[string]any{}
		for _, p := range schema.Presence {
			present[strings.ReplaceAll(p, ".", "__")] = IsPresent(LookupPath(data, p))
		}
		data["_present"] = present
	}
	return data, warnings, nil
}

// IsPresent je pravdivost kořene _present. Kopíruje funkci isPresent z kontraktu
// a POZOR, není to negace IsBlank: prázdný objekt je podle kontraktu present,
// kdežto podle pravidla 4 je blank. Jsou to dvě různá pravidla pro dvě různé věci
// a sjednotit je nejde.
func IsPresent(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return strings.TrimSpace(t) != ""
	case []any:
		return len(t) > 0
	default:
		return true
	}
}

// TimezoneOf vrací časovou zónu z _context, nebo UTC.
func TimezoneOf(data map[string]any) string {
	if ctx, ok := data["_context"].(map[string]any); ok {
		if tz, ok := ctx["timezone"].(string); ok && tz != "" {
			return tz
		}
	}
	return "UTC"
}

// presenceRef hledá odkazy na kořen _present ve zdroji šablony.
var presenceRef = regexp.MustCompile(`_present\.([A-Za-z0-9_]+)`)

// RequirePresence je kontrola V7 a je to jediná ochrana proti tichému zmizení
// podmíněných bloků.
//
// Kořen _present sender NEVYRÁBÍ. Počítá ho aplikace při materializaci outboxu
// a posílá ho uvnitř render_data. Kdyby ho nespočítala, chybějící klíč se v Liquidu
// vyhodnotí jako nil, tedy nepravda, každý podmíněný blok by se skryl a NIC by
// nespadlo. Příjemce by dostal mail bez celých sekcí a nikdo by se to nedozvěděl.
//
// Proto se tady chybějící kořen mění na tvrdou chybu zprávy.
func RequirePresence(source string, data map[string]any) error {
	refs := presenceRef.FindAllStringSubmatch(source, -1)
	if len(refs) == 0 {
		return nil
	}
	present, ok := data["_present"].(map[string]any)
	if !ok {
		return &PrepareError{
			Code: "render_data_missing_presence",
			Detail: "šablona se ptá na _present, ale render_data ten kořen nemá. " +
				"Počítá ho prepareRenderData při materializaci outboxu (P13); bez něj by se " +
				"podmíněné bloky tiše skryly",
		}
	}
	for _, m := range refs {
		if _, ok := present[m[1]]; !ok {
			return &PrepareError{
				Code:   "render_data_missing_presence",
				Detail: fmt.Sprintf("_present.%s chybí v render_data, blok by se tiše skryl", m[1]),
			}
		}
	}
	return nil
}

func truncate(node any, path string, warnings *[]Warning) {
	switch v := node.(type) {
	case map[string]any:
		for key, child := range v {
			childPath := key
			if path != "" {
				childPath = path + "." + key
			}
			if arr, ok := child.([]any); ok && len(arr) > MaxLoopItems {
				v[key] = arr[:MaxLoopItems]
				*warnings = append(*warnings, Warning{Code: "array_truncated", Path: childPath})
				truncate(v[key], childPath, warnings)
				continue
			}
			truncate(child, childPath, warnings)
		}
	case []any:
		for _, child := range v {
			truncate(child, path, warnings)
		}
	}
}
