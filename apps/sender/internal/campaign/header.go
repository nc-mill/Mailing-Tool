// Package campaign drží hlavičku kampaně a její cache.
//
// Kontroly kompilované šablony běží JEDNOU na dvojici (kampaň, revize), ne na
// zprávu. Výsledkem je pozastavení kampaně, a to dřív, než odejde první zpráva:
// počet značek i použité filtry jsou vlastnosti zkompilované šablony, ne
// jednotlivého příjemce.
package campaign

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/liquidx"
	"github.com/nc-mill/mlain/apps/sender/internal/markers"
)

// Raw je hlavička kampaně tak, jak přijde z databáze.
type Raw struct {
	ID                uuid.UUID
	WorkspaceID       uuid.UUID
	Status            string
	Subject           string
	Preheader         string
	FromName          string
	FromEmail         string
	ReplyTo           string
	CompiledHTML      string
	CompiledText      string
	Revision          int32
	ProviderID        *uuid.UUID
	TrackOpens        bool
	TrackClicks       bool
	UnsubscribeListID *uuid.UUID
	Timezone          string
	// ClickMarkerCount je z campaigns.compile_meta. Prázdná hodnota znamená,
	// že se kontrola V4 neprovede, viz kapitola 1.4 plánu.
	ClickMarkerCount *int
}

// ValidationError je výsledek kontrol V1 až V5. Vede vždycky na pozastavení
// kampaně, nikdy na selhání jedné zprávy.
type ValidationError struct {
	// PauseCode je hodnota pro pause_reason.code, tedy hrubší kategorie.
	PauseCode string
	// Detail je kód z katalogu chyb senderu, jde do pause_reason.detail.
	Detail string
	// Message je lidsky čitelný popis do logu.
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("%s (%s): %s", e.Detail, e.PauseCode, e.Message)
}

// Header je hlavička kampaně připravená k renderu.
type Header struct {
	Raw *Raw

	HTMLSource      string
	TextSource      string
	SubjectSource   string
	PreheaderSource string

	// BlankPaths je sjednocení cest ze všech čtyř šablon, pro které se před
	// renderem dopočítá vazba _blank.
	BlankPaths []string

	ClickMarkers int
	// MarkerCountUnverified říká, že kontrola V4 neproběhla, protože kampaň
	// nenese clickMarkerCount. Sender to zaloguje na úrovni WARN.
	MarkerCountUnverified bool
	HasOpenPixelSlot      bool
}

// PrepareHeader provede kontroly V1 až V5 a připraví zdroje k renderu.
func PrepareHeader(raw *Raw) (*Header, error) {
	h := &Header{Raw: raw}
	blank := map[string]bool{}

	parts := []struct {
		name   string
		src    string
		ctx    liquidx.Context
		target *string
	}{
		{"compiled_html", raw.CompiledHTML, liquidx.ContextHTML, &h.HTMLSource},
		{"compiled_text", raw.CompiledText, liquidx.ContextText, &h.TextSource},
		{"subject", raw.Subject, liquidx.ContextText, &h.SubjectSource},
		{"preheader", raw.Preheader, liquidx.ContextText, &h.PreheaderSource},
	}
	for _, p := range parts {
		// V1 a V2 jsou uvnitř Prepare.
		prepared, err := liquidx.Prepare(p.src, p.ctx)
		if err != nil {
			pe, ok := err.(*liquidx.PrepareError)
			if !ok {
				return nil, &ValidationError{
					PauseCode: "render_failure_rate",
					Detail:    "contract_mismatch",
					Message:   fmt.Sprintf("%s: %v", p.name, err),
				}
			}
			return nil, &ValidationError{
				PauseCode: "render_failure_rate",
				Detail:    pe.Code,
				Message:   fmt.Sprintf("%s: %s", p.name, pe.Detail),
			}
		}
		*p.target = prepared.Source
		for _, path := range prepared.BlankPaths {
			blank[path] = true
		}
	}

	for path := range blank {
		h.BlankPaths = append(h.BlankPaths, path)
	}

	// V3: za každou značkou musí být platné UUID. Ověří se tím, že se náhrada
	// zkušebně provede, což je zároveň jediný spolehlivý způsob, jak počet zjistit.
	probe := func(uuid.UUID) (string, error) { return "", nil }
	htmlCount := 0
	textCount := 0
	if _, n, err := markers.ReplaceLinks(raw.CompiledHTML, probe); err != nil {
		return nil, &ValidationError{
			PauseCode: "render_failure_rate", Detail: "contract_mismatch",
			Message: "compiled_html: " + err.Error(),
		}
	} else {
		htmlCount = n
	}
	if _, n, err := markers.ReplaceLinks(raw.CompiledText, probe); err != nil {
		return nil, &ValidationError{
			PauseCode: "render_failure_rate", Detail: "contract_mismatch",
			Message: "compiled_text: " + err.Error(),
		}
	} else {
		textCount = n
	}
	h.ClickMarkers = htmlCount + textCount
	h.HasOpenPixelSlot = markers.CountPixelMarkers(raw.CompiledHTML) > 0

	// V4: počet značek proti clickMarkerCount.
	if raw.ClickMarkerCount == nil {
		h.MarkerCountUnverified = true
	} else if *raw.ClickMarkerCount != h.ClickMarkers {
		return nil, &ValidationError{
			PauseCode: "render_failure_rate",
			Detail:    "contract_mismatch",
			Message: fmt.Sprintf("nalezeno %d značek odkazů, clickMarkerCount je %d. "+
				"Znamená to nekompatibilní verze kompilace a senderu a nemá to řešit retry, ale člověk",
				h.ClickMarkers, *raw.ClickMarkerCount),
		}
	}

	// V5: šablona se musí zparsovat. Když parsování selže tady, je to chyba
	// šablony a kampaň se pozastaví, místo aby padala zpráva po zprávě.
	eng, err := liquidx.New(liquidx.Options{Timezone: raw.Timezone})
	if err != nil {
		return nil, &ValidationError{
			PauseCode: "render_failure_rate", Detail: "contract_mismatch",
			Message: err.Error(),
		}
	}
	for _, src := range []string{h.HTMLSource, h.TextSource, h.SubjectSource, h.PreheaderSource} {
		if err := eng.Validate(src); err != nil {
			return nil, &ValidationError{
				PauseCode: "render_failure_rate", Detail: "contract_mismatch",
				Message: "šablona se nezparsovala: " + err.Error(),
			}
		}
	}
	return h, nil
}
