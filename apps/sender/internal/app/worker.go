// Package app skládá jednotlivé díly senderu do běžícího procesu.
package app

import (
	"errors"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/campaign"
	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/liquidx"
	"github.com/nc-mill/mlain/apps/sender/internal/markers"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/token"
)

// MaxSubjectBytes je limit předmětu po zakódování.
const MaxSubjectBytes = 998

// RenderError nese kód z katalogu chyb senderu. Vede na osud JEDNÉ zprávy,
// nikdy na pozastavení kampaně: to řeší validace při načtení hlavičky.
type RenderError struct {
	Code    string
	Message string
}

func (e *RenderError) Error() string { return e.Code + ": " + e.Message }

// AsRenderError je zkratka pro errors.As.
func AsRenderError(err error, target **RenderError) bool { return errors.As(err, target) }

// Rendered je hotový obsah jedné zprávy.
type Rendered struct {
	Subject        string
	HTML           string
	Text           string
	UnsubscribeURL string
	OneClick       bool
	IsTest         bool
	Warnings       []liquidx.Warning
}

// Renderer provádí fázi 2 renderu pro jednu zprávu.
//
// Drží cache Liquid engine podle časové zóny. Jedna instance patří JEDNOMU
// workeru, ne kampani: souběžná bezpečnost renderu není v knihovně dokumentovaná
// a jedna sada na worker je bezpečná bez ohledu na to, jak se knihovna chová.
type Renderer struct {
	tokens       *token.Builder
	urls         token.URLs
	testTracking bool

	mu      sync.Mutex
	engines map[string]*liquidx.Engine
}

// NewRenderer vytvoří renderer pro jeden worker.
func NewRenderer(tokens *token.Builder, urls token.URLs, testTracking bool) *Renderer {
	return &Renderer{tokens: tokens, urls: urls, testTracking: testTracking, engines: map[string]*liquidx.Engine{}}
}

func (r *Renderer) engine(zone string) (*liquidx.Engine, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if e, ok := r.engines[zone]; ok {
		return e, nil
	}
	e, err := liquidx.New(liquidx.Options{Timezone: zone})
	if err != nil {
		return nil, err
	}
	r.engines[zone] = e
	return e, nil
}

// Render vyrobí obsah jedné zprávy.
//
// Pořadí operací je normativní a nesmí se přehodit:
//
//  1. náhrada značek (odkazy, pixel)
//  2. Liquid interpolace
//  3. sestavení MIME (dělá volající)
//
// Obrácené pořadí by dovolilo, aby kontakt, jehož vlastní pole obsahuje řetězec
// značky, dostal po interpolaci do těla funkční trackovací odkaz. Import CSV
// od zákazníka je přesně to místo, odkud takový řetězec přijde.
func (r *Renderer) Render(h *campaign.Header, msg outbox.Message) (*Rendered, error) {
	out := &Rendered{IsTest: msg.Kind == "test"}

	// Sledování se u testovacího odeslání vypíná úplně: platný token, ke kterému
	// nevede žádná dohledatelná zpráva, by při každém otevření zvyšoval čítač
	// nespárovaných otevření, který má část 5 alertovaný jako porušení invariantu.
	tracking := !out.IsTest || r.testTracking

	// 1. Odhlašovací odkaz. Vyrábí ho sender, v render_data není.
	unsub, oneClick, err := r.unsubscribe(h, msg, out.IsTest)
	if err != nil {
		return nil, err
	}
	out.UnsubscribeURL = unsub
	out.OneClick = oneClick

	// 2. Náhrada značek. Sender nikdy neparsuje HTML, jde o prostou záměnu
	// pevného prefixu jedním průchodem.
	clickToken := func(linkID uuid.UUID) (string, error) {
		if !tracking {
			return "", &RenderError{
				Code:    errcatalog.MarkerNotReplaced,
				Message: "testovací odeslání s vypnutým sledováním nesmí vyrobit trackovací token",
			}
		}
		tok, terr := r.tokens.Click(msg.WorkspaceID, msg.Key.ID, linkID, msg.Key.CreatedAt)
		if terr != nil {
			return "", terr
		}
		return r.urls.Click(tok), nil
	}
	htmlSrc, _, err := markers.ReplaceLinks(h.HTMLSource, clickToken)
	if err != nil {
		return nil, wrapMarkerError(err)
	}
	textSrc, _, err := markers.ReplaceLinks(h.TextSource, clickToken)
	if err != nil {
		return nil, wrapMarkerError(err)
	}

	pixel := ""
	if tracking {
		tok, terr := r.tokens.Open(msg.WorkspaceID, msg.Key.ID, msg.Key.CreatedAt)
		if terr != nil {
			return nil, &RenderError{Code: errcatalog.RenderFailed, Message: terr.Error()}
		}
		pixel = markers.PixelHTML(r.urls.Open(tok))
	}
	htmlSrc, _ = markers.ReplacePixel(htmlSrc, pixel)

	// 3. Kontrola zbytků. Běží nad ZDROJEM po náhradě značek, ne nad hotovým
	// výstupem. Je to jeden strings.Contains nad už existujícím řetězcem, tedy
	// jednotky mikrosekund, a chytí třídu chyb, na kterou invarianty kompilace
	// nedosáhnou: druhou značku pixelu, nedokončený slot filtru, syrový slot.
	//
	// Nad hotovým výstupem by kontrola běžet NESMĚLA. Vyhrazený řetězec se do
	// výstupu může dostat i z dat kontaktu (import CSV od zákazníka) a takový
	// řetězec je neškodný právě proto, že do náhrady značek nikdy nevstoupil:
	// zůstane v těle doslova a odkazuje na rezervovanou doménu .invalid.
	// Kontrola nad výstupem by kvůli němu zahodila zprávu, která je v pořádku
	// (AK-6.22, CT-016).
	for _, src := range []string{htmlSrc, textSrc, h.SubjectSource, h.PreheaderSource} {
		if markers.HasResidual(src) {
			return nil, &RenderError{
				Code:    errcatalog.MarkerNotReplaced,
				Message: "v odchozí zprávě zůstala nenahrazená vnitřní značka",
			}
		}
	}

	// 4. Data a dopočítané vazby.
	data, warnings, err := liquidx.DecodeRenderData(msg.RenderData)
	if err != nil {
		return nil, &RenderError{Code: errcatalog.RenderFailed, Message: err.Error()}
	}
	out.Warnings = warnings
	data["unsubscribe_url"] = unsub
	data["one_click_unsubscribe_url"] = unsub
	if msg.ContactID != nil {
		tok, terr := r.tokens.Unsubscribe(msg.WorkspaceID, msg.Key.ID, *msg.ContactID, listID(h), msg.Key.CreatedAt)
		if terr == nil {
			data["preferences_url"] = r.urls.Preferences(tok)
			data["webview_url"] = r.urls.Webview(tok)
		}
	}
	bindings := liquidx.WithBlankBindings(data, h.BlankPaths)

	// 5. Interpolace.
	eng, err := r.engine(h.Raw.Timezone)
	if err != nil {
		return nil, &RenderError{Code: errcatalog.RenderFailed, Message: err.Error()}
	}
	out.HTML, err = renderOne(eng, htmlSrc, bindings)
	if err != nil {
		return nil, err
	}
	out.Text, err = renderOne(eng, textSrc, bindings)
	if err != nil {
		return nil, err
	}
	out.Subject, err = renderOne(eng, h.SubjectSource, bindings)
	if err != nil {
		return nil, err
	}
	// Preheader se interpoluje jen kvůli diagnostice. Do těla se NEZAPISUJE,
	// protože je už zapečený v html jako první skrytý blok.
	if _, err := renderOne(eng, h.PreheaderSource, bindings); err != nil {
		return nil, err
	}

	if len(out.Subject) > MaxSubjectBytes {
		return nil, &RenderError{
			Code:    errcatalog.SubjectTooLong,
			Message: fmt.Sprintf("předmět má po doplnění dat %d bajtů, limit je %d", len(out.Subject), MaxSubjectBytes),
		}
	}
	return out, nil
}

