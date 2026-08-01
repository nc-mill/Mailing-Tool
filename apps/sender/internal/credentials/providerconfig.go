package credentials

import (
	"encoding/json"
	"fmt"
)

// Kind rozlišuje typ providera. Rozlišovač je pole "kind", ne "type".
type Kind string

const (
	KindSES  Kind = "ses"
	KindSMTP Kind = "smtp"
)

// DefaultMaxMessageSize je 9 MiB. Je konzervativně pod limitem Amazon SES (10 MB),
// protože quoted-printable objem zvětšuje. Platí, jen když provider vlastní hodnotu
// neuvede: limit velikosti zprávy je vlastnost providera, ne konstanta senderu.
const DefaultMaxMessageSize = 9 * 1024 * 1024

// ProviderConfig je dešifrovaná konfigurace providera.
//
// Struktura má přetížené String a MarshalJSON, aby se heslo ani přístupový klíč
// nemohly dostat do logu omylem. Do souboru ani do metrik se nezapisuje nikdy.
type ProviderConfig struct {
	Kind Kind `json:"kind"`

	// SES
	Region               string `json:"region"`
	AccessKeyID          string `json:"access_key_id"`
	SecretAccessKey      string `json:"secret_access_key"`
	ConfigurationSetName string `json:"configuration_set_name"`

	// SMTP
	Host                     string `json:"host"`
	Port                     int    `json:"port"`
	Username                 string `json:"username"`
	Password                 string `json:"password"`
	Encryption               string `json:"encryption"`
	MaxConnections           int    `json:"max_connections"`
	MaxMessagesPerConnection int    `json:"max_messages_per_connection"`
	InsecureSkipVerify       bool   `json:"insecure_skip_verify"`
	AllowInsecureAuth        bool   `json:"allow_insecure_auth"`
	ReturnPath               string `json:"return_path"`

	// Společné
	MaxSendRate    float64 `json:"max_send_rate"`
	MaxMessageSize int64   `json:"max_message_size"`
}

func (p ProviderConfig) String() string {
	return fmt.Sprintf("ProviderConfig{Kind:%s, [redacted]}", p.Kind)
}

func (p ProviderConfig) MarshalJSON() ([]byte, error) { return []byte(`"[redacted]"`), nil }

// EffectiveMaxMessageSize vrací limit velikosti MIME zprávy pro tohoto providera.
func (p ProviderConfig) EffectiveMaxMessageSize() int64 {
	if p.MaxMessageSize > 0 {
		return p.MaxMessageSize
	}
	return DefaultMaxMessageSize
}

// ParseProviderConfig převede dešifrovaný JSON na strukturu a doplní výchozí hodnoty.
func ParseProviderConfig(plain []byte) (*ProviderConfig, error) {
	// Alias potlačí naše MarshalJSON, aby šlo dekódovat běžně.
	type alias ProviderConfig
	var a alias
	if err := json.Unmarshal(plain, &a); err != nil {
		return nil, fmt.Errorf("konfigurace providera není platný JSON: %w", err)
	}
	p := ProviderConfig(a)
	switch p.Kind {
	case KindSES, KindSMTP:
	default:
		return nil, fmt.Errorf("neznámý kind %q, čekám ses nebo smtp", p.Kind)
	}
	if p.Kind == KindSMTP {
		if p.Encryption == "" {
			p.Encryption = "starttls"
		}
		if p.Port == 0 {
			p.Port = 587
		}
	}
	return &p, nil
}
