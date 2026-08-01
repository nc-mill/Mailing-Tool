package outbox

import (
	"context"
	"fmt"
)

// MaxErrorDetail je strop na délku diagnostického textu v error_detail.
const MaxErrorDetail = 1000

// FormatErrorDetail sestaví diagnostický text ve tvaru
// "<kód providera>: <hláška> (attempt <n>, <sender_id>)" a zkrátí ho na 1000 znaků.
// NIKDY neobsahuje e-mailovou adresu ani obsah zprávy.
func FormatErrorDetail(providerCode, message string, attempt int, senderID string) string {
	s := fmt.Sprintf("%s: %s (attempt %d, %s)", providerCode, message, attempt, senderID)
	if len(s) > MaxErrorDetail {
		s = s[:MaxErrorDetail]
	}
	return s
}

// MarkDispatchStarted je krok D1. Commituje se PŘED síťovým voláním.
//
// Vrací false, když už řádek instanci nepatří. V tom případě se volání provideru
// NEPROVEDE, zpráva se z lokální dávky zahodí bez zápisu a do logu jde claim_lost.
// Kontrola návratové hodnoty je povinná, ne doporučená.
func (s *Store) MarkDispatchStarted(ctx context.Context, key MessageKey) (bool, error) {
	tag, err := s.pool.Exec(ctx, StmtMarkDispatchStarted, key.ID, key.CreatedAt, s.senderID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// RecordSent je D3a.
//
// Vrací false, když claim zmizel během odesílání. Zpráva možná odešla, ale sender
// NEZAPISUJE NIC, ani nezkouší zápis znovu, a zaloguje claim_lost_after_dispatch.
// O řádku rozhodne nový vlastník nebo reaper. Bez téhle stráže existuje závod,
// na jehož konci má zpráva provider_message_id od jiné instance.
func (s *Store) RecordSent(ctx context.Context, key MessageKey, providerMessageID string) (bool, error) {
	tag, err := s.pool.Exec(ctx, StmtResultSent, key.ID, key.CreatedAt, s.senderID, providerMessageID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// RecordRetry je D3b: opakovatelná chyba, ještě zbývají pokusy. Pokus se
// spotřebovává, dispatch_started_at se maže, protože o selhání máme důkaz.
func (s *Store) RecordRetry(ctx context.Context, key MessageKey, delaySeconds int, code, detail string) (bool, error) {
	tag, err := s.pool.Exec(ctx, StmtResultRetry, key.ID, key.CreatedAt, s.senderID, delaySeconds, code, detail)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// RecordFailed je D3c: trvalá chyba nebo vyčerpané pokusy. Koncový stav.
func (s *Store) RecordFailed(ctx context.Context, key MessageKey, code, detail string) (bool, error) {
	tag, err := s.pool.Exec(ctx, StmtResultFailed, key.ID, key.CreatedAt, s.senderID, code, detail)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// RecordFatal je D3d: chyba, která zastavuje celou kampaň. Zpráva se vrací do
// fronty a pokus se jí vrací zpět, protože chyba nebyla její vina.
//
// attempts - 1 ruší inkrement z D1 a je bezpečné, protože sender dekrement provádí
// jen tehdy, když jeho vlastní D1 uspěl, a sloupec má CHECK (attempts >= 0).
func (s *Store) RecordFatal(ctx context.Context, key MessageKey, code, detail string) (bool, error) {
	tag, err := s.pool.Exec(ctx, StmtResultFatal, key.ID, key.CreatedAt, s.senderID, code, detail)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// RecordThrottled je D3e. Existuje samostatně, protože throttling není chyba té
// zprávy: pokus se vrací zpět. D3b pokus nevrací a dekrement má jinak jen fatální
// D3d, což by kampaň zastavilo. Ověřuje to AK-7.4.
func (s *Store) RecordThrottled(ctx context.Context, key MessageKey, delaySeconds int, detail string) (bool, error) {
	tag, err := s.pool.Exec(ctx, StmtResultThrottled, key.ID, key.CreatedAt, s.senderID, delaySeconds, detail)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
