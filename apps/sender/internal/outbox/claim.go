package outbox

import (
	"context"

	"github.com/google/uuid"
)

// ActiveCampaigns je krok 1 dvoukrokového claimu.
//
// Krok 1 existuje proto, aby jedna pozastavená kampaň nezastavila ostatní.
// Jednokrokový claim s globálním ORDER BY next_attempt_at má patologii, která
// položí odesílání celé instalace.
func (s *Store) ActiveCampaigns(ctx context.Context) ([]ActiveCampaign, error) {
	rows, err := s.pool.Query(ctx, StmtActiveCampaigns)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ActiveCampaign
	for rows.Next() {
		var c ActiveCampaign
		if err := rows.Scan(&c.ID, &c.Revision); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ClaimBatch je krok 2: claim uvnitř jedné kampaně.
//
// Krátká dávka je normální stav a NENÍ chyba: outbox kampaně dochází, nebo si
// zbytek vzal jiný sender. Volající takovou dávku normálně zpracuje a jde znovu.
// Konec práce na kampani se pozná JEN z nuly vrácených řádků.
func (s *Store) ClaimBatch(ctx context.Context, campaignID uuid.UUID, batchSize, ttlSeconds int) ([]Message, error) {
	rows, err := s.pool.Query(ctx, StmtClaimBatch, s.senderID, batchSize, ttlSeconds, campaignID)
	if err != nil {
		return nil, err
	}
	return scanMessages(rows)
}

// ClaimTestBatch claimuje testovací odeslání napříč kampaněmi a přednostně.
// Volá se na začátku každého tiku, ještě před běžnými dávkami.
func (s *Store) ClaimTestBatch(ctx context.Context, batchSize, ttlSeconds int) ([]Message, error) {
	rows, err := s.pool.Query(ctx, StmtClaimTestBatch, s.senderID, batchSize, ttlSeconds)
	if err != nil {
		return nil, err
	}
	return scanMessages(rows)
}
