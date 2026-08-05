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

// ClaimNonCampaignBatch claimuje zprávy mimo kampaň napříč kampaněmi, tedy
// testovací odeslání, transakční poštu a uzly automatizace.
//
// Má VLASTNÍ smyčku s krátkým intervalem, nezávislou na kampaňovém tiku.
// Dřív se claimovala jednou na začátku kampaňového tiku a ten trvá tak dlouho,
// jak dlouho se odesílají dávky všech běžících kampaní. Reset hesla vložený
// uprostřed rozesílky 10 000 zpráv tak čekal desítky minut.
func (s *Store) ClaimNonCampaignBatch(ctx context.Context, batchSize, ttlSeconds int) ([]Message, error) {
	rows, err := s.pool.Query(ctx, StmtClaimNonCampaignBatch, s.senderID, batchSize, ttlSeconds)
	if err != nil {
		return nil, err
	}
	return scanMessagesWithRevision(rows)
}
