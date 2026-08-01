// Package breaker je pojistka, která zastaví kampaň, u které nemá smysl
// pokračovat.
//
// Rozdíl proti běžnému opakování je zásadní: když jsou v konfiguraci špatné
// přístupové údaje, každá z padesáti tisíc zpráv selže pětkrát a nadělá
// čtvrt milionu zbytečných volání. Pojistka tomu zabrání tím, že po několika
// stejných chybách kampaň pozastaví.
package breaker

import (
	"sync"

	"github.com/google/uuid"
)

const (
	// RenderWindow je počet prvních zpráv kampaně, ze kterých se podíl selhání
	// renderu vůbec vyhodnocuje. Po jeho vyčerpání pojistka mlčí.
	RenderWindow = 1000
	// RenderFailureRate je práh podílu selhání.
	RenderFailureRate = 0.05
	// RenderSampleWindow je počet posledních zpráv, ze kterých se podíl počítá.
	//
	// Kumulativní podíl od začátku kampaně je zavádějící: shluk čtyř selhání
	// na začátku každé stovky dá celkovou chybovost 4 %, ale kumulativní podíl
	// těsně po shluku vyskočí nad 5 % a pojistka by sepnula na kampani, která
	// je pod prahem. Klouzavé okno měří chybovost, která opravdu teče.
	RenderSampleWindow = 100
)

type state struct {
	consecutiveFatal int
	renderSeen       int
	renderFailed     int
	renderTripped    bool
	// sample je kruhový buffer posledních RenderSampleWindow výsledků.
	sample      [RenderSampleWindow]bool
	sampleAt    int
	sampleCount int
	sampleFails int
}

// Breaker drží ukazatele per kampaň.
type Breaker struct {
	mu             sync.Mutex
	fatalThreshold int
	minRenderFails int
	items          map[uuid.UUID]*state
}

// New vytvoří pojistku.
//
// fatalThreshold je SENDER_FATAL_THRESHOLD, výchozí 3.
// minRenderFails je dolní počet selhání renderu, výchozí 10. Bez něj by
// kampaň na 200 příjemců zastavilo pár náhodných chyb.
func New(fatalThreshold, minRenderFails int) *Breaker {
	if fatalThreshold < 1 {
		fatalThreshold = 3
	}
	if minRenderFails < 1 {
		minRenderFails = 10
	}
	return &Breaker{
		fatalThreshold: fatalThreshold,
		minRenderFails: minRenderFails,
		items:          map[uuid.UUID]*state{},
	}
}

func (b *Breaker) get(id uuid.UUID) *state {
	s, ok := b.items[id]
	if !ok {
		s = &state{}
		b.items[id] = s
	}
	return s
}

// Fatal zaznamená fatální chybu. Vrací true, když je čas kampaň pozastavit.
func (b *Breaker) Fatal(campaignID uuid.UUID) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.get(campaignID)
	s.consecutiveFatal++
	return s.consecutiveFatal >= b.fatalThreshold
}

// Success nuluje čítač fatálních chyb. Jakýkoliv úspěch znamená, že provider
// funguje a předchozí chyby byly přechodné.
func (b *Breaker) Success(campaignID uuid.UUID) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.get(campaignID).consecutiveFatal = 0
}

// Render zaznamená výsledek renderu jedné zprávy. Vrací true, když podíl
// selhání překročil práh.
//
// Vyhodnocuje se jen prvních RenderWindow zpráv kampaně a okno se znovu
// neotevírá: pojistka má zastavit rozesílku dřív, než odejde víc než padesát
// vadných mailů, ne reagovat na náhodný shluk uprostřed. Proti náhodnému shluku
// stojí dolní počet selhání, který se počítá kumulativně od začátku kampaně.
func (b *Breaker) Render(campaignID uuid.UUID, failed bool) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.get(campaignID)
	if s.renderTripped || s.renderSeen >= RenderWindow {
		return false
	}
	s.renderSeen++
	if failed {
		s.renderFailed++
	}
	s.observe(failed)
	if s.renderFailed < b.minRenderFails {
		return false
	}
	if float64(s.sampleFails)/float64(s.sampleCount) > RenderFailureRate {
		s.renderTripped = true
		return true
	}
	return false
}

// observe zapíše výsledek do klouzavého okna a vytlačí z něj nejstarší.
func (s *state) observe(failed bool) {
	if s.sampleCount == RenderSampleWindow {
		if s.sample[s.sampleAt] {
			s.sampleFails--
		}
	} else {
		s.sampleCount++
	}
	s.sample[s.sampleAt] = failed
	if failed {
		s.sampleFails++
	}
	s.sampleAt = (s.sampleAt + 1) % RenderSampleWindow
}

// Forget zahodí stav kampaně. Volá se po jejím pozastavení, aby po obnovení
// uživatelem začínala načisto.
func (b *Breaker) Forget(campaignID uuid.UUID) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.items, campaignID)
}
