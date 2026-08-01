package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Registr kódů pause_reason. Sender smí zapsat JEN tyhle čtyři. Zbytek
// (user, bounce_guard, complaint_guard, provider_blocked, materialize_timeout)
// patří aplikaci a sender je nezapisuje nikdy.
//
// Registr je hrubší než katalog chyb senderu a je to záměr: code řídí chování
// a UI, konkrétní příčina jde do detail. Kdyby se každá příčina promítla do code,
// musela by se každá nová chyba providera projednat jako změna zmrazeného kontraktu.
const (
	PauseRenderFailureRate        = "render_failure_rate"
	PauseCredentialsUndecryptable = "credentials_undecryptable"
	PauseProviderQuotaExhausted   = "provider_quota_exhausted"
	PauseProviderUnavailable      = "provider_unavailable"
)

func senderMayWrite(code string) bool {
	switch code {
	case PauseRenderFailureRate, PauseCredentialsUndecryptable,
		PauseProviderQuotaExhausted, PauseProviderUnavailable:
		return true
	}
	return false
}

// PauseReason je závazný tvar objektu zapisovaného do campaigns.pause_reason.
// Existuje jeden tvar, ne dva.
type PauseReason struct {
	Code     string
	Detail   string
	SenderID string
	At       time.Time
}

// MarshalJSON vyrábí přesně kontraktní tvar. source je u senderu vždycky "sender",
// at je ISO 8601 v UTC. Nepovinné klíče se u prázdné hodnoty vynechávají.
func (p PauseReason) MarshalJSON() ([]byte, error) {
	obj := map[string]any{
		"code":   p.Code,
		"source": "sender",
		"at":     p.At.UTC().Format(time.RFC3339),
	}
	if p.Detail != "" {
		obj["detail"] = p.Detail
	}
	if p.SenderID != "" {
		obj["sender_id"] = p.SenderID
	}
	return json.Marshal(obj)
}

// PauseCampaign pozastaví kampaň. Je to jediná zapisovací pravomoc senderu mimo
// tabulku messages a je omezená na dva sloupce sloupcovým grantem.
//
// Vrací false, když UPDATE ovlivnil nula řádků. NENÍ to chyba: znamená to, že
// kampaň už není v odesílacím stavu, protože ji mezitím zrušil uživatel nebo
// doběhla. Volající to zaloguje na úrovni INFO a dál se o kampaň nepokouší.
//
// Sender kampaň NIKDY nerozjede zpět. Zastavení je bezpečná operace, kterou musí
// umět provést ten, kdo problém vidí. Rozjetí vyžaduje, aby si člověk příčinu
// prohlédl, a sender navíc netuší, jestli byla odstraněna.
func (s *Store) PauseCampaign(ctx context.Context, campaignID uuid.UUID, reason PauseReason) (bool, error) {
	if !senderMayWrite(reason.Code) {
		return false, fmt.Errorf("pause_reason.code %q není v registru kódů, které smí zapsat sender", reason.Code)
	}
	if reason.At.IsZero() {
		reason.At = time.Now().UTC()
	}
	body, err := json.Marshal(reason)
	if err != nil {
		return false, err
	}
	tag, err := s.pool.Exec(ctx, StmtPauseCampaign, campaignID, body)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