func renderOne(eng *liquidx.Engine, src string, bindings map[string]any) (string, error) {
	out, err := eng.Render(src, bindings)
	if err == nil {
		return out, nil
	}
	switch {
	case errors.Is(err, liquidx.ErrRenderTimeout):
		return "", &RenderError{Code: errcatalog.RenderTimeout, Message: err.Error()}
	case errors.Is(err, liquidx.ErrOutputTooLarge):
		return "", &RenderError{Code: errcatalog.BodyTooLarge, Message: err.Error()}
	default:
		return "", &RenderError{Code: errcatalog.RenderFailed, Message: err.Error()}
	}
}

func wrapMarkerError(err error) error {
	var re *RenderError
	if errors.As(err, &re) {
		return re
	}
	return &RenderError{Code: errcatalog.MarkerNotReplaced, Message: err.Error()}
}

func listID(h *campaign.Header) uuid.UUID {
	if h.Raw.UnsubscribeListID != nil {
		return *h.Raw.UnsubscribeListID
	}
	// Nulové UUID znamená globální odhlášení, ne odhlášení ze seznamu.
	return uuid.Nil
}

// unsubscribe sestaví odhlašovací odkaz.
//
// Zpráva bez možnosti odhlášení odejít NESMÍ. Je to technická pojistka proti tomu,
// aby šlo z nástroje rozeslat něco, co nejde odhlásit.
func (r *Renderer) unsubscribe(h *campaign.Header, msg outbox.Message, isTest bool) (string, bool, error) {
	if msg.ContactID == nil {
		if isTest {
			// Stránka s vysvětlením, že šlo o testovací zprávu. One-Click se
			// nepřidává, aby si poštovní klient nemyslel, že je funkční.
			return r.urls.TestUnsubscribe(), false, nil
		}
		return "", false, &RenderError{
			Code:    errcatalog.UnsubscribeURLMissing,
			Message: "zpráva nemá contact_id, odhlašovací token nejde sestavit",
		}
	}
	tok, err := r.tokens.Unsubscribe(msg.WorkspaceID, msg.Key.ID, *msg.ContactID, listID(h), msg.Key.CreatedAt)
	if err != nil {
		return "", false, &RenderError{Code: errcatalog.UnsubscribeURLMissing, Message: err.Error()}
	}
	return r.urls.Unsubscribe(tok), true, nil
}
