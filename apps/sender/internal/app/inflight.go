package app

import (
	"sync"

	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
)

type inflightEntry struct {
	msg     outbox.Message
	started bool
}

// Inflight je evidence zpráv, které instance právě drží.
//
// Slouží ke dvěma věcem. Heartbeat z ní vyrábí obě pole pro unnest, takže se
// druhá složka klíče nemůže cestou ztratit. Shutdown z ní bere zprávy bez markeru,
// které jde bezpečně vrátit do fronty.
type Inflight struct {
	mu    sync.Mutex
	items map[outbox.MessageKey]*inflightEntry
}

// NewInflight vytvoří prázdnou evidenci.
func NewInflight() *Inflight {
	return &Inflight{items: map[outbox.MessageKey]*inflightEntry{}}
}

// Add zaeviduje claimnutou zprávu.
func (s *Inflight) Add(msg outbox.Message) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[msg.Key] = &inflightEntry{msg: msg}
}

// MarkDispatchStarted zaznamená, že u zprávy proběhl krok D1.
func (s *Inflight) MarkDispatchStarted(k outbox.MessageKey) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.items[k]; ok {
		e.started = true
	}
}

// Done odebere zprávu z evidence po zápisu výsledku.
func (s *Inflight) Done(k outbox.MessageKey) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, k)
}

// Len je počet držených zpráv. Jde do metriky sender_inflight.
func (s *Inflight) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.items)
}

// Snapshot vrací všechny držené zprávy. Používá ho heartbeat.
func (s *Inflight) Snapshot() []outbox.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]outbox.Message, 0, len(s.items))
	for _, e := range s.items {
		out = append(out, e.msg)
	}
	return out
}

// Unstarted vrací zprávy, u kterých odesílání ještě nezačalo. Jen ty jde při
// shutdownu bezpečně vrátit do fronty: o zprávě s markerem nemáme důkaz,
// že neodešla, a vrátit ji zpět by z ní udělalo duplicitu.
func (s *Inflight) Unstarted() []outbox.Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]outbox.Message, 0, len(s.items))
	for _, e := range s.items {
		if !e.started {
			out = append(out, e.msg)
		}
	}
	return out
}
