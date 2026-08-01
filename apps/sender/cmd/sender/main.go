// Command sender je odesílací komponenta mlain. Spouští se jako MODE=sender.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/nc-mill/mlain/apps/sender/internal/config"
	"github.com/nc-mill/mlain/apps/sender/internal/obs"
	"github.com/nc-mill/mlain/apps/sender/internal/version"
)

// exitConfig je EX_CONFIG ze sysexits.h. TypeScriptová strana končí při chybné
// konfiguraci stejným kódem, takže orchestrátor rozliší chybu konfigurace od pádu.
const exitConfig = 78

func main() {
	for _, arg := range os.Args[1:] {
		switch arg {
		case "--version", "-version", "-v":
			// Vypisuje se HOLÁ verze, bez jména binárky. Kritérium 7e od P01
			// porovnává výstup přímo s tagem image a jakýkoliv prefix ho rozbije.
			// Argument se odbaví dřív, než se sáhne na konfiguraci: obraz se
			// verzí ptá bez proměnných prostředí.
			fmt.Println(version.Get())
			return
		case "--help", "-h":
			fmt.Println("ml-sender: odesílací komponenta mlain\n" +
				"Konfigurace se čte výhradně z prostředí, viz část 1, kapitola 4.9.\n" +
				"  --version  vypíše verzi binárky\n" +
				"  --help     vypíše tuhle nápovědu")
			return
		default:
			fmt.Fprintf(os.Stderr, "neznámý argument %q\n", arg)
			os.Exit(exitConfig)
		}
	}

	cfg, err := config.LoadFromOS()
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(exitConfig)
	}
	log := obs.NewLogger(os.Stdout, cfg.LogLevel, cfg.LogFormat)

	if cfg.Mode != "sender" && cfg.Mode != "all" {
		log.Info("sender se při tomhle režimu nespouští", "mode", cfg.Mode)
		return
	}

	// Signal handler ruší kořenový kontext. Odtud se odvíjí celé řízené ukončení.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	code, err := Run(ctx, cfg, log)
	if err != nil {
		log.Error("sender skončil s chybou", "error", err.Error())
	}
	os.Exit(code)
}
