package outbox_test

import (
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
)

func TestGoldenOutboxTransitions(t *testing.T) {
	contracts.RunOutboxTransitions(t, contracts.OutboxRunner{
		CanTransition: outbox.CanTransition,
	})
}
