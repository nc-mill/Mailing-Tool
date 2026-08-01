// Package ses odesílá přes Amazon SES v2.
//
// Používá se SendEmail s obsahem typu Raw. Varianta Simple by nechala MIME sestavit
// SES, takže by se výstup lišil od toho, co posíláme přes SMTP, a vznikly by dvě
// různé podoby téhož mailu a dvě sady golden fixtures. To je přesně ta třída chyb,
// kterou chceme vyloučit.
package ses

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	awscreds "github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	credmodel "github.com/nc-mill/mlain/apps/sender/internal/credentials"
	"github.com/nc-mill/mlain/apps/sender/internal/provider"
)

// API je zúžené rozhraní SDK kvůli testovatelnosti.
type API interface {
	SendEmail(ctx context.Context, in *sesv2.SendEmailInput, opts ...func(*sesv2.Options)) (*sesv2.SendEmailOutput, error)
}

// meta nese message tagy. Je to realizace obecného principu "metadata jednoznačně
// nesoucí messages.id", ne zvláštnost jednoho providera.
type meta struct {
	provider.Marker
	tags []types.MessageTag
}

// Dispatcher je implementace pro SES.
type Dispatcher struct {
	api                  API
	configurationSetName string
}

// New sestaví dispatcher z dešifrované konfigurace providera.
//
// Vestavěný retry SDK se VYPÍNÁ. SDK by opakovalo volání uvnitř jednoho Dispatch,
// tedy za našimi zády a bez zápisu do databáze: kdyby první pokus u SES uspěl
// a odpověď se ztratila, SDK by poslalo znovu a vznikla by duplicita, kterou
// bychom vůbec nezaznamenali.
//
// Credentials se NEČTOU z prostředí ani z instance role. Berou se výhradně
// z dešifrované konfigurace providera, protože každý projekt má vlastní účet.
func New(ctx context.Context, cfg *credmodel.ProviderConfig) (*Dispatcher, error) {
	if cfg.ConfigurationSetName == "" {
		// Bez Configuration Setu nechodí události, tedy nefunguje suppression list
		// ani smíření nejistých zpráv, a rozesílat bez toho je cesta k zablokování
		// AWS účtu.
		return nil, fmt.Errorf("provider_event_config_missing")
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(
			awscreds.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		),
		awsconfig.WithRetryMaxAttempts(1),
	)
	if err != nil {
		return nil, err
	}
	return &Dispatcher{api: sesv2.NewFromConfig(awsCfg), configurationSetName: cfg.ConfigurationSetName}, nil
}

// NewWithAPI je konstruktor pro testy.
func NewWithAPI(api API, configurationSetName string) *Dispatcher {
	return &Dispatcher{api: api, configurationSetName: configurationSetName}
}

// Name vrací krátký identifikátor do metrik a logu.
func (d *Dispatcher) Name() string { return "ses" }

// Prepare naplní neprůhledné pole Meta message tagy.
//
// ml_msg a ml_mday jsou záchranná síť pro nejisté zprávy: bez nich by po pádu
// senderu nešlo spárovat událost se zprávou, u které se provider_message_id
// nikdy nezapsalo. ml_msg říká, KTERÁ zpráva to je, ml_mday říká, ve které
// PARTITION leží.
func (d *Dispatcher) Prepare(msg *provider.OutgoingMessage) {
	msg.Meta = meta{tags: []types.MessageTag{
		{Name: aws.String("ml_msg"), Value: aws.String(msg.Key.ID.String())},
		{Name: aws.String("ml_mday"), Value: aws.String(msg.Key.CreatedAt.UTC().Format("20060102"))},
		{Name: aws.String("ml_campaign"), Value: aws.String(msg.CampaignID.String())},
		{Name: aws.String("ml_workspace"), Value: aws.String(msg.WorkspaceID.String())},
	}}
}

// Dispatch odešle zprávu.
func (d *Dispatcher) Dispatch(ctx context.Context, msg *provider.OutgoingMessage) (string, error) {
	m, ok := msg.Meta.(meta)
	if !ok {
		return "", fmt.Errorf("zpráva nemá připravená metadata SES, chybí volání Prepare")
	}
	from := msg.From.Address
	if msg.From.Name != "" {
		from = msg.From.String()
	}
	in := &sesv2.SendEmailInput{
		FromEmailAddress:     aws.String(from),
		Destination:          &types.Destination{ToAddresses: []string{msg.To}},
		Content:              &types.EmailContent{Raw: &types.RawMessage{Data: msg.Raw}},
		ConfigurationSetName: aws.String(d.configurationSetName),
		EmailTags:            m.tags,
		// ListManagementOptions se schválně NENASTAVUJE. SES podepisuje hlavičky
		// dodané odesílatelem, takže naše List-Unsubscribe a List-Unsubscribe-Post
		// se podepíšou; vlastní správa seznamů u SES by je přepsala svými.
	}
	out, err := d.api.SendEmail(ctx, in)
	if err != nil {
		return "", err
	}
	return aws.ToString(out.MessageId), nil
}

// Close u SES nic nedělá, klient nedrží spojení.
func (d *Dispatcher) Close() error { return nil }
