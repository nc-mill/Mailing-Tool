package credentials_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/credentials"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
)

func TestGoldenCrypto(t *testing.T) {
	var kr *keyring.Keyring
	contracts.RunCryptoGolden(t, contracts.CryptoRunner{
		Init: func(secretKey string) error {
			var err error
			kr, err = keyring.Parse(secretKey, "")
			return err
		},
		Decrypt: func(stored, expectedContext, workspaceID string) ([]byte, error) {
			ws, err := uuid.Parse(workspaceID)
			if err != nil {
				return nil, err
			}
			return credentials.Decrypt(kr, stored, expectedContext, ws)
		},
		// Sentinely balíčku nesou kontraktní kód jako text, takže překlad je
		// jen mapa. Kdyby se text změnil, spadne tenhle překlad, ne fixture.
		ErrorCode: func(err error) string {
			for code, sentinel := range map[string]error{
				"crypto_envelope_malformed":  credentials.ErrMalformed,
				"crypto_unsupported_version": credentials.ErrUnsupportedVersion,
				"crypto_context_mismatch":    credentials.ErrContextMismatch,
				"crypto_unknown_key":         credentials.ErrUnknownKey,
				"crypto_auth_failed":         credentials.ErrAuthFailed,
			} {
				if errors.Is(err, sentinel) {
					return code
				}
			}
			return "neznámá chyba: " + err.Error()
		},
	})
}
