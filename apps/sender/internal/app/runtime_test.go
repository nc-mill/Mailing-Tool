//go:build integration

package app_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/nc-mill/mlain/apps/sender/internal/app"
	"github.com/nc-mill/mlain/apps/sender/internal/config"
	"github.com/nc-mill/mlain/apps/sender/internal/obs"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

// testConfig bere připojení senderu ze SPUŠTĚNÉHO harnessu, ne z prostředí.
// Harness roli zakládá a připojení odvozuje, takže prostředí ho nezná.
func testConfig(t *testing.T, db *testsupport.DB) *config.Config {
	t.Helper()
	cfg, err := config.Load(func(k string) (string, bool) {
		switch k {
		case "SECRET_KEY":
			return "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", true
		case "DATABASE_URL_SENDER":
			return db.SenderURL, true
		case "TRACKING_DOMAIN":
			return "https://track.example.com", true
		case "MODE":
			return "sender", true
		case "SENDER_ID":
			return "sender-runtime-test", true
		case "SENDER_CONCURRENCY":
			return "4", true
		case "SENDER_BATCH_SIZE":
			return "10", true
		}
		return "", false
	}, os.ReadFile)
	if err != nil {
		t.Fatal(err)
	}
	// Nula znamená "vyber volný port". Přes prostředí ji poslat nejde, protože
	// kontraktní rozsah SENDER_HEALTH_PORT je 1 až 65535, a pevný port by se
	// mezi souběžnými testy srazil.
	cfg.HealthPort = 0
	return cfg
}

// Sender nastartuje, projde recovery pass a odpoví na readiness probe.
func TestAppStartsAndReportsReady(t *testing.T) {
	db := testsupport.New(t)
	cfg := testConfig(t, db)
	log := obs.NewLogger(os.Stderr, "warn", "json")

	a, err := app.New(context.Background(), cfg, log)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	if err := a.Ping(context.Background()); err != nil {
		t.Fatalf("readiness selhala: %v", err)
	}
}

// Po zrušení kontextu se běh ukončí do lhůty a vrátí kód 0.
func TestAppStopsOnContextCancel(t *testing.T) {
	db := testsupport.New(t)
	cfg := testConfig(t, db)
	cfg.ShutdownGraceSeconds = 2
	log := obs.NewLogger(os.Stderr, "warn", "json")

	a, err := app.New(context.Background(), cfg, log)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan int, 1)
	go func() { done <- a.Run(ctx) }()

	time.Sleep(200 * time.Millisecond)
	cancel()

	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit kód = %d, chci 0", code)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("sender se neukončil do lhůty")
	}
}
