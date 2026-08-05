package outbox

import (
	"context"
	"encoding/hex"
	"strings"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
)

// FilterSuppressed vyloučí z dávky zprávy, jejichž příjemce je na suppression listu.
//
// Kontrola je DÁVKOVÁ, jeden dotaz na celou dávku, ne jeden na zprávu: po zprávách
// by to přidalo round trip do horké cesty a propustnost by spadla na polovinu.
//
// Obě větve disjunkce platí ZÁROVEŇ, ne jedna nebo druhá. Po výmazu podle GDPR
// e-mail z řádku zmizí a zůstane jen otisk, takže větev přes adresu by ho nenašla.
//
// Otisky se počítají pro VŠECHNA známá pokolení klíče, bez horního omezení. Otisk
// smazané adresy nejde nikdy přepočítat, protože plaintext je pryč, takže by strop
// znamenal, že se smazaný člověk vrátí prvním dalším importem, aniž by cokoliv selhalo.
//
// Vyloučené zprávy se překlopí na skipped s error_code = 'suppressed' a z dávky
// vypadnou ještě před krokem D0, tedy dřív, než se čerpá povolenka throttleru.
//
// DŮVOD BLOKACE ROZHODUJE, a to jen u transakčního druhu. Odhlášení z marketingu
// není odvolání souhlasu se zpracováním, takže reset hesla přes něj projít musí,
// kdežto tvrdý odraz, stížnost a výmaz podle GDPR ho zastaví. Pro kampaň
// a testovací odeslání platí beze změny, že blokuje každý důvod.
func (s *Store) FilterSuppressed(ctx context.Context, kr *keyring.Keyring, workspaceID uuid.UUID, msgs []Message) (kept, skipped []Message, err error) {
	if len(msgs) == 0 {
		return nil, nil, nil
	}

	emails := make([]string, 0, len(msgs))
	prints := make([][]byte, 0, len(msgs)*len(kr.All()))
	byEmail := make(map[string][]int, len(msgs))
	printOwner := make(map[string]int, len(msgs)*len(kr.All()))

	for i, m := range msgs {
		lower := strings.ToLower(strings.TrimSpace(m.Email))
		emails = append(emails, lower)
		byEmail[lower] = append(byEmail[lower], i)
		fps, ferr := kr.SuppressionFingerprints(m.Email)
		if ferr != nil {
			return nil, nil, ferr
		}
		for _, fp := range fps {
			prints = append(prints, fp)
			printOwner[hex.EncodeToString(fp)] = i
		}
	}

	rows, qerr := s.pool.Query(ctx, StmtSuppressionBatch, workspaceID, emails, prints)
	if qerr != nil {
		return nil, nil, qerr
	}
	blocked := make(map[int]bool, 8)
	// mark zablokuje zprávu jen tehdy, když ji tenhle důvod blokovat má.
	// Jedna zpráva může sedět na víc řádcích suppression (adresa i otisk),
	// takže se příznak jen nastavuje, nikdy neruší.
	mark := func(idx int, reason string) {
		if idx < 0 || idx >= len(msgs) {
			return
		}
		if msgs[idx].IsTransactional() && !transactionalBlocks(reason) {
			return
		}
		blocked[idx] = true
	}
	for rows.Next() {
		// email je citext NOT NULL, takže se skenuje do string, ne do ukazatele.
		// U řádku po výmazu podle GDPR je v něm zástupná hodnota, která se
		// s žádným příjemcem neshoduje, a blokaci proto nese větev přes otisk.
		var email string
		var fingerprint []byte
		var reason string
		if serr := rows.Scan(&email, &fingerprint, &reason); serr != nil {
			rows.Close()
			return nil, nil, serr
		}
		for _, idx := range byEmail[strings.ToLower(strings.TrimSpace(email))] {
			mark(idx, reason)
		}
		if idx, ok := printOwner[hex.EncodeToString(fingerprint)]; ok {
			mark(idx, reason)
		}
	}
	rows.Close()
	if rerr := rows.Err(); rerr != nil {
		return nil, nil, rerr
	}

	for i, m := range msgs {
		if blocked[i] {
			skipped = append(skipped, m)
		} else {
			kept = append(kept, m)
		}
	}
	if len(skipped) > 0 {
		ids, times := Keys(skipped)
		if _, eerr := s.pool.Exec(ctx, StmtSkipSuppressed, s.senderID, ids, times); eerr != nil {
			return nil, nil, eerr
		}
	}
	return kept, skipped, nil
}

// transactionalBlocks je Go protějšek funkce transactionalVerdict z
// packages/core/src/contacts/suppression/transactional.ts. Obě strany musí
// dávat stejné odpovědi: kdyby se rozešly, sender propustí, co endpoint
// zablokoval, nebo naopak, a projeví se to tím, že člověku nedojde reset hesla.
//
// Seznam je VÝČET, ne "všechno kromě". Neznámý důvod blokuje: nová hodnota
// v ck_suppressions__reason bez zatřídění sem je chyba, ale bezpečnější je
// zprávu neposlat než ji poslat.
func transactionalBlocks(reason string) bool {
	switch reason {
	case "gdpr_erasure", "complaint", "hard_bounce", "ses_suppressed",
		"soft_bounce_threshold", "invalid":
		return true
	case "global_unsubscribe", "one_click_unsubscribe":
		// Odhlášení z marketingu. Transakční poštu neblokuje.
		return false
	case "manual", "import":
		// Ruční blokace a řádek z importu: záměr nejde poznat, bývá marketingový.
		// Propouští se, rozhodnutí zadavatele z 5. 8. 2026.
		return false
	default:
		return true
	}
}
