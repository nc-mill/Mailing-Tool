package credentials

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
)

const (
	testSecretKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
	testStored    = "enc:v1:AQEQc2VuZGluZ19wcm92aWRlcgABAgMEBQYHCAkKC/rlxXEUyExOwBWRsBivQn6RbIw8VXIldkz2WjBROC2BKMbeGsPjjHnF4tQrXcQTiOVnMQzPKu/LYlGi3+P5RJg9o8NIGwv9GL65qTCqCJoSMchO0R73S5n4rmgEllbZJA2LiAc="
	testWorkspace = "0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071"
	testPlaintext = `{"access_key_id":"AKIAEXAMPLE","secret_access_key":"s3cr3t","region":"eu-central-1"}`
)

func ring(t *testing.T) *keyring.Keyring {
	t.Helper()
	kr, err := keyring.Parse(testSecretKey, "")
	if err != nil {
		t.Fatal(err)
	}
	return kr
}

func TestDecryptMatchesContractVector(t *testing.T) {
	ws := uuid.MustParse(testWorkspace)
	got, err := Decrypt(ring(t), testStored, ContextSendingProvider, ws)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if string(got) != testPlaintext {
		t.Fatalf("plaintext = %q", string(got))
	}
}

// CR-N8: tatáž obálka pod jiným workspace musí selhat, protože workspace_id je v AAD.
func TestDecryptFailsForForeignWorkspace(t *testing.T) {
	other := uuid.MustParse("0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6072")
	_, err := Decrypt(ring(t), testStored, ContextSendingProvider, other)
	if err == nil || err.Error() != "crypto_auth_failed" {
		t.Fatalf("chci crypto_auth_failed, dostal jsem %v", err)
	}
}

// CR-N3: kontext v obálce nesouhlasí s očekávaným pro tenhle sloupec.
func TestDecryptFailsOnContextMismatch(t *testing.T) {
	ws := uuid.MustParse(testWorkspace)
	_, err := Decrypt(ring(t), testStored, "webhook_secret", ws)
	if err == nil || err.Error() != "crypto_context_mismatch" {
		t.Fatalf("chci crypto_context_mismatch, dostal jsem %v", err)
	}
}

// CR-N6: chybějící prefix.
func TestDecryptFailsOnMissingPrefix(t *testing.T) {
	ws := uuid.MustParse(testWorkspace)
	_, err := Decrypt(ring(t), strings.TrimPrefix(testStored, "enc:v1:"), ContextSendingProvider, ws)
	if err == nil || err.Error() != "crypto_envelope_malformed" {
		t.Fatalf("chci crypto_envelope_malformed, dostal jsem %v", err)
	}
}

// CR-N4: nepodporovaná verze obálky.
func TestDecryptFailsOnUnsupportedVersion(t *testing.T) {
	ws := uuid.MustParse(testWorkspace)
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(testStored, "enc:v1:"))
	if err != nil {
		t.Fatal(err)
	}
	raw[0] = 0x02
	broken := "enc:v1:" + base64.StdEncoding.EncodeToString(raw)
	if _, err := Decrypt(ring(t), broken, ContextSendingProvider, ws); err == nil || err.Error() != "crypto_unsupported_version" {
		t.Fatalf("chci crypto_unsupported_version, dostal jsem %v", err)
	}
}

// CR-N5: klíč z obálky není v keyringu.
func TestDecryptFailsOnUnknownKeyID(t *testing.T) {
	ws := uuid.MustParse(testWorkspace)
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(testStored, "enc:v1:"))
	if err != nil {
		t.Fatal(err)
	}
	raw[1] = 7
	broken := "enc:v1:" + base64.StdEncoding.EncodeToString(raw)
	if _, err := Decrypt(ring(t), broken, ContextSendingProvider, ws); err == nil || err.Error() != "crypto_unknown_key" {
		t.Fatalf("chci crypto_unknown_key, dostal jsem %v", err)
	}
}

// CR-N1: změněný bajt ciphertextu.
func TestDecryptFailsOnTamperedCiphertext(t *testing.T) {
	ws := uuid.MustParse(testWorkspace)
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(testStored, "enc:v1:"))
	if err != nil {
		t.Fatal(err)
	}
	raw[len(raw)-20] ^= 0xff
	broken := "enc:v1:" + base64.StdEncoding.EncodeToString(raw)
	if _, err := Decrypt(ring(t), broken, ContextSendingProvider, ws); err == nil || err.Error() != "crypto_auth_failed" {
		t.Fatalf("chci crypto_auth_failed, dostal jsem %v", err)
	}
}

// CR-N7: obálka zkrácená o tag.
func TestDecryptFailsOnTruncatedEnvelope(t *testing.T) {
	ws := uuid.MustParse(testWorkspace)
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(testStored, "enc:v1:"))
	if err != nil {
		t.Fatal(err)
	}
	broken := "enc:v1:" + base64.StdEncoding.EncodeToString(raw[:len(raw)-16])
	if _, err := Decrypt(ring(t), broken, ContextSendingProvider, ws); err == nil {
		t.Fatal("zkrácená obálka musí selhat")
	}
}
