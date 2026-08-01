// Command sender je odesílací komponenta mlain. Spouští se jako MODE=sender.
package main

import (
	"fmt"
	"os"

	"github.com/nc-mill/mlain/apps/sender/internal/config"
	"github.com/nc-mill/mlain/apps/sender/internal/version"
)

// exitConfig je EX_CONFIG ze sysexits.h. TypeScriptová strana končí při chybné
// konfiguraci stejným kódem, takže orchestrátor rozliší chybu konfigurace od pádu.
const exitConfig = 78

func main() {
	// --version je akceptační kritérium 7e od P01 a musí projít dřív, než se
	// vůbec sáhne na konfiguraci: obraz se verzí ptá bez proměnných prostředí.
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "-version") {
		fmt.Println(version.Get())
		return
	}

	cfg, err := config.LoadFromOS()
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(exitConfig)
	}
	if cfg.Mode != "sender" && cfg.Mode != "all" {
		fmt.Fprintf(os.Stderr, "MODE=%s, sender se nespouští\n", cfg.Mode)
		return
	}
	fmt.Fprintf(os.Stderr, "sender %s: konfigurace v pořádku\n", cfg.SenderID)
}
