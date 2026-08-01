package token

import (
	"encoding/hex"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
)

// Vektory jsou z části 1, kapitola 4.10.3. Jsou závazné a ověřené spuštěním.
// Kdyby spadly, nikdy neupravuj očekávané hodnoty, oprav implementaci.
var (
	vWorkspace = uuid.MustParse("0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071")
	vMessage   = uuid.MustParse("0192f3a0-1c2d-7e41-8b2c-3d4e5f607182")
	vLink      = uuid.MustParse("0192f3a0-1c2d-7e42-9c3d-4e5f60718293")
	vContact   = uuid.MustParse("0192f3a0-1c2d-7e43-8d4e-5f60718293a4")
	vList      = uuid.MustParse("0192f3a0-1c2d-7e45-8f60-718293a4b5c6")
	vCreated   = time.Unix(1784995200, 0).UTC()
)

func builder(t *testing.T) *Builder {
	t.Helper()
	kr, err := keyring.Parse("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewBuilder(kr)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestOpenTokenMatchesContractVector(t *testing.T) {
	got, err := builder(t).Open(vWorkspace, vMessage, vCreated)
	if err != nil {
		t.Fatal(err)
	}
	want := "t1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g"
	if got != want {
		t.Fatalf("open token\n got %s\nchci %s", got, want)
	}
	if len(got) != 74 {
		t.Fatalf("open token má %d znaků, kontrakt říká 74", len(got))
	}
}

func TestClickTokenMatchesContractVector(t *testing.T) {
	got, err := builder(t).Click(vWorkspace, vMessage, vLink, vCreated)
	if err != nil {
		t.Fatal(err)
	}
	want := "t1YwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5CnD1OX2BxgpNqZN2Aa8TprBxqhsgbR6l5AMMNpw"
	if got != want {
		t.Fatalf("click token\n got %s\nchci %s", got, want)
	}
	if len(got) != 96 {
		t.Fatalf("click token má %d znaků, kontrakt říká 96", len(got))
	}
}

func TestUnsubscribeTokenMatchesContractVector(t *testing.T) {
	got, err := builder(t).Unsubscribe(vWorkspace, vMessage, vContact, vList, vCreated)
	if err != nil {
		t.Fatal(err)
	}
	want := "t1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QBkvOgHC1-RY9gcYKTpLXGamTdgE4PEWHmqWZZuZDCD6L2SMw"
	if got != want {
		t.Fatalf("unsubscribe token\n got %s\nchci %s", got, want)
	}
	if len(got) != 117 {
		t.Fatalf("unsubscribe token má %d znaků, kontrakt říká 117", len(got))
	}
}

func TestGlobalUnsubscribeUsesZeroListID(t *testing.T) {
	got, err := builder(t).Unsubscribe(vWorkspace, vMessage, vContact, uuid.Nil, vCreated)
	if err != nil {
		t.Fatal(err)
	}
	want := "t1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QAAAAAAAAAAAAAAAAAAAAAamTdgLfjJDF8FrY9mr1K2TawYXw"
	if got != want {
		t.Fatalf("globální unsubscribe token\n got %s\nchci %s", got, want)
	}
}

func TestFullMacBeforeTruncationMatchesContract(t *testing.T) {
	b := builder(t)
	full, err := b.fullMAC(TypeOpen, payloadOpen(vWorkspace, vMessage, vCreated))
	if err != nil {
		t.Fatal(err)
	}
	want := "d48e6713c0f62ed50f5ca6a9923ece20c1aa4f25d47e9ab6938c8d86d6eac5b5"
	if got := hex.EncodeToString(full); got != want {
		t.Fatalf("plné HMAC\n got %s\nchci %s", got, want)
	}
}

func TestTokenCarriesMessageCreatedAtNotIssuedAt(t *testing.T) {
	b := builder(t)
	a1, err := b.Open(vWorkspace, vMessage, vCreated)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Millisecond)
	a2, err := b.Open(vWorkspace, vMessage, vCreated)
	if err != nil {
		t.Fatal(err)
	}
	if a1 != a2 {
		t.Fatal("token se nesmí lišit mezi dvěma voláními, nese message_created_at, ne čas vydání")
	}
}
