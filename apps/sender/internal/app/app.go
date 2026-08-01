package app

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
)

// Keeper je část store, kterou potřebuje ukončování.
type Keeper interface {
	Heartbeat(ctx context.Context, msgs []outbox.Message, ttlSeconds int) (int64, error)
	ReleaseRemaining(ctx context.Context, msgs []outbox.Message) (int64, error)
}

// Shutdown řídí ukončení procesu po SIGTERM nebo SIGINT.
//
// Pořadí je normativní:
//
//  1. zaznamená se lhůta
//  2. claimer se okamžitě zastaví, žádné nové claimy
//  3. campaignPoller a reaper se zastaví
//  4. heartbeat běží DÁL, jinak by reaper jiné instance sebral rozpracované
//     zprávy, které tahle instance ještě dokončuje
//  5. zprávy bez markeru se hromadně vrátí na pending, rozpracované se dokončí
//  6. při dokončení před lhůtou čistý konec
//  7. na lhůtě se zruší kořenový kontext
//  8. zavřou se spojení, proces končí kódem 0
type Shutdown struct {
	inflight *Inflight
	keeper   Keeper
	grace    time.Duration
	forced   atomic.Bool

	// HeartbeatInterval je perioda prodlužování claimů během ukončování.
	HeartbeatInterval time.Duration
	// ClaimTTLSeconds je hodnota, o kterou se claim prodlužuje.
	ClaimTTLSeconds int
}

// NewShutdown vytvoří řízené ukončování.
func NewShutdown(in *Inflight, keeper Keeper, grace time.Duration) *Shutdown {
	return &Shutdown{
		inflight:          in,
		keeper:            keeper,
		grace:             grace,
		HeartbeatInterval: 10 * time.Second,
		ClaimTTLSeconds:   300,
	}
}

// Release vrátí do fronty zprávy, u kterých odesílání nezačalo.
func (s *Shutdown) Release(ctx context.Context) error {
	unstarted := s.inflight.Unstarted()
	if len(unstarted) == 0 {
		return nil
	}
	_, err := s.keeper.ReleaseRemaining(ctx, unstarted)
	return err
}

// Wait počká, až workeři dojedou, nejdéle však do vypršení lhůty.
//
// Vrací exit kód procesu, a ten je VŽDY 0. Nenulový kód by v Dockeru
// a Kubernetes vypadal jako pád a spustil restart smyčku. Signálem je log
// na úrovni WARN a metrika sender_shutdown_forced_total.
//
// onDeadline se zavolá při vypršení lhůty a má zrušit kořenový kontext.
func (s *Shutdown) Wait(workersDone <-chan struct{}, onDeadline func()) int {
	deadline := time.NewTimer(s.grace)
	defer deadline.Stop()
	beat := time.NewTicker(s.HeartbeatInterval)
	defer beat.Stop()

	for {
		select {
		case <-workersDone:
			return 0
		case <-deadline.C:
			s.forced.Store(true)
			onDeadline()
			return 0
		case <-beat.C:
			held := s.inflight.Snapshot()
			if len(held) > 0 {
				_, _ = s.keeper.Heartbeat(context.Background(), held, s.ClaimTTLSeconds)
			}
		}
	}
}

// Forced říká, jestli vypršela lhůta. Jde do metriky sender_shutdown_forced_total.
func (s *Shutdown) Forced() bool { return s.forced.Load() }
