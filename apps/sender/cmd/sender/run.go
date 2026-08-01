package main

import (
	"context"
	"log/slog"

	"github.com/nc-mill/mlain/apps/sender/internal/app"
	"github.com/nc-mill/mlain/apps/sender/internal/config"
)

// Run sestaví aplikaci a odbaví její životní cyklus. Vrací exit kód procesu,
// a ten je při řízeném ukončení vždy 0.
func Run(ctx context.Context, cfg *config.Config, log *slog.Logger) (int, error) {
	a, err := app.New(ctx, cfg, log)
	if err != nil {
		return 1, err
	}
	defer a.Close()
	return a.Run(ctx), nil
}
