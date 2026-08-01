package outbox

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// AmbiguousOutcome je jeden řádek, o kterém rozhodl reaper B.
type AmbiguousOutcome struct {
	Key            MessageKey
	AmbiguousCount int16
}

// ReapReleased je reaper A: prokazatelně neodeslané zprávy zpět do fronty.
//
// Uvolní se JEN zprávy s dispatch_started_at IS NULL, tedy ty, u kterých databáze
// dokazuje, že síťové volání ani nezačalo. Marker se commituje před voláním
// provideru, takže "marker chybí" implikuje "volání neproběhlo".
func (s *Store) ReapReleased(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, StmtReaperReleased)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ReapAmbiguous je reaper B: rozhodne o zprávách, u kterých nevíme, jestli odešly.
//
// policy je "retry" nebo "fail" a bere se z prostředí podle typu providera kampaně,
// ne z konfigurace kampaně. U SES je výchozí fail, protože SES přepisuje Message-ID
// a pojistka proti duplicitě tam neexistuje. U SMTP je výchozí retry.
//
// reserveSeconds je JEDEN TTL claimu navíc, ne dvojnásobek: claim_expires_at už
// jeden TTL obsahuje, takže se zpráva uvolní po dvojnásobku TTL od claimu.
func (s *Store) ReapAmbiguous(ctx context.Context, policy string, reserveSeconds int) (int, error) {
	rows, err := s.pool.Query(ctx, StmtReaperAmbiguous, policy, reserveSeconds)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var id uuid.UUID
		var createdAt time.Time
		var ambiguous int16
		if err := rows.Scan(&id, &createdAt, &ambiguous); err != nil {
			return count, err
		}
		count++
	}
	return count, rows.Err()
}

// ReapAmbiguousDetailed je totéž, ale vrací i jednotlivé řádky. Používá ho
// metrika sender_ambiguous_dispatch_total{outcome}, protože potřebuje rozlišit,
// jestli zpráva skončila na pending, nebo na failed.
func (s *Store) ReapAmbiguousDetailed(ctx context.Context, policy string, reserveSeconds int) ([]AmbiguousOutcome, error) {
	rows, err := s.pool.Query(ctx, StmtReaperAmbiguous, policy, reserveSeconds)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AmbiguousOutcome
	for rows.Next() {
		var o AmbiguousOutcome
		if err := rows.Scan(&o.Key.ID, &o.Key.CreatedAt, &o.AmbiguousCount); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
