package liquidx

import "strings"

// IsBlank implementuje normativní pravidlo 4 kontraktu 4.10.2:
// x == blank je pravda pro nil, "", "   ", [] a {}.
func IsBlank(v any) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(t) == ""
	case []any:
		return len(t) == 0
	case map[string]any:
		return len(t) == 0
	default:
		return false
	}
}

// LookupPath projde tečkovou cestu v datech. Chybějící mezičlen znamená,
// že hodnota neexistuje, což je podle pravidla 1 totéž jako nil.
func LookupPath(data map[string]any, path string) any {
	cur := any(data)
	for _, seg := range strings.Split(path, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur, ok = m[seg]
		if !ok {
			return nil
		}
	}
	return cur
}

// WithBlankBindings doplní do dat kořen _blank s dopočítanou pravdivostí
// pro každou cestu, kterou Prepare našel. Volá se před renderem každé zprávy.
//
// Vrací mělkou kopii, aby se původní mapa nezměnila a šla použít znovu.
func WithBlankBindings(data map[string]any, paths []string) map[string]any {
	if len(paths) == 0 {
		return data
	}
	out := make(map[string]any, len(data)+1)
	for k, v := range data {
		out[k] = v
	}
	blank := make(map[string]any, len(paths))
	for _, p := range paths {
		blank[pathSlug(p)] = IsBlank(LookupPath(data, p))
	}
	out["_blank"] = blank
	return out
}
