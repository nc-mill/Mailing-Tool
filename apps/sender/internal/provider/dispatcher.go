// Package provider je jediná abstrakce nad odesílacími službami.
package provider

import (
	"context"
	"net/mail"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
)

// MessageKey je identita zprávy, dvousložková kvůli partitioningu.
type MessageKey struct {
	ID        uuid.UUID
	CreatedAt time.Time
}

// ProviderMeta je neprůhledné pole. Sdílená struktura do něj nevidí a nikdy
// nevyjmenovává, co v něm je. Naplní ho konstruktor příslušného dispatcheru
// a rozbalí ho zase jen ten dispatcher.
//
// U SES to jsou message tagy a Configuration Set, u SMTP nic. Kdyby ta pole
// zůstala ve sdílené struktuře, přidání třetího providera by znamenalo sáhnout
// na typ, který používají všichni.
type ProviderMeta interface{ providerMeta() }

// Marker je vložitelný základ pro implementace ProviderMeta.
//
// Neexportovaná metoda rozhraní jde deklarovat jen v tomhle balíčku, takže
// balíček providera si ji vloží skrz Marker. Je to vědomé opt-in: kdo Marker
// nevloží, ProviderMeta nesplní a do pole Meta se nedostane.
type Marker struct{}

func (Marker) providerMeta() {}

// OutgoingMessage je hotová zpráva k odeslání.
type OutgoingMessage struct {
	Key         MessageKey
	WorkspaceID uuid.UUID
	CampaignID  uuid.UUID
	From        mail.Address
	ReplyTo     *mail.Address
	To          string
	ReturnPath  string
	Raw         []byte
	Meta        ProviderMeta
}

// Verdict je rozhodnutí o osudu chyby.
type Verdict struct {
	Class        errcatalog.ErrorClass
	Code         string
	ProviderCode string
	// ProviderDetail je VĚTA od provideru, ne jen jeho kód.
	//
	// Existuje kvůli konkrétní ztrátě: u SES nese `MessageRejected` v kódu jen
	// tolik, že se zpráva odmítla, kdežto ve větě stojí, KTERÁ identita neprošla
	// a ve KTERÉM regionu (například „Email address is not verified. The following
	// identities failed the check in region EU-WEST-1: …"). Bez toho se uživatel
	// dozví, že to nešlo, ale ne proč, a přesně to stálo čtyři dny.
	//
	// Adresy se do něj NEDOSTANOU v otevřené podobě. Plní ho výhradně provider
	// a je jeho povinnost je zamaskovat: pole končí v logu a v `pause_reason`,
	// kam podle kapitoly 4.4 části 4b adresa příjemce nesmí.
	ProviderDetail string
	RetryAfter     *time.Duration
}

// Dispatcher odešle jednu hotovou MIME zprávu.
//
// Výčet implementací není uzavřený a přidání třetí se nesmí dotknout téhle
// struktury ani volajícího.
type Dispatcher interface {
	Dispatch(ctx context.Context, msg *OutgoingMessage) (providerMessageID string, err error)
	Classify(err error) Verdict
	Close() error
	Name() string
}
