package provider

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type stubDispatcher struct {
	name   string
	closed bool
}

func (s *stubDispatcher) Dispatch(context.Context, *OutgoingMessage) (string, error) {
	return "id", nil
}
func (s *stubDispatcher) Classify(error) Verdict { return Verdict{} }
func (s *stubDispatcher) Close() error           { s.closed = true; return nil }
func (s *stubDispatcher) Name() string           { return s.name }

func TestRegistryCachesDecryptedConfigForTTL(t *testing.T) {
	loads := 0
	now := time.Unix(1_800_000_000, 0)
	r := NewRegistry(RegistryOptions{
		TTL: 60 * time.Second,
		Now: func() time.Time { return now },
		Load: func(context.Context, uuid.UUID) (*Descriptor, error) {
			loads++
			return &Descriptor{Kind: "ses", Fingerprint: "abc", Quota: 50}, nil
		},
		Build: func(*Descriptor) (Dispatcher, error) { return &stubDispatcher{name: "ses"}, nil },
	})
	id := uuid.New()
	for i := 0; i < 5; i++ {
		if _, err := r.Get(context.Background(), id); err != nil {
			t.Fatal(err)
		}
	}
	if loads != 1 {
		t.Fatalf("konfigurace se načetla %d krát, čekám 1", loads)
	}
	now = now.Add(61 * time.Second)
	if _, err := r.Get(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if loads != 2 {
		t.Fatalf("po vypršení TTL se konfigurace načetla %d krát, čekám 2", loads)
	}
}

// Dispatcher se drží podle otisku konfigurace. Když se otisk nezmění, zůstává
// tentýž klient a SMTP pool se nezahazuje.
func TestRegistryKeepsDispatcherWhileFingerprintIsStable(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	builds := 0
	r := NewRegistry(RegistryOptions{
		TTL: time.Second,
		Now: func() time.Time { return now },
		Load: func(context.Context, uuid.UUID) (*Descriptor, error) {
			return &Descriptor{Kind: "smtp", Fingerprint: "stejny", Quota: 10}, nil
		},
		Build: func(*Descriptor) (Dispatcher, error) {
			builds++
			return &stubDispatcher{name: "smtp"}, nil
		},
	})
	id := uuid.New()
	for i := 0; i < 3; i++ {
		if _, err := r.Get(context.Background(), id); err != nil {
			t.Fatal(err)
		}
		now = now.Add(2 * time.Second)
	}
	if builds != 1 {
		t.Fatalf("dispatcher se postavil %d krát, čekám 1", builds)
	}
}

// Při změně otisku se starý dispatcher zavře a postaví se nový.
func TestRegistryRebuildsAndClosesOnFingerprintChange(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	fingerprint := "prvni"
	var first *stubDispatcher
	r := NewRegistry(RegistryOptions{
		TTL: time.Second,
		Now: func() time.Time { return now },
		Load: func(context.Context, uuid.UUID) (*Descriptor, error) {
			return &Descriptor{Kind: "smtp", Fingerprint: fingerprint, Quota: 10}, nil
		},
		Build: func(*Descriptor) (Dispatcher, error) {
			d := &stubDispatcher{name: "smtp"}
			if first == nil {
				first = d
			}
			return d, nil
		},
	})
	id := uuid.New()
	if _, err := r.Get(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	fingerprint = "druhy"
	now = now.Add(2 * time.Second)
	if _, err := r.Get(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if !first.closed {
		t.Fatal("starý dispatcher se nezavřel")
	}
}

// Politika nejednoznačného odeslání se vybírá podle typu providera, ne podle
// konfigurace kampaně.
func TestPolicyIsChosenByProviderKind(t *testing.T) {
	r := NewRegistry(RegistryOptions{
		TTL:        time.Minute,
		Now:        time.Now,
		PolicySES:  "fail",
		PolicySMTP: "retry",
		Load: func(_ context.Context, id uuid.UUID) (*Descriptor, error) {
			if id.String()[0] == '0' {
				return &Descriptor{Kind: "ses", Fingerprint: "a", Quota: 1}, nil
			}
			return &Descriptor{Kind: "smtp", Fingerprint: "b", Quota: 1}, nil
		},
		Build: func(d *Descriptor) (Dispatcher, error) { return &stubDispatcher{name: d.Kind}, nil },
	})
	ses, err := r.Get(context.Background(), uuid.MustParse("0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071"))
	if err != nil {
		t.Fatal(err)
	}
	if ses.AmbiguousPolicy != "fail" {
		t.Errorf("SES politika = %q, chci fail", ses.AmbiguousPolicy)
	}
	smtp, err := r.Get(context.Background(), uuid.MustParse("f192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071"))
	if err != nil {
		t.Fatal(err)
	}
	if smtp.AmbiguousPolicy != "retry" {
		t.Errorf("SMTP politika = %q, chci retry", smtp.AmbiguousPolicy)
	}
}

// Chyba dešifrování se nekešuje jako platný stav a propaguje se ven.
func TestRegistryPropagatesLoadError(t *testing.T) {
	r := NewRegistry(RegistryOptions{
		TTL: time.Minute,
		Now: time.Now,
		Load: func(context.Context, uuid.UUID) (*Descriptor, error) {
			return nil, errors.New("crypto_auth_failed")
		},
		Build: func(*Descriptor) (Dispatcher, error) { return &stubDispatcher{}, nil },
	})
	if _, err := r.Get(context.Background(), uuid.New()); err == nil {
		t.Fatal("chyba dešifrování se musí propagovat")
	}
}
