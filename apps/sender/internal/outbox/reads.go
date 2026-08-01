package outbox

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/campaign"
)

// ProviderRow je řádek sending_providers tak, jak ho sender potřebuje.
//
// Type, Status a SendingEnabled se čtou proto, aby sender poznal providera,
// kterého aplikace zablokovala nebo vypnula. Bez nich by tlačil zprávy
// do provideru, který je odmítá, dokud se nepřepálí pojistka. Type navíc slouží
// ke křížové kontrole proti kind z dešifrované obálky: rozchod dvou zdrojů
// pravdy je tichá chyba a kampaň se kvůli němu pozastaví.
type ProviderRow struct {
	ID               uuid.UUID
	WorkspaceID      uuid.UUID
	ConfigEncrypted  string
	QuotaMaxSendRate *float64
	Type             string
	Status           string
	SendingEnabled   bool
}

// DetectCompileMeta zjistí při startu, jestli schéma nese sloupec
// campaigns.compile_meta.
//
// Sloupec vlastní plán P13. Když chybí, sender kontrolu počtu značek (V4) vypne
// a zaloguje compile_meta_column_missing na úrovni WARN. Ostatní čtyři kontroly
// běží dál. Tichá varianta, kdy by kontrola prostě neběžela a nikdo by se to
// nedozvěděl, je vyloučená tím logem a testem.
func (s *Store) DetectCompileMeta(ctx context.Context) error {
	var count int
	if err := s.pool.QueryRow(ctx, StmtHasCompileMeta).Scan(&count); err != nil {
		return err
	}
	s.hasCompileMeta = count > 0
	return nil
}

// HasCompileMeta říká, jestli je kontrola V4 proveditelná.
func (s *Store) HasCompileMeta() bool { return s.hasCompileMeta }

// CampaignHeader načte hlavičku kampaně. Volá se jednou na dvojici
// (campaign_id, revision), ne na dávku a už vůbec ne na zprávu.
func (s *Store) CampaignHeader(ctx context.Context, campaignID uuid.UUID) (*campaign.Raw, error) {
	stmt := StmtCampaignHeaderNoMeta
	if s.hasCompileMeta {
		stmt = StmtCampaignHeader
	}
	var raw campaign.Raw
	var replyTo *string
	var compiledHTML, compiledText *string
	var meta []byte

	err := s.pool.QueryRow(ctx, stmt, campaignID).Scan(
		&raw.ID, &raw.WorkspaceID, &raw.Status, &raw.Subject, &raw.Preheader,
		&raw.FromName, &raw.FromEmail, &replyTo,
		&compiledHTML, &compiledText, &raw.Revision,
		&raw.ProviderID, &raw.TrackOpens, &raw.TrackClicks, &raw.UnsubscribeListID,
		&meta,
	)
	if err != nil {
		return nil, fmt.Errorf("hlavička kampaně %s: %w", campaignID, err)
	}
	if replyTo != nil {
		raw.ReplyTo = *replyTo
	}
	if compiledHTML != nil {
		raw.CompiledHTML = *compiledHTML
	}
	if compiledText != nil {
		raw.CompiledText = *compiledText
	}
	if len(meta) > 0 {
		var parsed struct {
			ClickMarkerCount *int `json:"clickMarkerCount"`
		}
		if err := json.Unmarshal(meta, &parsed); err == nil && parsed.ClickMarkerCount != nil {
			raw.ClickMarkerCount = parsed.ClickMarkerCount
		}
	}
	return &raw, nil
}

// ProviderRow načte zašifrovanou konfiguraci providera a závaznou kvótu.
//
// quota_max_send_rate aktualizuje aplikace každých 15 minut a je závazným
// zdrojem rychlosti. Hodnota z dešifrované obálky se použije jen tehdy, když
// je sloupec prázdný. Rozdělení je záměr: kvóta se tak dá měnit bez
// přešifrovávání konfigurace.
func (s *Store) ProviderRow(ctx context.Context, providerID uuid.UUID) (*ProviderRow, error) {
	var row ProviderRow
	err := s.pool.QueryRow(ctx, StmtProviderConfig, providerID).
		Scan(&row.ID, &row.WorkspaceID, &row.ConfigEncrypted, &row.QuotaMaxSendRate,
			&row.Type, &row.Status, &row.SendingEnabled)
	if err != nil {
		return nil, fmt.Errorf("konfigurace providera %s: %w", providerID, err)
	}
	return &row, nil
}
