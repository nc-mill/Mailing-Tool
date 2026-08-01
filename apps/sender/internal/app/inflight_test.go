package app

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
)

func key() outbox.MessageKey {
	return outbox.MessageKey{ID: uuid.New(), CreatedAt: time.Unix(1_800_000_000, 0).UTC()}
}

func TestInflightTracksHeldMessages(t *testing.T) {
	s := NewInflight()
	a, b := key(), key()
	s.Add(outbox.Message{Key: a})
	s.Add(outbox.Message{Key: b})
	if s.Len() != 2 {
		t.Fatalf("Len = %d, chci 2", s.Len())
	}
	s.Done(a)
	if s.Len() != 1 {
		t.Fatalf("po Done je Len = %d, chci 1", s.Len())
	}
	held := s.Snapshot()
	if len(held) != 1 || held[0].Key.ID != b.ID {
		t.Fatalf("Snapshot = %v", held)
	}
}

// Heartbeat vyrábí obě pole z živé evidence, takže se druhá složka klíče
// nemůže cestou ztratit.
func TestSnapshotCarriesBothKeyParts(t *testing.T) {
	s := NewInflight()
	k := key()
	s.Add(outbox.Message{Key: k})
	ids, times := outbox.Keys(s.Snapshot())
	if len(ids) != 1 || len(times) != 1 {
		t.Fatalf("ids=%d times=%d", len(ids), len(times))
	}
	if ids[0] != k.ID || !times[0].Equal(k.CreatedAt) {
		t.Fatal("klíč se cestou změnil")
	}
}

// Zprávy s markerem se při shutdownu NEUVOLŇUJÍ, protože o nich nemáme důkaz,
// že neodešly. Uvolní se jen ty, u kterých odesílání nezačalo.
func TestUnstartedReturnsOnlyMessagesWithoutMarker(t *testing.T) {
	s := NewInflight()
	a, b := key(), key()
	s.Add(outbox.Message{Key: a})
	s.Add(outbox.Message{Key: b})
	s.MarkDispatchStarted(a)

	unstarted := s.Unstarted()
	if len(unstarted) != 1 || unstarted[0].Key.ID != b.ID {
		t.Fatalf("Unstarted = %v, chci jen zprávu bez markeru", unstarted)
	}
}

func TestDoneOnUnknownKeyIsHarmless(t *testing.T) {
	s := NewInflight()
	s.Done(key())
	if s.Len() != 0 {
		t.Fatal("Done na neznámý klíč nesmí nic rozbít")
	}
}
