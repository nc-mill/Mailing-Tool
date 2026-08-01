package app

import (
	"context"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
)

// Job je jedna zpráva předaná workeru i s revizí kampaně.
//
// Revize se nese od claimu, aby si cache hlavičky nemusela nic dohledávat
// a aby nemohla zastarat.
type Job struct {
	Message  outbox.Message
	Revision int32
}

// Claimer je část store, kterou smyčka potřebuje. Rozhraní existuje kvůli
// testovatelnosti bez databáze.
type Claimer interface {
	ActiveCampaigns(ctx context.Context) ([]outbox.ActiveCampaign, error)
	ClaimBatch(ctx context.Context, campaignID uuid.UUID, batchSize, ttlSeconds int) ([]outbox.Message, error)
	ClaimTestBatch(ctx context.Context, batchSize, ttlSeconds int) ([]outbox.Message, error)
}

// ClaimOptions konfigurují smyčku.
type ClaimOptions struct {
	BatchSize       int
	ClaimTTLSeconds int
	// TestBatchSize je velikost přednostní dávky testovacích odeslání.
	TestBatchSize int
	// FilterBatch prochází celou claimnutou dávkou ještě před krokem D0.
	// Tudy se pouští DÁVKOVÁ kontrola suppression: jeden dotaz na dávku,
	// ne jeden na zprávu, a odfiltrované zprávy si zapíše sám filtr.
	// Prázdná hodnota znamená, že se dávka pouští dál beze změny.
	FilterBatch func(ctx context.Context, msgs []outbox.Message) ([]outbox.Message, error)
}

// ClaimLoop bere dávky z outboxu a předává je workerům.
//
// Jeden claimer znamená, že se dávky neberou souběžně a SKIP LOCKED prakticky
// nikdy nemusí uvnitř jednoho procesu nic přeskakovat. Souběh je až v dispatchi,
// kde je práce IO bound.
type ClaimLoop struct {
	claimer  Claimer
	opts     ClaimOptions
	rotation *outbox.Rotation
	// revisions drží revizi kampaně z posledního pollu.
	revisions map[uuid.UUID]int32
}

// NewClaimLoop vytvoří smyčku.
func NewClaimLoop(c Claimer, opts ClaimOptions) *ClaimLoop {
	if opts.TestBatchSize <= 0 {
		opts.TestBatchSize = 20
	}
	return &ClaimLoop{
		claimer:   c,
		opts:      opts,
		rotation:  outbox.NewRotation(),
		revisions: map[uuid.UUID]int32{},
	}
}

// Tick provede jeden průchod: obnoví seznam kampaní, přednostně vezme testovací
// odeslání a pak jede round robin přes běžící kampaně, dokud všechny nevyčerpají
// splatné zprávy.
//
// handle se volá pro každou claimnutou zprávu. Volající si řídí souběh sám.
func (l *ClaimLoop) Tick(ctx context.Context, handle func(context.Context, Job)) error {
	campaigns, err := l.claimer.ActiveCampaigns(ctx)
	if err != nil {
		return err
	}
	l.rotation.Set(campaigns)
	for _, c := range campaigns {
		l.revisions[c.ID] = c.Revision
	}

	// Testovací odeslání se claimuje samostatně a přednostně, na začátku tiku.
	// Bez toho by test čekal za probíhající kampaní.
	tests, err := l.claimer.ClaimTestBatch(ctx, l.opts.TestBatchSize, l.opts.ClaimTTLSeconds)
	if err != nil {
		return err
	}
	tests, err = l.filter(ctx, tests)
	if err != nil {
		return err
	}
	for _, m := range tests {
		handle(ctx, Job{Message: m, Revision: l.revisions[m.CampaignID]})
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		id, ok := l.rotation.Next()
		if !ok {
			return nil
		}
		batch, err := l.claimer.ClaimBatch(ctx, id, l.opts.BatchSize, l.opts.ClaimTTLSeconds)
		if err != nil {
			return err
		}
		if len(batch) == 0 {
			// Nula řádků je JEDINÝ signál, že kampaň nemá splatnou práci.
			// Krátká dávka je normální stav a kampaň v rotaci zůstává.
			l.rotation.Exhaust(id)
			continue
		}
		kept, err := l.filter(ctx, batch)
		if err != nil {
			return err
		}
		for _, m := range kept {
			handle(ctx, Job{Message: m, Revision: l.revisions[m.CampaignID]})
		}
	}
}

// filter pustí dávku přes volitelnou dávkovou kontrolu. Krátká dávka po filtru
// není signál konce práce: ten dává jedině nula řádků z claimu.
func (l *ClaimLoop) filter(ctx context.Context, msgs []outbox.Message) ([]outbox.Message, error) {
	if l.opts.FilterBatch == nil || len(msgs) == 0 {
		return msgs, nil
	}
	return l.opts.FilterBatch(ctx, msgs)
}

// Campaigns vrací počet kampaní v poslední rotaci. Používá se v logu při startu
// a při ladění.
func (l *ClaimLoop) Campaigns() int { return l.rotation.Len() }
