package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/campaign"
)

// ErrProviderRowUnreadable znamená, že řádek odesílacího účtu nešel z databáze
// PŘEČÍST. Není to chyba dešifrování a nesmí se jako chyba dešifrování hlásit:
// hláška o nedešifrovatelné konfiguraci pošle každého, kdo to vyšetřuje,
// za klíči, zatímco příčina je na straně databáze.
var ErrProviderRowUnreadable = errors.New("provider_config_unreadable")

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
	// SendingEnabled je UŽ NORMALIZOVANÁ hodnota sloupce sending_enabled,
	// tedy odpověď na otázku „smí se s tímhle účtem odesílat".
	// Prázdná hodnota ve sloupci znamená „nevíme" a čte se jako true,
	// viz SendingEnabledFromColumn.
	SendingEnabled bool
}

// SendingEnabledFromColumn převádí sending_enabled z databáze na rozhodnutí,
// jestli se s účtem smí odesílat. Prázdná hodnota znamená ANO.
//
// Sloupec je tříhodnotový schválně: nese to, co o účtu řekl provider.
// U SES je to odpověď GetAccount, u SMTP účtu NEEXISTUJE ZDROJ, protože SMTP
// server nic takového nehlásí, a aplikace tam proto vědomě zapisuje NULL
// (packages/core/src/providers/api/service.ts, refreshQuota: „vracet nulu by
// bylo tvrzení, které neplatí"). Prázdno tedy není „vypnuto", je to „nikdo
// neřekl, že by se nesmělo".
//
// Stejně to čte celá strana v TypeScriptu (`sending_enabled ?? true`
// v providers/status.ts i v campaigns/jobs/provider-refresh-quota.ts).
// Kdyby to sender četl jinak, vzniknou dvě pravdy o jednom sloupci.
//
// PROČ TO NENÍ MIGRACE NA NOT NULL DEFAULT true: tím by se ztratil rozdíl mezi
// „provider potvrdil, že odesílání běží" a „nikdy jsme se neptali", který
// aplikace vědomě drží (mapAccount vrací null, když Amazon hodnotu neposlal),
// a zápis snímku účtu bez téhle hodnoty by nově skončil chybou.
//
// CO SE STANE BEZ TÉHLE FUNKCE: sken NULL do *bool shodí čtení CELÉHO řádku
// providera, sender nedostane konfiguraci a z instalace, která posílá přes
// SMTP, neodejde ani jeden e-mail. Naměřeno 7. 8. 2026 na čisté instalaci.
func SendingEnabledFromColumn(v *bool) bool { return v == nil || *v }

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
	// Poštovní adresa chodí jako NULL, dokud si ji projekt nevyplní. Není to
	// chyba, jen prázdná hodnota merge tagu.
	var postalAddress *string
	var meta []byte

	err := s.pool.QueryRow(ctx, stmt, campaignID).Scan(
		&raw.ID, &raw.WorkspaceID, &raw.Status, &raw.Subject, &raw.Preheader,
		&raw.FromName, &raw.FromEmail, &replyTo,
		&compiledHTML, &compiledText, &raw.Revision,
		&raw.ProviderID, &raw.TrackOpens, &raw.TrackClicks, &raw.UnsubscribeListID,
		&raw.Name, &raw.WorkspaceName, &postalAddress,
		&meta,
	)
	if err != nil {
		return nil, fmt.Errorf("hlavička kampaně %s: %w", campaignID, err)
	}
	if replyTo != nil {
		raw.ReplyTo = *replyTo
	}
	if postalAddress != nil {
		raw.PostalAddress = *postalAddress
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
	// sending_enabled je nullable a u SMTP účtu je prázdné VŽDY. Sken do *bool
	// je proto povinný, ne opatrnost: do bool by NULL shodil celé čtení řádku.
	var sendingEnabled *bool
	err := s.pool.QueryRow(ctx, StmtProviderConfig, providerID).
		Scan(&row.ID, &row.WorkspaceID, &row.ConfigEncrypted, &row.QuotaMaxSendRate,
			&row.Type, &row.Status, &sendingEnabled)
	if err != nil {
		return nil, fmt.Errorf("%w: konfigurace providera %s: %w", ErrProviderRowUnreadable, providerID, err)
	}
	row.SendingEnabled = SendingEnabledFromColumn(sendingEnabled)
	return &row, nil
}
