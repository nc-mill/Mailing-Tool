package ses

import (
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	"github.com/aws/smithy-go"
)

func apiChyba(code, message string) error {
	return &smithy.GenericAPIError{Code: code, Message: message}
}

// Věta od Amazonu je u MessageRejected jediné místo, kde stojí, co se má opravit.
// Bez ní se uživatel dozví, že to nešlo, ale ne proč.
func TestProviderDetailNeseVetuOdProvidera(t *testing.T) {
	err := apiChyba("MessageRejected",
		"Email address is not verified. The following identities failed the check in region EU-WEST-1: ahoj@brevio.cz")

	got := providerDetail(err)

	if !strings.Contains(got, "EU-WEST-1") {
		t.Errorf("detail zahodil region: %q", got)
	}
	if !strings.Contains(got, "not verified") {
		t.Errorf("detail zahodil důvod: %q", got)
	}
}

// ADRESA SE DO LOGU NESMÍ. Kapitola 4.4 části 4b to zakazuje a věta od Amazonu
// adresu běžně obsahuje. Maskuje se místní část, doména zůstává: podle ní se
// pozná, jestli neprošla odesílací identita, nebo adresa příjemce.
func TestProviderDetailMaskujeAdresy(t *testing.T) {
	err := apiChyba("MessageRejected",
		"identities failed the check in region EU-WEST-1: ahoj@brevio.cz, petr.novak@gmail.com")

	got := providerDetail(err)

	for _, zakazane := range []string{"ahoj@brevio.cz", "petr.novak@gmail.com", "petr.novak"} {
		if strings.Contains(got, zakazane) {
			t.Errorf("detail nese otevřenou adresu %q: %q", zakazane, got)
		}
	}
	for _, chtene := range []string{"***@brevio.cz", "***@gmail.com"} {
		if !strings.Contains(got, chtene) {
			t.Errorf("detail ztratil doménu %q: %q", chtene, got)
		}
	}
}

func TestProviderDetailZkracujeDlouhouOdpoved(t *testing.T) {
	got := providerDetail(apiChyba("MessageRejected", strings.Repeat("a", 5000)))
	if len(got) > providerDetailMaxLen+len("…") {
		t.Fatalf("detail má %d znaků, strop je %d", len(got), providerDetailMaxLen)
	}
}

// Chyba, která není odpovědí API (typicky síťová), větu nemá a nesmí si ji
// vymyslet.
func TestProviderDetailJePrazdnyUNeApiChyby(t *testing.T) {
	if got := providerDetail(errors.New("connection reset")); got != "" {
		t.Fatalf("detail = %q, chci prázdný řetězec", got)
	}
}

// Verdikt musí větu nést, jinak se k logu ani k pauze nikdy nedostane.
func TestClassifyNeseProviderDetail(t *testing.T) {
	d := NewWithAPI(nil, "mlain-test")
	v := d.Classify(&types.MessageRejected{Message: strPtr("Email address is not verified: ahoj@brevio.cz")})

	if v.ProviderDetail == "" {
		t.Fatal("verdikt nenese větu od provideru")
	}
	if strings.Contains(v.ProviderDetail, "ahoj@brevio.cz") {
		t.Fatalf("verdikt nese otevřenou adresu: %q", v.ProviderDetail)
	}
}

func strPtr(s string) *string { return &s }
