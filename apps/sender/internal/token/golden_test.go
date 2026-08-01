package token_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
	"github.com/nc-mill/mlain/apps/sender/internal/token"
)

func TestGoldenTokens(t *testing.T) {
	var builder *token.Builder
	contracts.RunTokenGolden(t, contracts.TokenRunner{
		Init: func(secretKey string) error {
			kr, err := keyring.Parse(secretKey, "")
			if err != nil {
				return err
			}
			builder, err = token.NewBuilder(kr)
			return err
		},
		Build: func(typ string, keyID uint8, fields map[string]any) (string, []byte, error) {
			id := func(name string) uuid.UUID { return uuid.MustParse(fields[name].(string)) }
			at := time.Unix(int64(fields["message_created_at"].(float64)), 0).UTC()
			switch typ {
			case "o":
				return builder.OpenWithMAC(id("workspace_id"), id("message_id"), at)
			case "c":
				return builder.ClickWithMAC(id("workspace_id"), id("message_id"), id("link_id"), at)
			case "u":
				return builder.UnsubscribeWithMAC(
					id("workspace_id"), id("message_id"), id("contact_id"), id("list_id"), at)
			default:
				t.Fatalf("typ %q nemá na Go straně stavitele; fixture ho nesmí mít v sides", typ)
				return "", nil, nil
			}
		},
	})
}
