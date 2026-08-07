package app

import (
	"fmt"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
)

// Chyba čtení řádku účtu se NESMÍ hlásit jako nedešifrovatelná konfigurace.
//
// Přesně tohle stálo vyšetřování: v databázi ležel kód
// credentials_undecryptable, takže se hledalo u SECRET_KEY a u rotace klíčů,
// zatímco příčina byla prázdná hodnota v jiném sloupci a klíče byly celou dobu
// v pořádku. Kód smí tvrdit jen to, co se opravdu stalo.
func TestDatabaseReadFailureIsNotReportedAsUndecryptableCredentials(t *testing.T) {
	err := fmt.Errorf("%w: konfigurace providera: cannot scan NULL into *bool",
		outbox.ErrProviderRowUnreadable)
	if got := providerErrorCode(err); got != errcatalog.ProviderConfigUnreadable {
		t.Fatalf("kód = %q, chci %q", got, errcatalog.ProviderConfigUnreadable)
	}
}

func TestContractMismatchKeepsItsOwnCode(t *testing.T) {
	err := fmt.Errorf("%w: typ providera v databázi je %q, v obálce %q",
		ErrProviderContractMismatch, "ses", "smtp")
	if got := providerErrorCode(err); got != errcatalog.ContractMismatch {
		t.Fatalf("kód = %q, chci %q", got, errcatalog.ContractMismatch)
	}
}

// Selhání dešifrování si svůj kód ponechává. Tenhle kód je pravdivý jen tady.
func TestDecryptionFailureStaysUndecryptable(t *testing.T) {
	if got := providerErrorCode(fmt.Errorf("crypto_auth_failed")); got != errcatalog.CredentialsUndecryptable {
		t.Fatalf("kód = %q, chci %q", got, errcatalog.CredentialsUndecryptable)
	}
}

// Věta v error_detail musí odpovídat kódu. Věta „konfiguraci providera nejde
// dešifrovat" u chyby čtení z databáze je nepravda, kterou si přečte každý,
// kdo se na řádek podívá.
func TestFailureMessageMatchesTheCode(t *testing.T) {
	if msg := providerFailureMessage(errcatalog.ProviderConfigUnreadable); msg == providerFailureMessage(errcatalog.CredentialsUndecryptable) {
		t.Fatal("chyba čtení z databáze má stejnou větu jako selhání dešifrování")
	}
	if errcatalog.Class(errcatalog.ProviderConfigUnreadable) != errcatalog.ClassFatal {
		t.Error("provider_config_unreadable musí být fatal: zprávy se vracejí na pending, neoznačují se za failed")
	}
	// Pauza jde do hrubšího registru pause_reason. Nový kód se do něj musí
	// vejít, jinak by ho výčet povolených hodnot odmítl a kampaň by se
	// nepozastavila vůbec.
	if got := errcatalog.PauseCode(errcatalog.ProviderConfigUnreadable); got != outbox.PauseProviderUnavailable {
		t.Errorf("PauseCode = %q, chci %q", got, outbox.PauseProviderUnavailable)
	}
}
