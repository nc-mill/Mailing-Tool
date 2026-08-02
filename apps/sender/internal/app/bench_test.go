package app

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/campaign"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
	"github.com/nc-mill/mlain/apps/sender/internal/mimebuild"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/token"
)

// Otevřená otázka O6 (kapitola 31.3 plánu P09): jaký je skutečný náklad na
// zprávu. Benchmark v internal/liquidx měřil jen nejhorší případ (1000
// substitucí v jednom dokumentu), což je zátěžový test, ne kampaň. Tenhle
// soubor měří CELOU cestu jedné zprávy (příprava + render HTML + textová
// varianta + předmět + sestavení MIME, přesně jako to dělá App.process)
// pro tři profily, aby šlo O6 rozhodnout na reálném případu, ne na extrému.
type benchProfile struct {
	name          string
	substitutions int
	htmlBytes     int
}

var (
	benchProfileTypical = benchProfile{name: "Typical", substitutions: 8, htmlBytes: 40_000}
	benchProfileRicher  = benchProfile{name: "Richer", substitutions: 30, htmlBytes: 80_000}
	benchProfileWorst   = benchProfile{name: "WorstCase", substitutions: 1000, htmlBytes: 108_000}
)

// benchFields jsou pole kontaktu, mezi kterými se substituce střídají. Reálná
// kampaň typicky sahá na pár různých polí, ne pořád na to samé.
var benchFields = []string{"contact.first_name", "contact.last_name", "contact.city", "contact.company"}

// benchContent postaví HTML fragment se zadaným počtem Liquid substitucí
// rozprostřených v běžném českém textu o zhruba targetBytes, s jedním
// trackovaným odkazem a pixelem pro otevření: tvar skutečné kampaně, ne
// syntetický extrém.
func benchContent(subCount, targetBytes int) string {
	filler := "Děkujeme, že jste s námi. Připravili jsme pro vás novinky a slevy na oblíbené produkty. "
	var b strings.Builder
	b.WriteString(`<!DOCTYPE html><html><body><table><tr><td>`)
	perSub := targetBytes / subCount
	for i := 0; i < subCount; i++ {
		start := b.Len()
		for b.Len()-start < perSub-40 {
			b.WriteString(filler)
		}
		fmt.Fprintf(&b, "Ahoj {{ %s }}, ", benchFields[i%len(benchFields)])
	}
	b.WriteString(`<a href="https://track.mlain.invalid/c/0192f3a0-1c2d-7e42-9c3d-4e5f60718293">Zjistit více</a>`)
	b.WriteString(`<!--ML_OPEN_PIXEL--></td></tr></table></body></html>`)
	return b.String()
}

// benchTextContent je textová varianta: kratší než HTML, ale se stejným
// počtem substitucí, protože i prostý text jde přes stejný render.
func benchTextContent(subCount int) string {
	var b strings.Builder
	for i := 0; i < subCount; i++ {
		fmt.Fprintf(&b, "Ahoj {{ %s }}. ", benchFields[i%len(benchFields)])
	}
	return b.String()
}

func benchRenderData() []byte {
	return []byte(`{"contact":{"first_name":"Jana","last_name":"Nováková","city":"Brno","company":"Acme s.r.o."}}`)
}

func benchRenderer(b *testing.B) *Renderer {
	b.Helper()
	kr, err := keyring.Parse("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", "")
	if err != nil {
		b.Fatal(err)
	}
	tb, err := token.NewBuilder(kr)
	if err != nil {
		b.Fatal(err)
	}
	return NewRenderer(tb, token.URLs{TrackingDomain: "https://track.example.com"}, false)
}

func benchHeader(b *testing.B, html, text string) *campaign.Header {
	b.Helper()
	h, err := campaign.PrepareHeader(&campaign.Raw{
		ID:           uuid.MustParse("0192f3a0-1c2d-7e44-9e5f-60718293a4b5"),
		WorkspaceID:  uuid.MustParse("0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071"),
		Subject:      "Ahoj {{ contact.first_name }}, sleva čeká",
		Preheader:    "Sleva jen dnes",
		FromName:     "Jan Novák",
		FromEmail:    "newsletter@mail.example.cz",
		CompiledHTML: html,
		CompiledText: text,
		Revision:     1,
		TrackOpens:   true,
		TrackClicks:  true,
		Timezone:     "Europe/Prague",
	})
	if err != nil {
		b.Fatal(err)
	}
	return h
}

func benchMessage() outbox.Message {
	contact := uuid.MustParse("0192f3a0-1c2d-7e43-8d4e-5f60718293a4")
	return outbox.Message{
		Key: outbox.MessageKey{
			ID:        uuid.MustParse("0192f3a0-1c2d-7e41-8b2c-3d4e5f607182"),
			CreatedAt: time.Date(2026, 7, 25, 16, 0, 0, 0, time.UTC),
		},
		WorkspaceID: uuid.MustParse("0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071"),
		CampaignID:  uuid.MustParse("0192f3a0-1c2d-7e44-9e5f-60718293a4b5"),
		ContactID:   &contact,
		Email:       "jana@example.cz",
		RenderData:  benchRenderData(),
		Kind:        "campaign",
	}
}

// runFullPipeline měří přesně to, co App.process dělá v krocích D2 před
// voláním dispatcheru: náhrada značek a interpolace (Renderer.Render, což
// zahrnuje HTML, textovou variantu i předmět) a sestavení MIME.
func runFullPipeline(b *testing.B, p benchProfile) {
	html := benchContent(p.substitutions, p.htmlBytes)
	text := benchTextContent(p.substitutions)
	header := benchHeader(b, html, text)
	renderer := benchRenderer(b)
	msg := benchMessage()

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		rendered, err := renderer.Render(header, msg)
		if err != nil {
			b.Fatal(err)
		}
		boundary, err := mimebuild.RandomBoundary()
		if err != nil {
			b.Fatal(err)
		}
		raw, err := BuildMIME(header, msg, rendered, MIMEOptions{Boundary: boundary})
		if err != nil {
			b.Fatal(err)
		}
		if len(raw) == 0 {
			b.Fatal("MIME výstup je prázdný")
		}
	}
}

// BenchmarkFullPipelineTypical: 5 až 10 substitucí (zde 8), dokument 30 až
// 50 kB (zde 40 kB). Tohle je profil, podle kterého se rozhoduje O6.
func BenchmarkFullPipelineTypical(b *testing.B) { runFullPipeline(b, benchProfileTypical) }

// BenchmarkFullPipelineRicher: 30 substitucí, dokument 80 kB.
func BenchmarkFullPipelineRicher(b *testing.B) { runFullPipeline(b, benchProfileRicher) }

// BenchmarkFullPipelineWorstCase: 1000 substitucí, stejný řád velikosti jako
// BenchmarkPrepareAndRender100kB v internal/liquidx. Slouží k porovnání
// s typickým profilem, ne jako výchozí očekávání.
func BenchmarkFullPipelineWorstCase(b *testing.B) { runFullPipeline(b, benchProfileWorst) }
