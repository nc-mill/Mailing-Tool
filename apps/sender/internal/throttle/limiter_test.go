package throttle

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Kvóta se dělí staticky podle SENDER_REPLICAS a snižuje o bezpečnostní rezervu.
func TestComputeTargetDividesQuotaBetweenReplicas(t *testing.T) {
	cases := []struct {
		rate     float64
		replicas int
		safety   float64
		want     float64
	}{
		{50, 1, 0.9, 45},
		{50, 2, 0.9, 22.5},
		{100, 4, 1.0, 25},
		// Dolní mez je jedna zpráva za sekundu, aby se odesílání nikdy nezastavilo úplně.
		{0.5, 1, 0.9, 1},
		{2, 10, 0.9, 1},
	}
	for _, c := range cases {
		if got := ComputeTarget(c.rate, c.replicas, c.safety); got != c.want {
			t.Errorf("ComputeTarget(%v, %d, %v) = %v, chci %v", c.rate, c.replicas, c.safety, got, c.want)
		}
	}
}

// burst odpovídá jedné sekundě limitu, takže dovolí krátkou špičku po nečinnosti,
// ale ne dlouhou.
func TestBurstIsOneSecondOfLimit(t *testing.T) {
	if got := burstFor(45); got != 45 {
		t.Errorf("burstFor(45) = %d", got)
	}
	if got := burstFor(0.4); got != 1 {
		t.Errorf("burstFor(0.4) = %d, dolní mez je 1", got)
	}
	if got := burstFor(22.5); got != 23 {
		t.Errorf("burstFor(22.5) = %d, zaokrouhluje se nahoru", got)
	}
}

// AK-7.1: sender neodešle víc, než kolik povolí limit, s tolerancí burstu.
func TestWaitEnforcesRate(t *testing.T) {
	l := New(50, 1, 1.0) // 50 povolenek za sekundu, burst 50
	ctx := context.Background()
	// Vyčerpej burst.
	for i := 0; i < 50; i++ {
		if err := l.Wait(ctx); err != nil {
			t.Fatal(err)
		}
	}
	start := time.Now()
	for i := 0; i < 25; i++ {
		if err := l.Wait(ctx); err != nil {
			t.Fatal(err)
		}
	}
	elapsed := time.Since(start)
	if elapsed < 400*time.Millisecond {
		t.Fatalf("25 povolenek při 50 za sekundu trvalo %v, čekám aspoň 400 ms", elapsed)
	}
}

// AK-7.3: po throttlingu klesne limit na polovinu a postupně se vrátí k cíli.
func TestAIMDHalvesOnThrottleAndRecovers(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	l := New(100, 1, 1.0)
	l.now = func() time.Time { return now }

	if l.Current() != 100 {
		t.Fatalf("výchozí limit = %v", l.Current())
	}
	l.Throttled()
	if l.Current() != 50 {
		t.Fatalf("po throttlingu = %v, chci 50", l.Current())
	}
	l.Throttled()
	if l.Current() != 25 {
		t.Fatalf("po druhém throttlingu = %v, chci 25", l.Current())
	}

	// Návrat je aditivní a jen po uplynutí intervalu.
	l.MaybeRecover()
	if l.Current() != 25 {
		t.Fatalf("bez uplynutí intervalu se limit měnit nesmí, je %v", l.Current())
	}
	for i := 0; i < 20; i++ {
		now = now.Add(RecoverInterval)
		l.MaybeRecover()
	}
	if l.Current() != 100 {
		t.Fatalf("po dostatečném čase = %v, chci návrat na 100", l.Current())
	}
}

// Dolní mez zajistí, že se odesílání nikdy nezastaví úplně.
func TestThrottleNeverGoesBelowOne(t *testing.T) {
	l := New(2, 1, 1.0)
	for i := 0; i < 20; i++ {
		l.Throttled()
	}
	if l.Current() != MinRate {
		t.Fatalf("limit = %v, dolní mez je %v", l.Current(), MinRate)
	}
}

// Retry-After od providera přebíjí vypočtenou prodlevu.
func TestRetryAfterOverridesComputedDelay(t *testing.T) {
	explicit := 7 * time.Second
	if got := ThrottleDelay(&explicit, func() float64 { return 0 }); got != explicit {
		t.Fatalf("got %v, chci %v", got, explicit)
	}
	got := ThrottleDelay(nil, func() float64 { return 0 })
	if got != BaseThrottleDelay {
		t.Fatalf("bez Retry-After chci základní prodlevu %v, mám %v", BaseThrottleDelay, got)
	}
	withJitter := ThrottleDelay(nil, func() float64 { return 1 })
	if withJitter <= BaseThrottleDelay {
		t.Fatal("jitter se nepřičetl")
	}
}

// Registr drží jeden limiter na provider_id, sdílený všemi workery v procesu.
func TestRegistryReusesLimiterPerProvider(t *testing.T) {
	r := NewRegistry(1, 1.0)
	id := uuid.New()
	a := r.For(id, 50)
	b := r.For(id, 50)
	if a != b {
		t.Fatal("registr vrátil dva různé limitery pro tentýž provider")
	}
	if c := r.For(uuid.New(), 50); c == a {
		t.Fatal("registr sdílí limiter mezi providery")
	}
}

// Když aplikace přepíše kvótu, sender se jí přizpůsobí při dalším načtení.
func TestRegistryUpdatesTargetWhenQuotaChanges(t *testing.T) {
	r := NewRegistry(1, 1.0)
	id := uuid.New()
	l := r.For(id, 50)
	if l.Target() != 50 {
		t.Fatalf("cíl = %v", l.Target())
	}
	r.For(id, 200)
	if l.Target() != 200 {
		t.Fatalf("po změně kvóty je cíl %v, chci 200", l.Target())
	}
}
