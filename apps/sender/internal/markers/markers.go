// Package markers nahrazuje předkompilované značky za trackovací odkazy.
//
// Sender NIKDY neparsuje HTML. Každý parser mu může přeuspořádat atributy nebo
// znormalizovat markup laděný pro Outlook, a právě neporušenost toho markupu je
// věc, kterou golden fixtures hlídají bajtovým diffem.
package markers

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

const (
	// LinkPrefix je pevný prefix značky odkazu. Doména .invalid je rezervovaná
	// RFC 2606 a nikdy se nerozpustí, takže neproběhlá záměna dá inertní odkaz,
	// ne funkční odkaz na cizí server.
	LinkPrefix = "https://track.mlain.invalid/c/"
	// linkIDLen je délka kanonického UUID s pomlčkami.
	linkIDLen = 36
	// PixelMarker je značka open pixelu. Je to HTML komentář, takže neproběhlá
	// záměna je neviditelná, na rozdíl od podtržítkového tokenu v těle zprávy.
	PixelMarker = "<!--ML_OPEN_PIXEL-->"
	// ResidualNeedle je jeden ze čtyř vyhrazených řetězců, viz ReservedMarkers.
	ResidualNeedle = "mlain.invalid"
)

// ReplaceLinks projde zdroj JEDNÍM průchodem a nahradí každou značku odkazu.
//
// Naivní implementace by volala strings.ReplaceAll jednou na každý odkaz
// z CompileMeta.links, což při dvaceti odkazech a stokilobajtovém dokumentu
// znamená dvacet průchodů, tedy 2 MB skenování na zprávu.
//
// Vedlejším produktem je počet náhrad, který se porovnává s clickMarkerCount.
func ReplaceLinks(src string, tokenFor func(linkID uuid.UUID) (string, error)) (string, int, error) {
	var b strings.Builder
	b.Grow(len(src))
	count := 0
	i := 0
	for {
		rel := strings.Index(src[i:], LinkPrefix)
		if rel < 0 {
			b.WriteString(src[i:])
			return b.String(), count, nil
		}
		start := i + rel
		idStart := start + len(LinkPrefix)
		if idStart+linkIDLen > len(src) {
			return "", count, fmt.Errorf("značka odkazu na pozici %d je useknutá", start)
		}
		raw := src[idStart : idStart+linkIDLen]
		id, err := uuid.Parse(raw)
		if err != nil {
			return "", count, fmt.Errorf("za značkou na pozici %d není platné UUID (%q): %w", start, raw, err)
		}
		url, err := tokenFor(id)
		if err != nil {
			return "", count, err
		}
		b.WriteString(src[i:start])
		b.WriteString(url)
		count++
		i = idStart + linkIDLen
	}
}

// CountLinkMarkers spočítá značky odkazů ve zdroji. Počítá se nad ZDROJEM
// šablony, který je pro celou kampaň statický, takže kontrola běží jednou
// při načtení kampaně do cache, ne padesát tisíckrát.
func CountLinkMarkers(src string) int { return strings.Count(src, LinkPrefix) }

// ReplacePixel nahradí značku open pixelu, a to nejvýš JEDNOU.
//
// Kontrakt garantuje právě jeden výskyt. Kdyby jich bylo víc, druhý zůstane
// a zachytí ho kontrola zbytků, což je lepší než tichá náhrada všech.
func ReplacePixel(src, replacement string) (string, bool) {
	if !strings.Contains(src, PixelMarker) {
		return src, false
	}
	return strings.Replace(src, PixelMarker, replacement, 1), true
}

// CountPixelMarkers spočítá výskyty značky open pixelu. Kontrakt garantuje
// nejvýš jeden, počítadlo existuje kvůli kontrole při načtení kampaně.
func CountPixelMarkers(src string) int { return strings.Count(src, PixelMarker) }

// ReservedMarkers je úplný seznam vyhrazených řetězců z kontraktu. Žádný z nich
// nesmí zůstat ve výstupu, který jde do MIME.
//
// Dřívější znění hledalo jen "mlain.invalid", takže nedokončený slot filtru
// (ML_ARG_) nebo syrový slot (ML_RAW_) prošly do odeslaného mailu jako viditelný
// text. Porovnává se BEZ OHLEDU NA VELIKOST PÍSMEN, protože P08 generuje sloty
// malými písmeny (rozhodnutí D16), kdežto kontrakt je píše velkými.
var ReservedMarkers = []string{"mlain.invalid", "ML_OPEN_PIXEL", "ML_ARG_", "ML_RAW_"}

// HasResidual hlásí, jestli ve výstupu zbyl kterýkoliv vyhrazený řetězec.
// Je to jeden strings.Contains nad už existujícím řetězcem, tedy jednotky
// mikrosekund, a chytí třídu chyb, na kterou invarianty kompilace nedosáhnou.
func HasResidual(s string) bool {
	lower := strings.ToLower(s)
	for _, needle := range ReservedMarkers {
		if strings.Contains(lower, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}

// PixelHTML skládá HTML open pixelu. Je to JEDINÝ zdroj jeho tvaru: dokud si ho
// worker skládal inline, neexistovalo místo, kde by šlo ověřit, že se shoduje
// s tím, co čeká TypeScript strana. Runner značek ho volá jako hodnotu.
//
// Rozměry, alt i styl jsou součástí kontraktu: bez display:none a max-height:0
// někteří klienti pixel vykreslí jako prázdné místo v patičce.
func PixelHTML(url string) string {
	return `<img src="` + url + `" width="1" height="1" alt="" ` +
		`style="display:none;max-height:0;overflow:hidden" />`
}
