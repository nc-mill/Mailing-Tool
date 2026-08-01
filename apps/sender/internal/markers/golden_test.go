package markers_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/markers"
)

func TestGoldenMarkers(t *testing.T) {
	contracts.RunMarkersGolden(t, contracts.MarkersRunner{
		ReplaceLinks: func(src string, tokenFor func(linkID string) (string, error)) (string, int, error) {
			return markers.ReplaceLinks(src, func(linkID uuid.UUID) (string, error) {
				return tokenFor(linkID.String())
			})
		},
		ReplacePixel: func(src, replacement string) (string, int) {
			out, replaced := markers.ReplacePixel(src, replacement)
			if replaced {
				return out, 1
			}
			return out, 0
		},
		HasResidual: markers.HasResidual,
		PixelHTML:   markers.PixelHTML,
	})
}
