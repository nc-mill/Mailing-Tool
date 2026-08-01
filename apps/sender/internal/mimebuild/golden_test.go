package mimebuild_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/mimebuild"
)

func TestGoldenMessageID(t *testing.T) {
	contracts.RunMessageIDGolden(t, contracts.MessageIDRunner{
		Build: func(messageID, sendingDomain string) (string, error) {
			parsed, err := uuid.Parse(messageID)
			if err != nil {
				return "", err
			}
			return mimebuild.MessageID(parsed, sendingDomain), nil
		},
	})
}
