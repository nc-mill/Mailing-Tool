package breaker

import (
	"testing"

	"github.com/google/uuid"
)

// AK-8.3: tři po sobě jdoucí fatální chyby pozastaví kampaň.
func TestThreeConsecutiveFatalErrorsTrip(t *testing.T) {
	b := New(3, 10)
	c := uuid.New()
	if b.Fatal(c) {
		t.Error("první fatální chyba nesmí sepnout")
	}
	if b.Fatal(c) {
		t.Error("druhá fatální chyba nesmí sepnout")
	}
	if !b.Fatal(c) {
		t.Error("třetí fatální chyba musí sepnout")
	}
}

// Čítač fatálních chyb nuluje jakýkoliv úspěch.
func TestSuccessResetsFatalCounter(t *testing.T) {
	b := New(3, 10)
	c := uuid.New()
	b.Fatal(c)
	b.Fatal(c)
	b.Success(c)
	if b.Fatal(c) {
		t.Fatal("po úspěchu se čítač nevynuloval")
	}
}

// Kampaně se navzájem neovlivňují.
func TestCountersAreIndependentPerCampaign(t *testing.T) {
	b := New(2, 10)
	a, c := uuid.New(), uuid.New()
	b.Fatal(a)
	if b.Fatal(c) {
		t.Fatal("chyba jedné kampaně sepnula pojistku jiné")
	}
}

// AK-6.11: když z prvních 1000 zpráv selže na renderu víc než 5 procent,
// kampaň se pozastaví. Při 4 procentech zůstává rozjetá.
func TestRenderFailureRateTripsAboveFivePercent(t *testing.T) {
	b := New(3, 10)
	c := uuid.New()
	tripped := false
	for i := 0; i < 1000; i++ {
		// 6 procent selhání
		failed := i%100 < 6
		if b.Render(c, failed) {
			tripped = true
			break
		}
	}
	if !tripped {
		t.Fatal("šest procent selhání renderu musí kampaň zastavit")
	}
}

func TestRenderFailureRateStaysBelowThreshold(t *testing.T) {
	b := New(3, 10)
	c := uuid.New()
	for i := 0; i < 1000; i++ {
		failed := i%100 < 4 // 4 procenta
		if b.Render(c, failed) {
			t.Fatalf("při čtyřech procentech se pojistka sepnout nesmí, sepnula na zprávě %d", i)
		}
	}
}

// Práh má dvě podmínky zároveň: podíl přes 5 procent A ZÁROVEŇ aspoň
// 10 selhání. Bez druhé podmínky by kampaň na 20 příjemců zastavilo
// jedno jediné selhání.
func TestRenderFailureNeedsMinimumFailures(t *testing.T) {
	b := New(3, 10)
	c := uuid.New()
	for i := 0; i < 9; i++ {
		if b.Render(c, true) {
			t.Fatalf("devět selhání nesmí stačit, sepnulo na %d", i+1)
		}
	}
	if !b.Render(c, true) {
		t.Fatal("desáté selhání při stoprocentní chybovosti už sepnout musí")
	}
}

// Okno je prvních 1000 zpráv kampaně. Po jeho vyčerpání se už nevyhodnocuje,
// protože pojistka má zastavit rozesílku na začátku, ne uprostřed.
func TestRenderWindowClosesAfterThousandMessages(t *testing.T) {
	b := New(3, 10)
	c := uuid.New()
	for i := 0; i < 1000; i++ {
		b.Render(c, false)
	}
	for i := 0; i < 500; i++ {
		if b.Render(c, true) {
			t.Fatal("po uzavření okna se pojistka renderu spouštět nesmí")
		}
	}
}

// Po pozastavení se stav kampaně zapomene, aby po obnovení začínala načisto.
func TestForgetClearsCampaignState(t *testing.T) {
	b := New(2, 10)
	c := uuid.New()
	b.Fatal(c)
	b.Forget(c)
	if b.Fatal(c) {
		t.Fatal("po Forget má čítač začínat od nuly")
	}
}
