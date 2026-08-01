// Package credentials dešifruje sending_providers.config_encrypted podle kontraktu 4
// z části 1, kapitola 4.10.4. Sender jen dešifruje, nikdy nešifruje.
package credentials

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
)

// ContextSendingProvider je jediný kontext, který sender kdy dešifruje.
const ContextSendingProvider = "sending_provider"

const (
	storedPrefix = "enc:v1:"
	aadPrefix    = "mailer/cred/v1"
	envVersion   = 0x01
	nonceLen     = 12
	tagLen       = 16
)

// Chybové kódy jsou kontraktní. Ven jde vždycky jeden z nich a nikdy nic, co by
// prozradilo, ve které fázi dešifrování selhalo.
var (
	ErrMalformed          = errors.New("crypto_envelope_malformed")
	ErrUnsupportedVersion = errors.New("crypto_unsupported_version")
	ErrContextMismatch    = errors.New("crypto_context_mismatch")
	ErrUnknownKey         = errors.New("crypto_unknown_key")
	ErrAuthFailed         = errors.New("crypto_auth_failed")
)

// Decrypt rozbalí obálku enc:v1: a vrátí plaintext JSON.
//
// Pořadí kroků je normativní (4.10.4) a nesmí se přeskládat. Sender NIKDY nezkouší
// klíče postupně: key_id v obálce určuje právě jeden klíč, a když ten nesedí, je to
// crypto_unknown_key nebo crypto_auth_failed, nikdy hledání.
func Decrypt(kr *keyring.Keyring, stored, expectedContext string, workspaceID uuid.UUID) ([]byte, error) {
	if !strings.HasPrefix(stored, storedPrefix) {
		return nil, ErrMalformed
	}
	env, err := base64.StdEncoding.DecodeString(stored[len(storedPrefix):])
	if err != nil {
		return nil, ErrMalformed
	}
	// header = version(1) || key_id(1) || context_len(1) || context(context_len)
	if len(env) < 3 {
		return nil, ErrMalformed
	}
	if env[0] != envVersion {
		return nil, ErrUnsupportedVersion
	}
	keyID := env[1]
	ctxLen := int(env[2])
	if ctxLen < 1 || ctxLen > 64 {
		return nil, ErrMalformed
	}
	headerLen := 3 + ctxLen
	if len(env) < headerLen+nonceLen+tagLen {
		return nil, ErrMalformed
	}
	header := env[:headerLen]
	context := string(env[3:headerLen])
	if context != expectedContext {
		return nil, ErrContextMismatch
	}
	nonce := env[headerLen : headerLen+nonceLen]
	// V Go je tag součástí ciphertextu, ne samostatný argument, takže se
	// ciphertext || tag předává v jednom kuse.
	ciphertextAndTag := env[headerLen+nonceLen:]

	key, err := kr.DeriveFor(keyID, keyring.PurposeCredentialEncryption)
	if err != nil {
		return nil, ErrUnknownKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, ErrAuthFailed
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, ErrAuthFailed
	}

	// aad = "mailer/cred/v1" || header || workspace_id(16 bajtů binárně)
	aad := make([]byte, 0, len(aadPrefix)+len(header)+16)
	aad = append(aad, aadPrefix...)
	aad = append(aad, header...)
	wsBytes := workspaceID
	aad = append(aad, wsBytes[:]...)

	plain, err := gcm.Open(nil, nonce, ciphertextAndTag, aad)
	if err != nil {
		return nil, ErrAuthFailed
	}
	return plain, nil
}
