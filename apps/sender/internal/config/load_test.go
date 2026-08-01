package config

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func env(pairs ...string) func(string) (string, bool) {
	m := map[string]string{}
	for i := 0; i+1 < len(pairs); i += 2 {
		m[pairs[i]] = pairs[i+1]
	}
	return func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}
}

func noFiles(string) ([]byte, error) { return nil, errors.New("žádné soubory") }

func minimal(extra ...string) func(string) (string, bool) {
	base := []string{
		"SECRET_KEY", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
		"DATABASE_URL_SENDER", "postgres://mlain_sender:x@localhost:5432/mlain",
		"TRACKING_DOMAIN", "https://track.example.com",
	}
	return env(append(base, extra...)...)
}

func TestLoadAppliesContractDefaults(t *testing.T) {
	c, err := Load(minimal(), noFiles)
	if err != nil {
		t.Fatalf("Load vrátil chybu: %v", err)
	}
	if c.BatchSize != 100 {
		t.Errorf("BatchSize = %d, kontrakt 4.9 říká 100", c.BatchSize)
	}
	if c.Concurrency != 32 {
		t.Errorf("Concurrency = %d, chci 32", c.Concurrency)
	}
	if c.ClaimTTLSeconds != 300 {
		t.Errorf("ClaimTTLSeconds = %d, chci 300", c.ClaimTTLSeconds)
	}
	if c.HealthPort != 3002 {
		t.Errorf("HealthPort = %d, kontrakt 4.9 říká 3002", c.HealthPort)
	}
	if c.AmbiguousPolicySES != "fail" {
		t.Errorf("AmbiguousPolicySES = %q, chci fail", c.AmbiguousPolicySES)
	}
	if c.AmbiguousPolicySMTP != "retry" {
		t.Errorf("AmbiguousPolicySMTP = %q, chci retry", c.AmbiguousPolicySMTP)
	}
	if c.CredentialsMaxRetries != 10 {
		t.Errorf("CredentialsMaxRetries = %d, chci 10", c.CredentialsMaxRetries)
	}
}

func TestFileVariantWinsOverPlainValue(t *testing.T) {
	path := t.TempDir() + "/secret"
	if err := os.WriteFile(path, []byte("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	lookup := minimal("SECRET_KEY", "z-prostredi", "SECRET_KEY_FILE", path)
	c, err := Load(lookup, os.ReadFile)
	if err != nil {
		t.Fatalf("Load vrátil chybu: %v", err)
	}
	if c.SecretKey != "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8" {
		t.Fatalf("SecretKey = %q, _FILE měl vyhrát a hodnota se měla oříznout", c.SecretKey)
	}
}

func TestLoadReportsAllProblemsAtOnce(t *testing.T) {
	lookup := env(
		"SENDER_CONCURRENCY", "9999",
		"SENDER_BATCH_SIZE", "nula",
	)
	_, err := Load(lookup, noFiles)
	if err == nil {
		t.Fatal("chci chybu")
	}
	msg := err.Error()
	for _, want := range []string{"SECRET_KEY", "DATABASE_URL_SENDER", "TRACKING_DOMAIN", "SENDER_CONCURRENCY", "SENDER_BATCH_SIZE"} {
		if !strings.Contains(msg, want) {
			t.Errorf("hlášení neobsahuje %q, celé znění:\n%s", want, msg)
		}
	}
}

func TestSenderURLIsDerivedFromDatabaseURL(t *testing.T) {
	lookup := env(
		"SECRET_KEY", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
		"DATABASE_URL", "postgres://mlain_app:heslo@db:5432/mlain?sslmode=disable",
		"TRACKING_DOMAIN", "https://track.example.com/",
	)
	c, err := Load(lookup, noFiles)
	if err != nil {
		t.Fatalf("Load vrátil chybu: %v", err)
	}
	if c.DatabaseURL != "postgres://mlain_sender:heslo@db:5432/mlain?sslmode=disable" {
		t.Fatalf("DatabaseURL = %q", c.DatabaseURL)
	}
	if c.TrackingDomain != "https://track.example.com" {
		t.Fatalf("TrackingDomain = %q, koncové lomítko se mělo useknout", c.TrackingDomain)
	}
}
