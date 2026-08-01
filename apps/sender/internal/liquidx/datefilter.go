package liquidx

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// makeDateFilter vrací filtr date zafixovaný na jednu časovou zónu.
//
// SIGNATURA MUSÍ MÍT VSTUP any, nikdy time.Time. Vestavěný filtr v osteele/liquid
// má func(t time.Time, format func(string) string) a knihovna mu vstup převede sama.
// Náš vlastní filtr tuhle konverzi NEDOSTANE, protože si registrací vestavěný filtr
// přepisujeme. Kdo signaturu opíše z knihovny, dostane chybu na každé zprávě, ne
// při startu. Je to nejpravděpodobnější implementační chyba v celém senderu.
//
// Filtr NIKDY nevrací chybu. Chyba filtru by shodila celý render a zpráva by
// skončila jako render_failed, přestože kontrakt pro neplatný vstup předepisuje
// prázdný řetězec.
func makeDateFilter(loc *time.Location) func(in any, format string) string {
	return func(in any, format string) string {
		t, ok := parseDateInput(in)
		if !ok {
			return ""
		}
		return formatDate(t.In(loc), format)
	}
}

func parseDateInput(in any) (time.Time, bool) {
	switch v := in.(type) {
	case string:
		if v == "now" {
			return time.Now(), true
		}
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return time.Time{}, false
		}
		return t, true
	case json.Number:
		n, err := v.Int64()
		if err != nil {
			return time.Time{}, false
		}
		return time.Unix(n, 0), true
	case float64:
		return time.Unix(int64(v), 0), true
	case int:
		return time.Unix(int64(v), 0), true
	case int64:
		return time.Unix(v, 0), true
	default:
		return time.Time{}, false
	}
}

// formatDate je switch nad pěti konstantami z whitelistu, ne obecný strftime.
// Balíček osteele/tuesday, o který se vestavěný date opírá, tím není potřeba vůbec.
func formatDate(t time.Time, format string) string {
	switch format {
	case "%d.%m.%Y":
		return t.Format("02.01.2006")
	case "%-d.%-m.%Y":
		// time.Format nemá nepaddovanou variantu, skládá se ručně.
		// Je to jediné místo, kde se implementace může rozejít s TypeScriptem,
		// a patří na něj vlastní fixture s jednociferným dnem i měsícem.
		return fmt.Sprintf("%d.%d.%s", t.Day(), int(t.Month()), strconv.Itoa(t.Year()))
	case "%Y-%m-%d":
		return t.Format("2006-01-02")
	case "%d.%m.%Y %H:%M":
		return t.Format("02.01.2006 15:04")
	case "%H:%M":
		return t.Format("15:04")
	default:
		return ""
	}
}
