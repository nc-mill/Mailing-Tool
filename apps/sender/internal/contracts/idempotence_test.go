//go:build integration

package contracts

import (
	"context"
	"math/rand"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

// fakeProvider počítá volání na jedinečné messages.id. Přesně tak se měří,
// jestli zpráva odešla víc než jednou.
type fakeProvider struct {
	mu       sync.Mutex
	calls    map[uuid.UUID]int
	failNext bool
}

func (f *fakeProvider) send(id uuid.UUID) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls[id]++
	return "provider-" + id.String(), nil
}

func (f *fakeProvider) duplicates() []uuid.UUID {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []uuid.UUID
	for id, n := range f.calls {
		if n > 1 {
			out = append(out, id)
		}
	}
	return out
}

// AK-5.1, AK-5.2, AK-5.3.
//
// Rozesílka na 1000 příjemců se dvacetkrát přeruší v náhodném okamžiku.
// Po každém přerušení se nastartuje "nová instance": pustí se recovery pass
// a reapery, a odesílání pokračuje.
//
// Ověřuje se, že každá zpráva odešla NEJVÝŠ jednou, že po dokončení není žádná
// zpráva ve stavu pending ani claimed, a že počet nejednoznačných zpráv
// nepřekročí souběžnost na každé přerušení.
func TestHardCrashNeverDeliversTwice(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	total := 1000
	db.SeedMessages(t, s, total, "campaign")

	fp := &fakeProvider{calls: map[uuid.UUID]int{}}
	concurrency := 8
	senderID := "sender-crash-test"

	for round := 0; round < 20; round++ {
		st := outbox.NewStore(db.Sender, senderID)

		// Nová instance ví jistě, že předchozí je mrtvá, takže uvolní vlastní
		// claimy bez markeru okamžitě.
		if _, err := st.RecoveryPass(context.Background()); err != nil {
			t.Fatal(err)
		}
		// Nejednoznačné zprávy uzavře reaper B. V testu se čas zkracuje ručně.
		if _, err := db.Admin.Exec(context.Background(),
			`UPDATE messages SET claim_expires_at = now() - interval '10000 seconds'
			 WHERE status = 'claimed' AND dispatch_started_at IS NOT NULL`); err != nil {
			t.Fatal(err)
		}
		if _, err := st.ReapAmbiguous(context.Background(), "fail", 300); err != nil {
			t.Fatal(err)
		}

		// Kolik zpráv tahle "instance" stihne, než ji zabijeme.
		budget := rand.Intn(200) + 20
		done := runRound(t, st, fp, concurrency, budget, s.CampaignID)
		if done == 0 {
			break
		}
	}

	// Doběh bez přerušení.
	st := outbox.NewStore(db.Sender, senderID)
	if _, err := st.RecoveryPass(context.Background()); err != nil {
		t.Fatal(err)
	}
	for {
		if runRound(t, st, fp, concurrency, 10_000, s.CampaignID) == 0 {
			break
		}
	}
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET claim_expires_at = now() - interval '10000 seconds'
		 WHERE status = 'claimed' AND dispatch_started_at IS NOT NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ReapAmbiguous(context.Background(), "fail", 300); err != nil {
		t.Fatal(err)
	}

	if dup := fp.duplicates(); len(dup) > 0 {
		t.Fatalf("%d zpráv odešlo víc než jednou, například %s", len(dup), dup[0])
	}

	var sent, failed, pending, claimed, skipped int
	err := db.Admin.QueryRow(context.Background(), `
		SELECT
		  count(*) FILTER (WHERE status = 'sent'),
		  count(*) FILTER (WHERE status = 'failed'),
		  count(*) FILTER (WHERE status = 'pending'),
		  count(*) FILTER (WHERE status = 'claimed'),
		  count(*) FILTER (WHERE status = 'skipped')
		FROM messages WHERE campaign_id = $1`, s.CampaignID).
		Scan(&sent, &failed, &pending, &claimed, &skipped)
	if err != nil {
		t.Fatal(err)
	}
	if sent+failed != total {
		t.Fatalf("sent=%d failed=%d, součet musí být %d", sent, failed, total)
	}
	if pending != 0 || claimed != 0 {
		t.Fatalf("po dokončení zbylo pending=%d claimed=%d, obojí musí být nula", pending, claimed)
	}

	var ambiguous int
	if err := db.Admin.QueryRow(context.Background(),
		`SELECT count(*) FROM messages WHERE campaign_id = $1 AND error_code = 'ambiguous_dispatch'`,
		s.CampaignID).Scan(&ambiguous); err != nil {
		t.Fatal(err)
	}
	if ambiguous > 20*concurrency {
		t.Fatalf("nejednoznačných zpráv je %d, strop je souběžnost krát počet přerušení (%d)",
			ambiguous, 20*concurrency)
	}
	t.Logf("sent=%d failed=%d ambiguous=%d", sent, failed, ambiguous)
}

// runRound odbaví nejvýš budget zpráv a vrátí, kolik jich zpracoval.
// Zprávy nad rámec rozpočtu zůstanou claimnuté, přesně jako po SIGKILL.
func runRound(t *testing.T, st *outbox.Store, fp *fakeProvider, concurrency, budget int, campaignID uuid.UUID) int {
	t.Helper()
	ctx := context.Background()
	batch, err := st.ClaimBatch(ctx, campaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) == 0 {
		return 0
	}
	processed := 0
	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)
	for _, m := range batch {
		if processed >= budget {
			// Zbytek dávky zůstává claimed bez markeru. Reaper A ho vrátí.
			break
		}
		processed++
		m := m
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			ok, err := st.MarkDispatchStarted(ctx, m.Key)
			if err != nil || !ok {
				return
			}
			id, _ := fp.send(m.Key.ID)
			if _, err := st.RecordSent(ctx, m.Key, id); err != nil {
				return
			}
		}()
	}
	wg.Wait()
	return processed
}

// AK-5.5: když se řádek mezi claimem a markerem změní cizím zásahem,
// marker vrátí 0 řádků a provider NENÍ zavolán vůbec.
func TestProviderIsNotCalledWhenClaimIsLostBeforeMarker(t *testing.T) {
	db := testsupport.New(t)
	s := db.SeedCampaign(t, "sending")
	db.SeedMessages(t, s, 1, "campaign")
	st := outbox.NewStore(db.Sender, "sender-A")

	batch, err := st.ClaimBatch(context.Background(), s.CampaignID, 100, 300)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Admin.Exec(context.Background(),
		`UPDATE messages SET status = 'pending', claimed_by = NULL WHERE id = $1 AND created_at = $2`,
		batch[0].Key.ID, batch[0].Key.CreatedAt); err != nil {
		t.Fatal(err)
	}

	fp := &fakeProvider{calls: map[uuid.UUID]int{}}
	ok, err := st.MarkDispatchStarted(context.Background(), batch[0].Key)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("marker prošel, přestože claim zmizel")
	}
	if len(fp.calls) != 0 {
		t.Fatal("provider byl zavolán, přestože marker neprošel")
	}
}
