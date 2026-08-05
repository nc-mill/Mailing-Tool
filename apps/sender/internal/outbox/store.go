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
	// Revision je revize nosné kampaně. Plní ji JEN claim ne-kampaňových zpráv,
	// protože ty v seznamu běžících kampaní nejsou a jinak by se jejich hlavička
	// nacachovala pod revizí 0 a nikdy se neobnovila. U kampaňové zprávy zůstává
	// nula a revizi dodává krok 1 claimu.
	Revision int32
}

// Druhy zprávy podle kontraktu 4.10.1 (MESSAGE_KINDS). Musí sedět s CHECKem
// ck_messages__kind, který rozšířila migrace 0016.
const (
	KindCampaign      = "campaign"
	KindTest          = "test"
	KindTransactional = "transactional"
	KindAutomation    = "automation"
)

// IsTest říká, jestli jde o testovací odeslání. Rozlišovač je kontraktní
// sloupec kind, ne dřívější příznak is_test.
func (m *Message) IsTest() bool { return m.Kind == KindTest }

// IsTransactional říká, jestli jde o transakční zprávu z API zákazníka.
//
// Transakční zpráva je plnění smlouvy, ne marketing: nenese odhlašovací odkaz
// ani hlavičku List-Unsubscribe a nikdy se u ní neměří otevření ani prokliky.
// Odhlásit se z resetu hesla nedává smysl a odkaz s jednorázovým tokenem by
// při měření prokliků spotřeboval bezpečnostní skener v poštovní schránce dřív
// než člověk.
func (m *Message) IsTransactional() bool { return m.Kind == KindTransactional }

// IsCampaign říká, jestli zpráva patří do rozesílky kampaně. Ostatní druhy
// claimuje samostatná smyčka, aby nečekaly, než se rozesílka dotočí.
func (m *Message) IsCampaign() bool { return m.Kind == KindCampaign }

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
	// hasCompileMeta se zjistí jednou při startu, viz DetectCompileMeta.
	hasCompileMeta bool
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

// scanMessagesWithRevision je scanMessages plus revize nosné kampaně
// v posledním sloupci. Vlastní funkce schválně: sloupce claim dotazů jsou
// kontraktní a sdílený scan s proměnným počtem sloupců by tuhle vlastnost zrušil.
func scanMessagesWithRevision(rows pgx.Rows) ([]Message, error) {
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		var campaignID *uuid.UUID
		if err := rows.Scan(&m.Key.ID, &m.Key.CreatedAt, &m.WorkspaceID, &campaignID,
			&m.ContactID, &m.Email, &m.RenderData, &m.Attempts, &m.Kind, &m.Revision); err != nil {
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
