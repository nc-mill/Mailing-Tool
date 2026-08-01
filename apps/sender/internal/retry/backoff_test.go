package retry

import (
	"testing"
	"time"
)

func noJitter() float64 { return 0 }

// Prodlevy rostou geometricky: 30 s, 2 min, 8 min, 32 min.
func TestDelayGrowsGeometrically(t *testing.T) {
	cases := []struct {
		attempts int
		want     time.Duration
	}{
		{1, 30 * time.Second},
		{2, 2 * time.Minute},
		{3, 8 * time.Minute},
		{4, 32 * time.Minute},
	}
	for _, c := range cases {
		if got := Delay(c.attempts, time.Hour, noJitter); got != c.want {
			t.Errorf("Delay(%d) = %v, chci %v", c.attempts, got, c.want)
		}
	}
}

func TestDelayIsCapped(t *testing.T) {
	if got := Delay(10, time.Hour, noJitter); got != time.Hour {
		t.Fatalf("got %v, strop je hodina", got)
	}
}

// Jitter je povinný. Bez něj by se po výpadku providera všech padesát tisíc
// zpráv pokusilo znovu ve stejnou vteřinu.
func TestJitterIsAddedOnTop(t *testing.T) {
	base := Delay(1, time.Hour, noJitter)
	full := Delay(1, time.Hour, func() float64 { return 1 })
	if full != base+time.Duration(float64(base)*JitterRatio) {
		t.Fatalf("plný jitter = %v, základ = %v", full, base)
	}
	half := Delay(1, time.Hour, func() float64 { return 0.5 })
	if half <= base || half >= full {
		t.Fatalf("poloviční jitter %v neleží mezi %v a %v", half, base, full)
	}
}

// AK-8.1: po vyčerpání pokusů končí zpráva jako failed s max_attempts_exceeded.
func TestExhaustedDecidesTerminalFailure(t *testing.T) {
	if Exhausted(4, 5) {
		t.Error("čtvrtý pokus z pěti ještě vyčerpaný není")
	}
	if !Exhausted(5, 5) {
		t.Error("pátý pokus z pěti je poslední")
	}
	if !Exhausted(6, 5) {
		t.Error("překročení limitu je vyčerpání")
	}
}

func TestDelayNeverNegative(t *testing.T) {
	if got := Delay(0, time.Hour, noJitter); got != 30*time.Second {
		t.Fatalf("nulový počet pokusů dá %v, chci základní prodlevu", got)
	}
}
