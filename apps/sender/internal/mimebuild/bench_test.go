package mimebuild

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Odhad ze specifikace je 50 až 200 mikrosekund na zprávu při quoted-printable
// nad stokilobajtovým HTML.
func BenchmarkBuild100kB(b *testing.B) {
	html := "<!DOCTYPE html><html><body>" + strings.Repeat("Běžný obsah s diakritikou. ", 4000) + "</body></html>"
	in := Input{
		MessageID:       MessageID(uuid.New(), "mail.example.cz"),
		Date:            time.Now().UTC(),
		FromName:        "Jan Novák",
		FromEmail:       "newsletter@mail.example.cz",
		To:              "jana@example.cz",
		Subject:         "Letní výprodej začíná",
		Text:            strings.Repeat("Běžný obsah. ", 2000),
		HTML:            html,
		ListUnsubscribe: []string{"https://track.example.com/u/t1abc"},
		OneClick:        true,
		Boundary:        "----=_OE_00000000000000000000",
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if _, err := Build(in); err != nil {
			b.Fatal(err)
		}
	}
}
