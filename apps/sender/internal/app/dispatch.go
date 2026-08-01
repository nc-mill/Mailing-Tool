package app

import (
	"fmt"
	"strings"
	"time"

	"github.com/nc-mill/mlain/apps/sender/internal/campaign"
	"github.com/nc-mill/mlain/apps/sender/internal/credentials"
	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/mimebuild"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/provider"
)

// MIMEOptions jsou volby sestavení jedné zprávy.
type MIMEOptions struct {
	Boundary       string
	PrecedenceBulk bool
	FeedbackID     bool
	ProviderKind   string
	MailtoUnsub    string
	Now            func() time.Time
}

// BuildMIME sestaví hotovou zprávu.
func BuildMIME(h *campaign.Header, msg outbox.Message, r *Rendered, opts MIMEOptions) ([]byte, error) {
	now := time.Now
	if opts.Now != nil {
		now = opts.Now
	}
	unsub := []string{}
	if r.UnsubscribeURL != "" {
		unsub = append(unsub, r.UnsubscribeURL)
	}
	if opts.MailtoUnsub != "" {
		unsub = append(unsub, "mailto:"+opts.MailtoUnsub)
	}

	in := mimebuild.Input{
		MessageID: mimebuild.MessageID(msg.Key.ID, sendingDomain(h.Raw.FromEmail)),
		// Date se generuje v okamžiku sestavení, ne claimu. SES ji stejně přepíše
		// vlastní hodnotou, u SMTP zůstává naše.
		Date:            now().UTC(),
		FromName:        h.Raw.FromName,
		FromEmail:       h.Raw.FromEmail,
		To:              msg.Email,
		ReplyTo:         h.Raw.ReplyTo,
		Subject:         r.Subject,
		Text:            r.Text,
		HTML:            r.HTML,
		ListUnsubscribe: unsub,
		OneClick:        r.OneClick,
		PrecedenceBulk:  opts.PrecedenceBulk,
		TestHeader:      r.IsTest,
		Boundary:        opts.Boundary,
	}
	// Feedback-ID nastavujeme jen u SMTP. U SES ji řídí Configuration Set přes
	// message tagy a duplicitní hlavička by si s ním konkurovala.
	if opts.FeedbackID && opts.ProviderKind != "ses" {
		in.FeedbackID = feedbackID(msg)
	}
	return mimebuild.Build(in)
}

func sendingDomain(fromEmail string) string {
	if i := strings.LastIndex(fromEmail, "@"); i >= 0 && i+1 < len(fromEmail) {
		return fromEmail[i+1:]
	}
	return "localhost"
}

// feedbackID je formát podle Google Postmaster Tools: nejvýš čtyři pole oddělená
// dvojtečkou, poslední pole je identifikátor odesílatele.
func feedbackID(msg outbox.Message) string {
	short := func(s string) string {
		s = strings.ReplaceAll(s, "-", "")
		if len(s) > 8 {
			return s[:8]
		}
		return s
	}
	return short(msg.CampaignID.String()) + ":" + short(msg.WorkspaceID.String()) + ":campaign:mlain"
}

// CheckMessageSize ověří velikost hotové zprávy proti limitu providera.
//
// Sender hodnotu jen čte, nikdy ji nezjišťuje sám, a při překročení nedělá
// žádný pokus o odeslání, protože je to trvalá vlastnost té zprávy.
func CheckMessageSize(raw []byte, limit int64) error {
	if limit <= 0 {
		limit = credentials.DefaultMaxMessageSize
	}
	if int64(len(raw)) > limit {
		return &RenderError{
			Code:    errcatalog.MessageTooLarge,
			Message: fmt.Sprintf("zpráva má %d bajtů, limit providera je %d", len(raw), limit),
		}
	}
	return nil
}

// Outcome je rozhodnutí o osudu zprávy po pokusu o odeslání.
type Outcome int

const (
	OutcomeSent Outcome = iota
	OutcomeRetry
	OutcomeFailed
	OutcomeFatal
	OutcomeThrottled
)

func (o Outcome) String() string {
	switch o {
	case OutcomeSent:
		return "sent"
	case OutcomeRetry:
		return "retried"
	case OutcomeFailed:
		return "failed"
	case OutcomeFatal:
		return "fatal"
	case OutcomeThrottled:
		return "throttled"
	default:
		return "unknown"
	}
}

// OutcomeFor převádí verdikt klasifikátoru na variantu zápisu D3.
//
// Fatální chyba vede VŽDY na D3d, tedy zpět na pending bez započtení pokusu.
// Žádná chyba třídy Fatal nesmí zprávu označit jako failed: zastavuje kampaň,
// ne jednotlivé zprávy.
func OutcomeFor(v provider.Verdict, attempts, maxAttempts int) Outcome {
	switch v.Class {
	case errcatalog.ClassThrottled:
		return OutcomeThrottled
	case errcatalog.ClassFatal:
		return OutcomeFatal
	case errcatalog.ClassPermanent:
		return OutcomeFailed
	default:
		if attempts >= maxAttempts {
			return OutcomeFailed
		}
		return OutcomeRetry
	}
}
