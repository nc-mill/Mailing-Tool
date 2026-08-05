package outbox

import "testing"

// Odhlášení z marketingu transakční poštu blokovat NESMÍ, tvrdé důvody ano.
// Tenhle test je Go polovina sdílené sady případů; TypeScript protějšek je
// v packages/core/src/contacts/suppression/__tests__/transactional.test.ts
// a musí dávat stejné odpovědi.
func TestTransactionalBlocksMatchesContract(t *testing.T) {
	cases := map[string]bool{
		"gdpr_erasure":          true,
		"complaint":             true,
		"hard_bounce":           true,
		"ses_suppressed":        true,
		"soft_bounce_threshold": true,
		"invalid":               true,
		"global_unsubscribe":    false,
		"one_click_unsubscribe": false,
		"manual":                false,
		"import":                false,
	}
	for reason, want := range cases {
		if got := transactionalBlocks(reason); got != want {
			t.Errorf("transactionalBlocks(%q) = %t, chci %t", reason, got, want)
		}
	}
	// Neznámý důvod blokuje. Radši neodeslat než odeslat.
	if !transactionalBlocks("neco_noveho") {
		t.Error("neznámý důvod musí blokovat")
	}
}
