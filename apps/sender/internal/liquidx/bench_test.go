package liquidx

import (
	"strings"
	"testing"
)

func benchSource() string {
	var b strings.Builder
	b.WriteString(`<!DOCTYPE html><html><body>`)
	// 1000 řádků, ne 400: se 400 zdroj vyjde jen na ~43 kB (viz kontrola níže),
	// diakritika totiž v UTF-8 zabírá víc bajtů, než návrh plánu počítal.
	// Benchmark má cíleně měřit dokument o zhruba 100 kB.
	for i := 0; i < 1000; i++ {
		b.WriteString(`<tr><td style="padding:8px;font-family:Arial">Řádek s běžným obsahem `)
		b.WriteString(`{{ contact.first_name }}</td></tr>`)
	}
	b.WriteString(`</body></html>`)
	return b.String()
}

// O6: měření doby přípravy a renderu šablony o zhruba 100 kB.
func BenchmarkPrepareAndRender100kB(b *testing.B) {
	src := benchSource()
	if len(src) < 50_000 {
		b.Fatalf("zdroj má jen %d bajtů, benchmark má měřit stokilobajtový dokument", len(src))
	}
	eng, err := New(Options{Timezone: "Europe/Prague"})
	if err != nil {
		b.Fatal(err)
	}
	data := map[string]any{"contact": map[string]any{"first_name": "Jana"}}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		p, err := Prepare(src, ContextHTML)
		if err != nil {
			b.Fatal(err)
		}
		if _, err := eng.Render(p.Source, data); err != nil {
			b.Fatal(err)
		}
	}
}

// Samotný render bez přípravy, aby šlo obojí rozlišit.
func BenchmarkRenderOnly(b *testing.B) {
	p, err := Prepare(benchSource(), ContextHTML)
	if err != nil {
		b.Fatal(err)
	}
	eng, err := New(Options{Timezone: "Europe/Prague"})
	if err != nil {
		b.Fatal(err)
	}
	data := map[string]any{"contact": map[string]any{"first_name": "Jana"}}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if _, err := eng.Render(p.Source, data); err != nil {
			b.Fatal(err)
		}
	}
}
