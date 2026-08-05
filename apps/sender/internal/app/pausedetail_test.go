package app

import (
	"strings"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
)

// Detail pauzy čte ČLOVĚK v rozhraní, ne stroj.
//
// Kód pauzy je schválně hrubý, takže se kampaň s chybějící konfigurační sadou
// ukáže pod `provider_unavailable` a k tomu větou „odesílací služba neodpovídá".
// To je u téhle příčiny rovnou nepravda: Amazon odpověděl, jen v účtu chybí
// sada. Jediné místo, kde se dá říct pravda, je právě detail.
func TestPauseDetailVysvetluje(t *testing.T) {
	got := pauseDetail(errcatalog.ProviderEventConfigMissing, "NotFoundException", "")

	if !strings.Contains(got, "konfigurační sada") {
		t.Errorf("detail neříká, co je špatně: %q", got)
	}
	// Technická stopa musí zůstat, podpora se podle ní ptá Amazonu.
	if !strings.Contains(got, "NotFoundException") {
		t.Errorf("detail zahodil odpověď provideru: %q", got)
	}
	if !strings.Contains(got, errcatalog.ProviderEventConfigMissing) {
		t.Errorf("detail zahodil kód: %q", got)
	}
	// Vysvětlení je PRVNÍ. Detail se v rozhraní zkracuje a useknout se smí
	// technická stopa, ne věta pro uživatele.
	if strings.Index(got, "konfigurační sada") > strings.Index(got, "NotFoundException") {
		t.Errorf("technická stopa předbíhá vysvětlení: %q", got)
	}
}

// Neznámý kód si nesmí nic domyslet: místo vysvětlení zůstane holý kód.
func TestPauseDetailNeznamyKodNechavaPuvodniTvar(t *testing.T) {
	got := pauseDetail("tenhle_kod_neexistuje", "NějakáChyba", "")
	if got != "tenhle_kod_neexistuje (tenhle_kod_neexistuje, NějakáChyba)" {
		t.Fatalf("detail = %q, chci technický tvar bez vymyšleného popisu", got)
	}
}

// Provider nemusí vrátit vlastní kód ani větu.
func TestPauseDetailBezKoduProvidera(t *testing.T) {
	got := pauseDetail(errcatalog.CredentialsUndecryptable, "", "")
	if strings.Contains(got, "Provider odpověděl") {
		t.Fatalf("detail slibuje odpověď provideru, kterou nemá: %q", got)
	}
	if !strings.Contains(got, errcatalog.CredentialsUndecryptable) {
		t.Fatalf("detail zahodil kód: %q", got)
	}
}

// Věta od provideru je to nejcennější, co v detailu je: říká, KTERÁ identita
// neprošla a ve KTERÉM regionu. Obecné vysvětlení kódu jen „adresa nejspíš není
// ověřená" tohle nenahradí.
func TestPauseDetailNesePripadneVetuProvidera(t *testing.T) {
	veta := "Email address is not verified. The following identities failed the check " +
		"in region EU-WEST-1: ***@brevio.cz"
	got := pauseDetail(errcatalog.MessageRejected, "MessageRejected", veta)

	if !strings.Contains(got, "EU-WEST-1") {
		t.Errorf("detail zahodil region z odpovědi provideru: %q", got)
	}
	if !strings.Contains(got, "***@brevio.cz") {
		t.Errorf("detail zahodil identitu z odpovědi provideru: %q", got)
	}
	// Obecné vysvětlení zůstává, ale až za konkrétní větou.
	if strings.Index(got, "sandbox") > strings.Index(got, "Provider odpověděl") {
		t.Errorf("obecné vysvětlení má být PŘED větou provideru: %q", got)
	}
}
