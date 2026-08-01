package outbox

import "context"

// Heartbeat prodlouží claim zpráv, které instance drží.
//
// Nese OBĚ složky klíče přes dvě rovnoběžná pole rozbalená unnestem. Jednosložková
// varianta by znemožnila prořezání partition a heartbeat by každých pár desítek
// sekund prošel všechny partition tabulky messages.
//
// Bez heartbeatu by dávka u pomalého providera mohla trvat déle než TTL claimu
// a reaper by ji sebral sám sobě.
func (s *Store) Heartbeat(ctx context.Context, msgs []Message, ttlSeconds int) (int64, error) {
	if len(msgs) == 0 {
		return 0, nil
	}
	ids, times := Keys(msgs)
	tag, err := s.pool.Exec(ctx, StmtHeartbeat, s.senderID, ttlSeconds, ids, times)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// RecoveryPass běží jednorázově při startu, před spuštěním claimeru.
//
// Reaper uvolní osiřelé claimy až po TTL. Když ale sender startuje, o své
// předchozí inkarnaci ví jistě, že je mrtvá, takže je uvolní hned. Dotaz B se při
// startu NEPOUŠTÍ: nejednoznačné zprávy vždycky čekají plnou rezervu, aby se
// nezkrátilo okno, ve kterém může dorazit odpověď providera.
//
// Funguje jen tehdy, když je SENDER_ID stabilní přes restart. Výchozí hodnota
// obsahuje PID, takže se při restartu mění a recovery pass nic nenajde. Není to
// nekorektnost, jen zbytečné čekání jednoho TTL.
func (s *Store) RecoveryPass(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, StmtRecoveryPass, s.senderID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ReleaseRemaining vrací při shutdownu zbytek dávky, u které odesílání nezačalo.
// Zprávy s markerem se nechávají doběhnout, protože o nich nemáme důkaz, že
// neodešly.
func (s *Store) ReleaseRemaining(ctx context.Context, msgs []Message) (int64, error) {
	if len(msgs) == 0 {
		return 0, nil
	}
	ids, times := Keys(msgs)
	tag, err := s.pool.Exec(ctx, StmtReleaseRemaining, s.senderID, ids, times)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
