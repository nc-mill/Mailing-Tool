package outbox

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MessageKey je identita zprávy. Primární klíč messages je dvousložkový,
// protože tabulka je partitionovaná podle created_at. Typ nosí obě složky
// pohromadě, aby je nešlo při refaktoru ztratit.
type MessageKey struct {
	ID        uuid.UUID
	CreatedAt time.Time
}

// Message je claimnutá zpráva tak, jak ji vrací claim dotaz.
type Message struct {
	Key         MessageKey
	WorkspaceID uuid.UUID
	CampaignID  uuid.UUID
	// ContactID je prázdné u testovacího odeslání na volnou adresu. Bez něj
	// nejde sestavit odhlašovací token a ostrá zpráva pak odejít nesmí.
	ContactID  *uuid.UUID
	Email      string
	RenderData []byte
	Attempts   int16
	Kind       string
}

// IsTest říká, jestli jde o testovací odeslání. Rozlišovač je kontraktní
// sloupec kind, ne dřívější příznak is_test.
func (m *Message) IsTest() bool { return m.Kind == "test" }

// ActiveCampaign je jedna položka ze seznamu běžících kampaní. Krok 1 claimu
// tahá jen identitu a revizi, protože běží každou sekundu a compiled_html
// může mít stovky kilobajtů. Hlavičku načítá cache podle revize.
type ActiveCampaign struct {
	ID       uuid.UUID
	Revision int32
}

// Store je jediné místo, kudy sender sahá na databázi.
type Store struct {
	pool     *pgxpool.Pool
	senderID string
}

// NewStore vytvoří store nad poolem připojeným rolí mlain_sender.
func NewStore(pool *pgxpool.Pool, senderID string) *Store {
	return &Store{pool: pool, senderID: senderID}
}

// SenderID je hodnota zapisovaná do messages.claimed_by.
func (s *Store) SenderID() string { return s.senderID }

// Pool zpřístupňuje spojení komponentám, které potřebují vlastní dotaz
// (health check).
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

func scanMessages(rows pgx.Rows) ([]Message, error) {
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		var campaignID *uuid.UUID
		if err := rows.Scan(&m.Key.ID, &m.Key.CreatedAt, &m.WorkspaceID, &campaignID,
			&m.ContactID, &m.Email, &m.RenderData, &m.Attempts, &m.Kind); err != nil {
			return nil, err
		}
		if campaignID != nil {
			m.CampaignID = *campaignID
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Keys vrací dvě rovnoběžná pole pro dotazy s unnest.
func Keys(msgs []Message) ([]uuid.UUID, []time.Time) {
	ids := make([]uuid.UUID, len(msgs))
	times := make([]time.Time, len(msgs))
	for i, m := range msgs {
		ids[i] = m.Key.ID
		times[i] = m.Key.CreatedAt
	}
	return ids, times
}
