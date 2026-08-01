package contracts

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestFixturesDigestNezavisiNaPoradiAReagujeNaZmenu(t *testing.T) {
	names, err := ListFixtures("liquid")
	if err != nil {
		t.Fatalf("seznam fixtures: %v", err)
	}
	if len(names) == 0 {
		t.Fatal("adresář liquid je prázdný, otisk by nic neznamenal")
	}
	first, err := FixturesDigest("liquid", names)
	if err != nil {
		t.Fatalf("otisk: %v", err)
	}
	reversed := make([]string, len(names))
	for i, name := range names {
		reversed[len(names)-1-i] = name
	}
	second, err := FixturesDigest("liquid", reversed)
	if err != nil {
		t.Fatalf("otisk podruhé: %v", err)
	}
	if first != second {
		t.Fatal("otisk závisí na pořadí, což by dělalo paritu náhodnou")
	}
	partial, err := FixturesDigest("liquid", names[:len(names)-1])
	if err != nil {
		t.Fatalf("otisk podmnožiny: %v", err)
	}
	if partial == first {
		t.Fatal("otisk se nezměnil po vynechání souboru, takže nic nehlídá")
	}
}

func TestCheckTokenGoldenOdhaliRozchod(t *testing.T) {
	raw, err := ReadFixture("token/vectors.json")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	outcome, err := CheckTokenGolden(raw, TokenRunner{
		Init: func(string) error { return nil },
		Build: func(string, uint8, map[string]any) (string, []byte, error) {
			return "t1TOHLE_JE_SPATNE", []byte{0xde, 0xad}, nil
		},
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(outcome.Mismatches) == 0 {
		t.Fatal("runner přijal implementaci, která vrací jiný token")
	}
	if len(outcome.IDs) != 0 {
		t.Fatalf("runner započítal %d fixtur, které se rozešly", len(outcome.IDs))
	}
	if outcome.Total == 0 {
		t.Fatal("žádný vektor nemá sides go, parita by byla prázdná")
	}
}

func TestCheckCryptoGoldenOdhaliTichyUspech(t *testing.T) {
	raw, err := ReadFixture("crypto/vectors.json")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	// Implementace, která NIKDY neselže. Negativní vektory ji musí odhalit.
	outcome, err := CheckCryptoGolden(raw, CryptoRunner{
		Init:      func(string) error { return nil },
		Decrypt:   func(string, string, string) ([]byte, error) { return []byte("cokoliv"), nil },
		ErrorCode: func(err error) string { return err.Error() },
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(outcome.Mismatches) < 8 {
		t.Fatalf("runner propustil implementaci bez chyb, neshod je jen %d", len(outcome.Mismatches))
	}
	if code := (CryptoRunner{ErrorCode: func(err error) string { return err.Error() }}).
		ErrorCode(errors.New("crypto_unknown_key")); code != "crypto_unknown_key" {
		t.Fatal("překlad chyby na kontraktní kód nefunguje")
	}
}

func TestCheckLiquidGoldenOdhaliRozchodIPropustek(t *testing.T) {
	names, err := ListFixtures("liquid")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	read := func(name string) ([]byte, error) { return ReadFixture("liquid/" + name) }

	// Implementace, která vrací pořád totéž. Musí spadnout na render fixtures.
	outcome, err := CheckLiquidGolden("liquid", names, read, LiquidRunner{
		Render: func(string, []byte, []string, bool) (string, error) { return "SPATNE", nil },
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(outcome.Mismatches) == 0 {
		t.Fatal("runner propustil implementaci, která vrací konstantu")
	}
	if outcome.Total != len(names) {
		t.Fatalf("runner nezpracoval všechny fixtury: %d z %d", outcome.Total, len(names))
	}

	// Implementace, která nikdy neselže, nesmí projít u fixtur odmítnutých
	// validátorem, které NEJSOU v seznamu inertních.
	found := false
	for _, name := range names {
		raw, _ := read(name)
		var fixture liquidFixture
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if fixture.ExpectError != nil && !templateIsInertInGo(fixture.ID) {
			found = true
		}
	}
	if !found {
		t.Fatal("každá odmítnutá fixture je v templateIsInertInGo; seznam pak nic nehlídá")
	}
}

func TestCheckOutboxTransitionsOdhaliObracenouTabulku(t *testing.T) {
	raw, err := ReadFixture("outbox/scenarios.json")
	if err != nil {
		t.Fatalf("registr: %v", err)
	}
	outcome, err := CheckOutboxTransitions(raw, OutboxRunner{
		CanTransition: func(string, string, string, string) bool { return true },
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if outcome.Total != 14 {
		t.Fatalf("čekám 14 případů přechodu, je jich %d", outcome.Total)
	}
	// Implementace "všechno je povolené" musí spadnout na šesti zakázaných.
	if len(outcome.Mismatches) != 6 {
		t.Fatalf("čekám 6 neshod, je jich %d", len(outcome.Mismatches))
	}
}

func TestCheckMarkersGoldenOdhaliNecinnouNahradu(t *testing.T) {
	names, err := ListFixtures("markers")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	outcome, err := CheckMarkersGolden(names, func(name string) ([]byte, error) {
		return ReadFixture("markers/" + name)
	}, MarkersRunner{
		// Nahrazuje nic a tvrdí, že nahradila všechno.
		ReplaceLinks: func(src string, _ func(string) (string, error)) (string, int, error) {
			return src, 99, nil
		},
		ReplacePixel: func(src, _ string) (string, int) { return src, 0 },
		HasResidual:  func(string) bool { return false },
		PixelHTML:    func(string) string { return "" },
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(outcome.Mismatches) != outcome.Total {
		t.Fatalf("runner propustil nečinnou náhradu u %d z %d fixtur",
			outcome.Total-len(outcome.Mismatches), outcome.Total)
	}
}
