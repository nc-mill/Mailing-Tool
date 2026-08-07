package outbox

import "testing"

// Prázdné sending_enabled znamená „nikdo neřekl, že by se nesmělo", ne „vypnuto".
//
// U účtu SMTP je sloupec prázdný VŽDY, protože SMTP server takovou informaci
// nemá a aplikace tam vědomě zapisuje NULL. Kdyby to sender četl jako „vypnuto",
// z instalace, která posílá přes SMTP, by neodešel ani jeden e-mail. Přesně to
// se 7. 8. 2026 naměřilo na čisté instalaci, jen o krok dřív: sken NULL do bool
// shodil čtení celého řádku providera.
func TestNullSendingEnabledMeansSendingIsAllowed(t *testing.T) {
	if !SendingEnabledFromColumn(nil) {
		t.Fatal("prázdná hodnota se musí číst jako zapnuto, stejně jako `?? true` v TypeScriptu")
	}
}

func TestExplicitSendingEnabledIsRespected(t *testing.T) {
	yes, no := true, false
	if !SendingEnabledFromColumn(&yes) {
		t.Error("true se musí přečíst jako zapnuto")
	}
	if SendingEnabledFromColumn(&no) {
		t.Error("false se musí přečíst jako vypnuto; je to jediná hodnota, která odesílání zakazuje")
	}
}
