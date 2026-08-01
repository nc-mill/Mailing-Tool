package keyring

import (
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
)

// Vektory jsou z části 1, kapitola 3.10. Jsou závazné a ověřené spuštěním.
const testSecretKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

func TestMasterKeyDecodesToThirtyTwoBytes(t *testing.T) {
	kr, err := Parse(testSecretKey, "")
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	got := hex.EncodeToString(kr.Current().Material)
	want := "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
	if got != want {
		t.Fatalf("MASTER = %s, chci %s", got, want)
	}
	if kr.Current().ID != 1 {
		t.Fatalf("key_id = %d, bez prefixu má platit 1", kr.Current().ID)
	}
}

func TestDerivedKeysMatchContractVectors(t *testing.T) {
	kr, err := Parse(testSecretKey, "")
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	cases := []struct{ purpose, want string }{
		{PurposeTrackingToken, "b9d815e1212e663c64cce1209229e7cf6af10197254677b7eabb575ea2ac3124"},
		{PurposeCredentialEncryption, "83cdc2ac660d3400913cf6c99a981a465f20f0e56610dd413fa7667e30fb8040"},
		{PurposeSecretKeyFingerprint, "58c150fe5d466b4fa3e4d69d855c79763d1f0ccf0875c05594ff93cf8d6aead2"},
	}
	for _, c := range cases {
		k, err := kr.DeriveFor(1, c.purpose)
		if err != nil {
			t.Fatalf("DeriveFor(%s): %v", c.purpose, err)
		}
		if got := hex.EncodeToString(k); got != c.want {
			t.Errorf("K_%s = %s, chci %s", c.purpose, got, c.want)
		}
	}
}

func TestExplicitKeyIDPrefixIsAccepted(t *testing.T) {
	kr, err := Parse("2:"+testSecretKey, "1:"+testSecretKey)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if kr.Current().ID != 2 {
		t.Fatalf("key_id = %d, chci 2", kr.Current().ID)
	}
	if _, ok := kr.ByID(1); !ok {
		t.Fatal("předchozí pokolení 1 chybí")
	}
}

// AK-20.9: strop na počet pokolení neexistuje a nesmí se vrátit ani jako validace.
func TestNoUpperBoundOnKeyGenerations(t *testing.T) {
	for _, count := range []int{6, 50} {
		var parts []string
		for i := 2; i < 2+count; i++ {
			parts = append(parts, fmt.Sprintf("%d:%s", i, testSecretKey))
		}
		kr, err := Parse(testSecretKey, strings.Join(parts, ","))
		if err != nil {
			t.Fatalf("%d pokolení: Parse selhal: %v", count, err)
		}
		if len(kr.All()) != count+1 {
			t.Fatalf("%d pokolení: All() vrátil %d klíčů", count, len(kr.All()))
		}
	}
}

func TestSuppressionFingerprintIsStableAndLowercased(t *testing.T) {
	kr, err := Parse(testSecretKey, "")
	if err != nil {
		t.Fatal(err)
	}
	a, err := kr.SuppressionFingerprints("Jana@Example.CZ")
	if err != nil {
		t.Fatal(err)
	}
	b, err := kr.SuppressionFingerprints("jana@example.cz")
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 1 || len(b) != 1 {
		t.Fatalf("chci jeden otisk na pokolení, dostal jsem %d a %d", len(a), len(b))
	}
	if hex.EncodeToString(a[0]) != hex.EncodeToString(b[0]) {
		t.Fatal("otisk se musí počítat z lower(email)")
	}
	if len(a[0]) != 32 {
		t.Fatalf("otisk má %d bajtů, chci 32", len(a[0]))
	}
}

func TestRejectsKeyOfWrongLength(t *testing.T) {
	if _, err := Parse("QUJD", ""); err == nil {
		t.Fatal("klíč, který se nedekóduje na 32 bajtů, musí být odmítnutý")
	}
}
