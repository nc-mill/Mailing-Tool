package provider

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Descriptor je výsledek načtení a dešifrování konfigurace providera.
//
// Fingerprint je otisk dešifrované konfigurace. Slouží k tomu, aby se dispatcher
// nepřestavoval, dokud se konfigurace nezměnila: u SMTP by to znamenalo zahodit
// celý pool spojení.
type Descriptor struct {
	Kind        string
	Fingerprint string
	// Quota je závazná rychlost. Bere se ze sloupce sending_providers.quota_max_send_rate,
	// který aktualizuje aplikace každých 15 minut. Hodnota z dešifrované obálky
	// se použije jen tehdy, když je sloupec prázdný.
	Quota float64
	// MaxMessageSize je nepovinné pole konfigurace providera v bajtech.
	// Nula znamená výchozích 9 MiB.
	MaxMessageSize int64
}

// Resolved je připravený provider pro jednu zprávu.
type Resolved struct {
	Dispatcher      Dispatcher
	Kind            string
	Quota           float64
	AmbiguousPolicy string
	MaxMessageSize  int64
}

// RegistryOptions konfigurují registr.
type RegistryOptions struct {
	TTL        time.Duration
	Now        func() time.Time
	PolicySES  string
	PolicySMTP string
	Load       func(ctx context.Context, providerID uuid.UUID) (*Descriptor, error)
	Build      func(d *Descriptor) (Dispatcher, error)
}

type registryEntry struct {
	desc       *Descriptor
	dispatcher Dispatcher
	loadedAt   time.Time
}

// Registry drží dešifrovanou konfiguraci a dispatchery.
//
// Dešifrovaná konfigurace se drží v paměti, NIKDY se nezapisuje na disk ani
// do logu. Struktura, která ji nese, má vlastní String a MarshalJSON vracející
// "[redacted]".
type Registry struct {
	mu    sync.Mutex
	opts  RegistryOptions
	items map[uuid.UUID]*registryEntry
}

// NewRegistry vytvoří registr.
func NewRegistry(opts RegistryOptions) *Registry {
	if opts.TTL <= 0 {
		opts.TTL = 60 * time.Second
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.PolicySES == "" {
		opts.PolicySES = "fail"
	}
	if opts.PolicySMTP == "" {
		opts.PolicySMTP = "retry"
	}
	return &Registry{opts: opts, items: map[uuid.UUID]*registryEntry{}}
}

// Get vrátí připraveného providera.
func (r *Registry) Get(ctx context.Context, providerID uuid.UUID) (*Resolved, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	entry, ok := r.items[providerID]
	if ok && r.opts.Now().Sub(entry.loadedAt) < r.opts.TTL {
		return r.resolve(entry), nil
	}

	desc, err := r.opts.Load(ctx, providerID)
	if err != nil {
		return nil, err
	}
	if ok && entry.desc.Fingerprint == desc.Fingerprint {
		entry.desc = desc
		entry.loadedAt = r.opts.Now()
		return r.resolve(entry), nil
	}
	dispatcher, err := r.opts.Build(desc)
	if err != nil {
		return nil, err
	}
	if ok && entry.dispatcher != nil {
		_ = entry.dispatcher.Close()
	}
	entry = &registryEntry{desc: desc, dispatcher: dispatcher, loadedAt: r.opts.Now()}
	r.items[providerID] = entry
	return r.resolve(entry), nil
}

func (r *Registry) resolve(e *registryEntry) *Resolved {
	policy := r.opts.PolicySMTP
	if e.desc.Kind == "ses" {
		policy = r.opts.PolicySES
	}
	return &Resolved{
		Dispatcher:      e.dispatcher,
		Kind:            e.desc.Kind,
		Quota:           e.desc.Quota,
		AmbiguousPolicy: policy,
		MaxMessageSize:  e.desc.MaxMessageSize,
	}
}

// Close zavře všechny dispatchery. Volá se při ukončování procesu.
func (r *Registry) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, e := range r.items {
		if e.dispatcher != nil {
			_ = e.dispatcher.Close()
		}
		delete(r.items, id)
	}
}
