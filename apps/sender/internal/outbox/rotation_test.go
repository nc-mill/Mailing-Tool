package outbox

import (
	"testing"

	"github.com/google/uuid"
)

func TestRotationVisitsCampaignsInTurn(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	r := NewRotation()
	r.Set([]ActiveCampaign{{ID: a}, {ID: b}, {ID: c}})

	got := []uuid.UUID{}
	for i := 0; i < 4; i++ {
		id, ok := r.Next()
		if !ok {
			t.Fatal("rotace vrátila prázdno, přestože kampaně existují")
		}
		got = append(got, id)
	}
	want := []uuid.UUID{a, b, c, a}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("krok %d: got %s, chci %s", i, got[i], want[i])
		}
	}
}

// Kampaň, která nevrátí žádný řádek, vypadne z rotace do dalšího pollu.
func TestExhaustedCampaignLeavesRotation(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	r := NewRotation()
	r.Set([]ActiveCampaign{{ID: a}, {ID: b}})
	r.Exhaust(a)

	for i := 0; i < 3; i++ {
		id, ok := r.Next()
		if !ok {
			t.Fatal("rotace vyprázdněla, přestože b má pořád pracovat")
		}
		if id == a {
			t.Fatal("vyčerpaná kampaň se vrátila do rotace před dalším pollem")
		}
	}
	r.Set([]ActiveCampaign{{ID: a}, {ID: b}})
	seenA := false
	for i := 0; i < 2; i++ {
		id, _ := r.Next()
		if id == a {
			seenA = true
		}
	}
	if !seenA {
		t.Fatal("po dalším pollu se vyčerpaná kampaň musí vrátit do rotace")
	}
}

func TestRotationIsEmptyWithoutCampaigns(t *testing.T) {
	r := NewRotation()
	if _, ok := r.Next(); ok {
		t.Fatal("prázdná rotace nesmí nic vracet")
	}
}
