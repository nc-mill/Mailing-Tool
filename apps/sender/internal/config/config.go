// Package config načítá a validuje konfiguraci senderu.
//
// Názvy proměnných, jejich výchozí hodnoty a rozsahy jsou kontraktní a pocházejí
// z části 1, kapitola 4.9. Sender je nesmí přejmenovat ani si zvolit jinou
// výchozí hodnotu: test config-parity porovnává tuhle strukturu se zod schématem
// TypeScriptové strany přes packages/contracts/config.json.
package config

import "time"

// Config je úplná konfigurace procesu. Všechna pole jsou už zvalidovaná.
type Config struct {
	// Kontraktní proměnné z tabulky 4.9
	Mode                  string
	DatabaseURL           string
	SecretKey             string
	SecretKeyPrevious     string
	SenderID              string
	Concurrency           int
	BatchSize             int
	ClaimTTLSeconds       int
	PollIntervalMS        int
	CredentialsMaxRetries int
	AmbiguousPolicySES    string
	AmbiguousPolicySMTP   string
	ShutdownGraceSeconds  int
	TrackingDomain        string
	HealthPort            int
	LogLevel              string
	LogFormat             string
	MetricsEnabled        bool
	MetricsToken          string
	OTLPEndpoint          string

	// Proměnné navržené částí 4b, kapitola 4.1. Všechny mají výchozí hodnotu.
	Replicas                  int
	RateSafety                float64
	MaxAttempts               int
	MaxBackoffSeconds         int
	DispatchTimeoutSeconds    int
	FatalThreshold            int
	SMTPMaxConnections        int
	SMTPMaxMessagesPerConn    int
	SMTPConnectTimeoutSeconds int
	SMTPCommandTimeoutSeconds int
	SMTPDataTimeoutSeconds    int
	PrecedenceBulk            bool
	FeedbackID                bool
	TestTracking              bool
}

// ClaimTTL je doba platnosti claimu.
func (c *Config) ClaimTTL() time.Duration { return time.Duration(c.ClaimTTLSeconds) * time.Second }

// HeartbeatInterval je třetina TTL claimu, takže se heartbeat stihne aspoň třikrát,
// než by claim vypršel. Interval není konfigurovatelný schválně.
func (c *Config) HeartbeatInterval() time.Duration { return c.ClaimTTL() / 3 }

// PollInterval je perioda obnovy seznamu běžících kampaní.
func (c *Config) PollInterval() time.Duration {
	return time.Duration(c.PollIntervalMS) * time.Millisecond
}

// DispatchTimeout je strop na jedno volání provideru.
func (c *Config) DispatchTimeout() time.Duration {
	return time.Duration(c.DispatchTimeoutSeconds) * time.Second
}

// ShutdownGrace je lhůta, do které se má sender po SIGTERM ukončit.
func (c *Config) ShutdownGrace() time.Duration {
	return time.Duration(c.ShutdownGraceSeconds) * time.Second
}

// MaxBackoff je strop na prodlevu mezi pokusy.
func (c *Config) MaxBackoff() time.Duration {
	return time.Duration(c.MaxBackoffSeconds) * time.Second
}

// ReaperInterval je kontraktní hodnota z 4.10.1 a není konfigurovatelná.
const ReaperInterval = 30 * time.Second

// TrackingDomainIsHTTPS říká, jestli se smí přidat hlavička List-Unsubscribe-Post.
// RFC 8058 ji povoluje jen tam, kde List-Unsubscribe nese HTTPS URI.
func (c *Config) TrackingDomainIsHTTPS() bool {
	return len(c.TrackingDomain) >= 8 && c.TrackingDomain[:8] == "https://"
}
