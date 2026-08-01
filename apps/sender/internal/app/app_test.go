package app

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
)

type releaseRecorder struct {
	released atomic.Int64
	msgs     []outbox.Message
}

func (r *releaseRecorder) ReleaseRemaining(_ context.Context, msgs []outbox.Message) (int64, error) {
	r.released.Add(int64(len(msgs)))
	r.msgs = append(r.msgs, msgs...)
	return int64(len(msgs)), nil
}

func (r *releaseRecorder) Heartbeat(context.Context, []outbox.Message, int) (int64, error) {
	return 0, nil
}

// AK-6.12: po SIGTERM se claimnuté zprávy BEZ markeru vrátí na pending
// do SHUTDOWN_GRACE_SECONDS.
func TestShutdownReleasesUnstartedMessages(t *testing.T) {
	in := NewInflight()
	a := outbox.Message{Key: key()}
	b := outbox.Message{Key: key()}
	in.Add(a)
	in.Add(b)
	in.MarkDispatchStarted(b.Key)

	rec := &releaseRecorder{}
	s := NewShutdown(in, rec, 2*time.Second)
	if err := s.Release(context.Background()); err != nil {
		t.Fatal(err)
	}
	if rec.released.Load() != 1 {
		t.Fatalf("uvolněno %d zpráv, čekám 1 bez markeru", rec.released.Load())
	}
	if rec.msgs[0].Key.ID != a.Key.ID {
		t.Fatal("uvolnila se špatná zpráva")
	}
}

// Exit kód je 0 i při vypršení lhůty. Nenulový kód by v Dockeru a Kubernetes
// vypadal jako pád a spustil restart smyčku.
func TestForcedShutdownStillExitsZero(t *testing.T) {
	in := NewInflight()
	in.Add(outbox.Message{Key: key()})
	rec := &releaseRecorder{}
	s := NewShutdown(in, rec, time.Millisecond)

	done := make(chan struct{})
	code := s.Wait(done, func() {})
	if code != 0 {
		t.Fatalf("exit kód = %d, chci 0", code)
	}
	if !s.Forced() {
		t.Fatal("chybí příznak vynuceného ukončení pro metriku sender_shutdown_forced_total")
	}
}

func TestCleanShutdownIsNotForced(t *testing.T) {
	in := NewInflight()
	rec := &releaseRecorder{}
	s := NewShutdown(in, rec, time.Second)

	done := make(chan struct{})
	close(done)
	if code := s.Wait(done, func() {}); code != 0 {
		t.Fatalf("exit kód = %d", code)
	}
	if s.Forced() {
		t.Fatal("čistý konec se nesmí hlásit jako vynucený")
	}
}

// Heartbeat běží až do konce lhůty. Bez toho by reaper jiné instance sebral
// rozpracované zprávy, které tahle instance ještě dokončuje.
func TestHeartbeatKeepsRunningDuringShutdown(t *testing.T) {
	in := NewInflight()
	in.Add(outbox.Message{Key: key()})
	beats := atomic.Int64{}
	s := NewShutdown(in, heartbeatFunc(func(context.Context, []outbox.Message, int) (int64, error) {
		beats.Add(1)
		return 1, nil
	}), 120*time.Millisecond)
	s.HeartbeatInterval = 20 * time.Millisecond

	done := make(chan struct{})
	s.Wait(done, func() {})
	if beats.Load() == 0 {
		t.Fatal("heartbeat se během ukončování zastavil")
	}
}

type heartbeatFunc func(context.Context, []outbox.Message, int) (int64, error)

func (f heartbeatFunc) Heartbeat(ctx context.Context, m []outbox.Message, ttl int) (int64, error) {
	return f(ctx, m, ttl)
}

func (f heartbeatFunc) ReleaseRemaining(context.Context, []outbox.Message) (int64, error) {
	return 0, nil
}

func TestReleaseErrorIsReported(t *testing.T) {
	in := NewInflight()
	in.Add(outbox.Message{Key: key()})
	s := NewShutdown(in, failingReleaser{}, time.Second)
	if err := s.Release(context.Background()); err == nil {
		t.Fatal("chyba uvolnění se musí propagovat")
	}
}

type failingReleaser struct{}

func (failingReleaser) ReleaseRemaining(context.Context, []outbox.Message) (int64, error) {
	return 0, errors.New("databáze je dole")
}
func (failingReleaser) Heartbeat(context.Context, []outbox.Message, int) (int64, error) {
	return 0, nil
}
