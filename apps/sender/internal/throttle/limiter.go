// Package throttle drží rychlost odesílání pod kvótou providera.
//
// Algoritmus je token bucket nad golang.org/x/time/rate, jeden limiter
// na provider_id, sdílený všemi workery v procesu. Worker si povolenku bere
// jako krok D0, tedy PŘED markerem: čeká se dřív, než se cokoliv zapíše,
// takže čekající zpráva nezabírá stav v databázi.
package throttle

import (
	"context"
	"math"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const (
	// MinRate je dolní mez, pod kterou AIMD nikdy nejde. Zajišťuje, že se
	// odesílání nezastaví úplně ani při trvalém škrcení.
	MinRate = 1.0
	// ThrottleFactor je multiplikativní pokles při throttlingu.
	ThrottleFactor = 0.5
	// RecoverFactor je postupný návrat nahoru.
	RecoverFactor = 1.2
	// RecoverInterval je perioda, po které se limit zvedá.
	RecoverInterval = 30 * time.Second
	// BaseThrottleDelay je prodleva, se kterou se zpráva odmítnutá throttlingem
	// vrací do fronty variantou D3e.
	BaseThrottleDelay = 5 * time.Second
	// ThrottleJitterRatio je podíl prodlevy, ze kterého se losuje jitter.
	ThrottleJitterRatio = 0.2
)

// ComputeTarget spočítá cílovou rychlost jedné instance.
//
// Kvóta se dělí staticky podle SENDER_REPLICAS. Dynamická koordinace by
// potřebovala buď Redis, který je pro MVP 0 vyloučený, nebo zapisovatelnou
// tabulku, což by rozšířilo práva senderu. Statické dělení je samoopravné:
// při příliš vysoké hodnotě se odesílá pomaleji a nic se nerozbije, při příliš
// nízké začne provider vracet throttling, sender zpomalí a zprávy se doručí.
func ComputeTarget(providerRate float64, replicas int, safety float64) float64 {
	if replicas < 1 {
		replicas = 1
	}
	if safety <= 0 || safety > 1 {
		safety = 0.9
	}
	t := providerRate / float64(replicas) * safety
	if t < MinRate {
		return MinRate
	}
	return t
}

func burstFor(r float64) int {
	b := int(math.Ceil(r))
	if b < 1 {
		return 1
	}
	return b
}

// Limiter je token bucket s AIMD úpravou za běhu.
type Limiter struct {
	mu          sync.Mutex
	lim         *rate.Limiter
	target      float64
	current     float64
	lastRecover time.Time
	now         func() time.Time
}

// New vytvoří limiter pro jednoho providera.
func New(providerRate float64, replicas int, safety float64) *Limiter {
	t := ComputeTarget(providerRate, replicas, safety)
	l := &Limiter{
		lim:     rate.NewLimiter(rate.Limit(t), burstFor(t)),
		target:  t,
		current: t,
		now:     time.Now,
	}
	l.lastRecover = l.now()
	return l
}

// Wait je krok D0. Blokuje, dokud není povolenka k dispozici, nebo dokud
// se nezruší kontext.
func (l *Limiter) Wait(ctx context.Context) error { return l.lim.Wait(ctx) }

// Throttled sníží limit na polovinu. Volá se, když provider vrátí chybu
// klasifikovanou jako ClassThrottled.
func (l *Limiter) Throttled() {
	l.mu.Lock()
	defer l.mu.Unlock()
	next := l.current * ThrottleFactor
	if next < MinRate {
		next = MinRate
	}
	l.apply(next)
	l.lastRecover = l.now()
}

// MaybeRecover zvedne limit, když od posledního throttlingu uplynul interval.
// Volá se periodicky z hlavní smyčky.
func (l *Limiter) MaybeRecover() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.current >= l.target {
		return
	}
	if l.now().Sub(l.lastRecover) < RecoverInterval {
		return
	}
	next := l.current * RecoverFactor
	if next > l.target {
		next = l.target
	}
	l.apply(next)
	l.lastRecover = l.now()
}

// apply předpokládá zamčený mutex.
func (l *Limiter) apply(next float64) {
	l.current = next
	l.lim.SetLimit(rate.Limit(next))
	l.lim.SetBurst(burstFor(next))
}

// SetTarget přepíše cílovou rychlost, když aplikace změnila kvótu.
func (l *Limiter) SetTarget(providerRate float64, replicas int, safety float64) {
	t := ComputeTarget(providerRate, replicas, safety)
	l.mu.Lock()
	defer l.mu.Unlock()
	if t == l.target {
		return
	}
	l.target = t
	if l.current > t {
		l.apply(t)
		return
	}
	// Snížený limit po throttlingu se novým cílem nezvyšuje skokem,
	// zvedne ho až AIMD.
	l.apply(l.current)
}

// Current je aktuální limit po úpravách AIMD. Jde do metriky
// sender_rate_limit_current, takže je v Grafaně vidět, kdy sender škrtí sám sebe.
func (l *Limiter) Current() float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.current
}

// Target je cílová rychlost bez úprav AIMD.
func (l *Limiter) Target() float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.target
}

// ThrottleDelay vrací prodlevu pro variantu D3e. Když provider pošle
// Retry-After, respektuje se místo výpočtu.
func ThrottleDelay(retryAfter *time.Duration, random func() float64) time.Duration {
	if retryAfter != nil && *retryAfter > 0 {
		return *retryAfter
	}
	jitter := time.Duration(random() * ThrottleJitterRatio * float64(BaseThrottleDelay))
	return BaseThrottleDelay + jitter
}
