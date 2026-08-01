package liquidx_test

import (
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/liquidx"
)

func TestGoldenLiquid(t *testing.T) {
	contracts.RunLiquidGolden(t, contracts.LiquidRunner{
		Render: func(template string, rawData []byte, presence []string, plainText bool) (string, error) {
			ctx := liquidx.ContextHTML
			if plainText {
				ctx = liquidx.ContextText
			}
			prepared, err := liquidx.Prepare(template, ctx)
			if err != nil {
				return "", err
			}
			// PrepareRenderData je Go protějšek sdílené funkce prepareRenderData
			// z kontraktu. Doplňuje _context, ořezává pole na 200 prvků, drží
			// velká celá čísla přesně a plní kořen _present podle seznamu cest.
			//
			// V provozu tuhle přípravu dělá aplikace při materializaci outboxu
			// a sender dostane hotová data. Runner ji volá tady, protože fixture
			// nese syrová data a seznam cest zvlášť.
			data, _, err := liquidx.PrepareRenderData(rawData, liquidx.RenderSchema{Presence: presence})
			if err != nil {
				return "", err
			}
			// Vazba _blank je NÁŠ mechanismus a s _present nemá nic společného.
			// Řeší nález K4: literály blank a empty kontraktní gramatika povoluje,
			// ale lexer osteele/liquid je nezná, projdou jako běžné identifikátory
			// a vyhodnotí se na nil, takže porovnání vyjde opačně než v prohlížeči.
			bindings := liquidx.WithBlankBindings(data, prepared.BlankPaths)

			engine, err := liquidx.New(liquidx.Options{Timezone: liquidx.TimezoneOf(data)})
			if err != nil {
				return "", err
			}
			return engine.Render(prepared.Source, bindings)
		},
	})
}
