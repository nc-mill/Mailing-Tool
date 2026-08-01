// Package retry počítá prodlevu mezi pokusy o odeslání.
//
// Knihovna třetí strany se nepoužívá schválně: backoff je pět řádků aritmetiky
// a musí se počítat proti hodnotě attempts ULOŽENÉ V DATABÁZI, ne proti stavu
// v paměti. Sender může zprávu po restartu potkat znovu a stav v paměti neexistuje.
package retry

import "time"

const (
	// Base je prodleva po prvním neúspěchu.
	Base = 30 * time.Second
	// Factor je násobek mezi pokusy.
	Factor = 4
	// JitterRatio je podíl prodlevy, ze kterého se losuje náhodný přídavek.
	JitterRatio = 0.2
)

// Delay vrací prodlevu po attempts neúspěších.
//
// Formule je Base × Factor^(attempts-1) se stropem max. K výsledku se PŘIČTE
// náhodná hodnota z intervalu <0, prodleva × 0,2>. Jitter je povinný: bez něj
// by se po výpadku providera všechny zprávy pokusily znovu ve stejnou vteřinu.
func Delay(attempts int, max time.Duration, random func() float64) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	d := Base
	for i := 1; i < attempts; i++ {
		d *= Factor
		if d >= max {
			d = max
			break
		}
	}
	if d > max {
		d = max
	}
	return d + time.Duration(random()*JitterRatio*float64(d))
}

// Exhausted říká, jestli byl vyčerpaný poslední pokus. Zpráva pak končí
// jako failed s kódem max_attempts_exceeded.
//
// Throttling se do attempts nezapočítává (varianta D3e vrací pokus zpět)
// a fatální chyby také ne (varianta D3d).
func Exhausted(attempts, maxAttempts int) bool { return attempts >= maxAttempts }
