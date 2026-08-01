package throttle

import (
	"sync"

	"github.com/google/uuid"
)

// Registry drží jeden limiter na provider_id.
type Registry struct {
	mu       sync.Mutex
	replicas int
	safety   float64
	items    map[uuid.UUID]*Limiter
}

// NewRegistry vytvoří prázdný registr.
func NewRegistry(replicas int, safety float64) *Registry {
	return &Registry{replicas: replicas, safety: safety, items: map[uuid.UUID]*Limiter{}}
}

// For vrátí limiter providera a rovnou mu srovná cíl s aktuální kvótou.
func (r *Registry) For(providerID uuid.UUID, providerRate float64) *Limiter {
	r.mu.Lock()
	defer r.mu.Unlock()
	if l, ok := r.items[providerID]; ok {
		l.SetTarget(providerRate, r.replicas, r.safety)
		return l
	}
	l := New(providerRate, r.replicas, r.safety)
	r.items[providerID] = l
	return l
}

// RecoverAll zvedne limity všech providerů, u kterých uplynul interval.
func (r *Registry) RecoverAll() {
	r.mu.Lock()
	limiters := make([]*Limiter, 0, len(r.items))
	for _, l := range r.items {
		limiters = append(limiters, l)
	}
	r.mu.Unlock()
	for _, l := range limiters {
		l.MaybeRecover()
	}
}

// Snapshot vrací aktuální limity pro metriky.
func (r *Registry) Snapshot() map[uuid.UUID]float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[uuid.UUID]float64, len(r.items))
	for id, l := range r.items {
		out[id] = l.Current()
	}
	return out
}
