package app

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
)

type fakeClaimer struct {
	mu        sync.Mutex
	campaigns []outbox.ActiveCampaign
	batches   map[uuid.UUID][][]outbox.Message
	tests     [][]outbox.Message
	claims    int
}

func (f *fakeClaimer) ActiveCampaigns(context.Context) ([]outbox.ActiveCampaign, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.campaigns, nil
}

func (f *fakeClaimer) ClaimBatch(_ context.Context, id uuid.UUID, _, _ int) ([]outbox.Message, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.claims++
	q := f.batches[id]
	if len(q) == 0 {
		return nil, nil
	}
	next := q[0]
	f.batches[id] = q[1:]
	return next, nil
}

func (f *fakeClaimer) ClaimTestBatch(context.Context, int, int) ([]outbox.Message, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.tests) == 0 {
		return nil, nil
	}
	next := f.tests[0]
	f.tests = f.tests[1:]
	return next, nil
}

func msgWith(id uuid.UUID, kind string) outbox.Message {
	return outbox.Message{
		Key:        outbox.MessageKey{ID: uuid.New(), CreatedAt: time.Unix(1_800_000_000, 0).UTC()},
		CampaignID: id,
		Kind:       kind,
	}
}

// Testovací odeslání má přednost před běžnou dávkou a claimuje se na začátku tiku.
func TestTestBatchIsClaimedFirst(t *testing.T) {
	a := uuid.New()
	f := &fakeClaimer{
		campaigns: []outbox.ActiveCampaign{{ID: a, Revision: 1}},
		batches:   map[uuid.UUID][][]outbox.Message{a: {{msgWith(a, "campaign")}}},
		tests:     [][]outbox.Message{{msgWith(a, "test")}},
	}
	var order []string
	c := NewClaimLoop(f, ClaimOptions{BatchSize: 100, ClaimTTLSeconds: 300})
	if err := c.Tick(context.Background(), func(_ context.Context, job Job) {
		order = append(order, job.Message.Kind)
	}); err != nil {
		t.Fatal(err)
	}
	if len(order) != 2 || order[0] != "test" {
		t.Fatalf("pořadí = %v, testovací odeslání musí být první", order)
	}
}

// Kampaň, která vrátí nula řádků, vypadne z rotace do dalšího pollu.
// Prázdná dávka není chyba a nesmí zastavit ostatní kampaně.
func TestExhaustedCampaignDoesNotBlockOthers(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	f := &fakeClaimer{
		campaigns: []outbox.ActiveCampaign{{ID: a, Revision: 1}, {ID: b, Revision: 1}},
		batches: map[uuid.UUID][][]outbox.Message{
			a: {},
			b: {{msgWith(b, "campaign")}, {msgWith(b, "campaign")}},
		},
	}
	c := NewClaimLoop(f, ClaimOptions{BatchSize: 100, ClaimTTLSeconds: 300})
	processed := 0
	for i := 0; i < 3; i++ {
		if err := c.Tick(context.Background(), func(context.Context, Job) { processed++ }); err != nil {
			t.Fatal(err)
		}
	}
	if processed != 2 {
		t.Fatalf("zpracováno %d zpráv, čekám 2 z kampaně b", processed)
	}
}

// Krátká dávka je normální stav. Konec práce se pozná JEN z nuly řádků,
// nikdy z počtu menšího než velikost dávky.
func TestShortBatchDoesNotEndTheCampaign(t *testing.T) {
	a := uuid.New()
	f := &fakeClaimer{
		campaigns: []outbox.ActiveCampaign{{ID: a, Revision: 1}},
		batches: map[uuid.UUID][][]outbox.Message{
			a: {{msgWith(a, "campaign")}, {msgWith(a, "campaign"), msgWith(a, "campaign")}},
		},
	}
	c := NewClaimLoop(f, ClaimOptions{BatchSize: 100, ClaimTTLSeconds: 300})
	total := 0
	for i := 0; i < 2; i++ {
		if err := c.Tick(context.Background(), func(context.Context, Job) { total++ }); err != nil {
			t.Fatal(err)
		}
	}
	if total != 3 {
		t.Fatalf("zpracováno %d zpráv, krátká dávka nesmí kampaň ukončit", total)
	}
}

// Pozastavená kampaň vypadne ze seznamu a claimer o ni přestane zavadit.
func TestPausedCampaignLeavesRotationOnNextPoll(t *testing.T) {
	a := uuid.New()
	f := &fakeClaimer{
		campaigns: []outbox.ActiveCampaign{{ID: a, Revision: 1}},
		batches:   map[uuid.UUID][][]outbox.Message{a: {{msgWith(a, "campaign")}}},
	}
	c := NewClaimLoop(f, ClaimOptions{BatchSize: 100, ClaimTTLSeconds: 300})
	if err := c.Tick(context.Background(), func(context.Context, Job) {}); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.campaigns = nil
	before := f.claims
	f.mu.Unlock()

	if err := c.Tick(context.Background(), func(context.Context, Job) {}); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	after := f.claims
	f.mu.Unlock()
	if after != before {
		t.Fatal("po vypadnutí ze seznamu se kampaň nesmí claimovat")
	}
}

// Revize se předává až k workeru, aby si cache hlavičky nemusela nic dohledávat.
func TestJobCarriesCampaignRevision(t *testing.T) {
	a := uuid.New()
	f := &fakeClaimer{
		campaigns: []outbox.ActiveCampaign{{ID: a, Revision: 7}},
		batches:   map[uuid.UUID][][]outbox.Message{a: {{msgWith(a, "campaign")}}},
	}
	c := NewClaimLoop(f, ClaimOptions{BatchSize: 100, ClaimTTLSeconds: 300})
	var got int32
	if err := c.Tick(context.Background(), func(_ context.Context, job Job) { got = job.Revision }); err != nil {
		t.Fatal(err)
	}
	if got != 7 {
		t.Fatalf("revize = %d, chci 7", got)
	}
}
