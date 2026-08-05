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
	mu          sync.Mutex
	campaigns   []outbox.ActiveCampaign
	batches     map[uuid.UUID][][]outbox.Message
	nonCampaign [][]outbox.Message
	claims      int
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

func (f *fakeClaimer) ClaimNonCampaignBatch(context.Context, int, int) ([]outbox.Message, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.nonCampaign) == 0 {
		return nil, nil
	}
	next := f.nonCampaign[0]
	f.nonCampaign = f.nonCampaign[1:]
	return next, nil
}

func msgWith(id uuid.UUID, kind string) outbox.Message {
	return outbox.Message{
		Key:        outbox.MessageKey{ID: uuid.New(), CreatedAt: time.Unix(1_800_000_000, 0).UTC()},
		CampaignID: id,
		Kind:       kind,
	}
}

// Kampaňová smyčka se zpráv mimo kampaň NEDOTKNE. Kdyby je claimovala, čekaly
// by na dotočení celé rozesílky, což u resetu hesla znamená desítky minut.
func TestCampaignLoopIgnoresNonCampaignMessages(t *testing.T) {
	a := uuid.New()
	f := &fakeClaimer{
		campaigns:   []outbox.ActiveCampaign{{ID: a, Revision: 1}},
		batches:     map[uuid.UUID][][]outbox.Message{a: {{msgWith(a, "campaign")}}},
		nonCampaign: [][]outbox.Message{{msgWith(a, "transactional")}},
	}
	var kinds []string
	c := NewClaimLoop(f, ClaimOptions{BatchSize: 100, ClaimTTLSeconds: 300})
	if err := c.Tick(context.Background(), func(_ context.Context, job Job) {
		kinds = append(kinds, job.Message.Kind)
	}); err != nil {
		t.Fatal(err)
	}
	if len(kinds) != 1 || kinds[0] != "campaign" {
		t.Fatalf("kampaňový tik vydal %v, měl vydat jen kampaňovou zprávu", kinds)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.nonCampaign) != 1 {
		t.Fatal("kampaňový tik sáhl na dávku zpráv mimo kampaň")
	}
}

// Smyčka mimo kampaň bere transakční poštu nezávisle na kampaňovém tiku
// a vrací počet claimnutých zpráv, aby volající poznal, že má jít hned znovu.
func TestNonCampaignLoopClaimsIndependently(t *testing.T) {
	a := uuid.New()
	f := &fakeClaimer{
		campaigns:   []outbox.ActiveCampaign{{ID: a, Revision: 1}},
		batches:     map[uuid.UUID][][]outbox.Message{a: {{msgWith(a, "campaign")}}},
		nonCampaign: [][]outbox.Message{{msgWith(a, "transactional"), msgWith(a, "test")}},
	}
	l := NewNonCampaignLoop(f, ClaimOptions{ClaimTTLSeconds: 300})
	var kinds []string
	claimed, err := l.Tick(context.Background(), func(_ context.Context, job Job) {
		kinds = append(kinds, job.Message.Kind)
	})
	if err != nil {
		t.Fatal(err)
	}
	if claimed != 2 || len(kinds) != 2 || kinds[0] != "transactional" {
		t.Fatalf("claimnuto %d, druhy %v", claimed, kinds)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.claims != 0 {
		t.Fatal("smyčka mimo kampaň nesmí sahat na kampaňový claim")
	}
}

// Revizi nosné kampaně nese samotná zpráva. Skrytá kampaň zůstává ve stavu
// draft, takže v seznamu běžících kampaní není a revize by jinak zůstala nula:
// hlavička by se nacachovala napořád a změna transakční šablony by se do
// odeslané pošty nikdy nepromítla.
func TestNonCampaignJobCarriesRevisionFromMessage(t *testing.T) {
	a := uuid.New()
	msg := msgWith(a, "transactional")
	msg.Revision = 9
	f := &fakeClaimer{nonCampaign: [][]outbox.Message{{msg}}}
	l := NewNonCampaignLoop(f, ClaimOptions{ClaimTTLSeconds: 300})
	var got int32
	if _, err := l.Tick(context.Background(), func(_ context.Context, job Job) {
		got = job.Revision
	}); err != nil {
		t.Fatal(err)
	}
	if got != 9 {
		t.Fatalf("revize = %d, chci 9", got)
	}
}

// Dávka plná potlačených adres je pořád práce: smyčka musí jít hned pro další,
// ne usnout na tikeru jen proto, že filtr všechno zahodil.
func TestNonCampaignLoopCountsClaimedNotKept(t *testing.T) {
	a := uuid.New()
	f := &fakeClaimer{nonCampaign: [][]outbox.Message{{msgWith(a, "transactional")}}}
	l := NewNonCampaignLoop(f, ClaimOptions{
		ClaimTTLSeconds: 300,
		FilterBatch: func(context.Context, []outbox.Message) ([]outbox.Message, error) {
			return nil, nil
		},
	})
	handled := 0
	claimed, err := l.Tick(context.Background(), func(context.Context, Job) { handled++ })
	if err != nil {
		t.Fatal(err)
	}
	if claimed != 1 || handled != 0 {
		t.Fatalf("claimnuto %d, předáno %d", claimed, handled)
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
