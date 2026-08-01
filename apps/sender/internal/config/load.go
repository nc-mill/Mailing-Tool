package config

import (
	"fmt"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
)

// Errors nese všechny nalezené problémy naráz. Kontrakt 4.9 to vyžaduje výslovně:
// při chybě se vypíšou všechny problémy, ne jen první, a proces skončí kódem 78.
// Vypisovat je po jednom znamená, že operátor restartuje kontejner pětkrát za sebou.
type Errors struct{ Items []string }

func (e *Errors) Error() string {
	return "konfigurace je neplatná:\n  - " + strings.Join(e.Items, "\n  - ")
}

func (e *Errors) add(format string, args ...any) {
	e.Items = append(e.Items, fmt.Sprintf(format, args...))
}

func (e *Errors) orNil() error {
	if len(e.Items) == 0 {
		return nil
	}
	sort.Strings(e.Items)
	return e
}

type source struct {
	lookup   func(string) (string, bool)
	readFile func(string) ([]byte, error)
	errs     *Errors
}

// value vrací hodnotu proměnné. Varianta se sufixem _FILE má přednost před přímou
// hodnotou. Je to kontraktní chování z 4.9 kvůli Docker secrets a Kubernetes.
func (s *source) value(name string) (string, bool) {
	if path, ok := s.lookup(name + "_FILE"); ok && strings.TrimSpace(path) != "" {
		b, err := s.readFile(strings.TrimSpace(path))
		if err != nil {
			s.errs.add("%s_FILE: soubor %q nejde přečíst: %v", name, strings.TrimSpace(path), err)
			return "", false
		}
		return strings.TrimSpace(string(b)), true
	}
	v, ok := s.lookup(name)
	if !ok {
		return "", false
	}
	return strings.TrimSpace(v), true
}

func (s *source) str(name, def string) string {
	if v, ok := s.value(name); ok && v != "" {
		return v
	}
	return def
}

func (s *source) required(name string) string {
	if v, ok := s.value(name); ok && v != "" {
		return v
	}
	s.errs.add("%s: povinná proměnná chybí", name)
	return ""
}

func (s *source) intRange(name string, def, min, max int) int {
	v, ok := s.value(name)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		s.errs.add("%s: %q není celé číslo", name, v)
		return def
	}
	if n < min || n > max {
		s.errs.add("%s: %d je mimo povolený rozsah %d až %d", name, n, min, max)
		return def
	}
	return n
}

func (s *source) floatRange(name string, def, min, max float64) float64 {
	v, ok := s.value(name)
	if !ok || v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		s.errs.add("%s: %q není desetinné číslo", name, v)
		return def
	}
	if f < min || f > max {
		s.errs.add("%s: %v je mimo povolený rozsah %v až %v", name, f, min, max)
		return def
	}
	return f
}

func (s *source) boolean(name string, def bool) bool {
	v, ok := s.value(name)
	if !ok || v == "" {
		return def
	}
	switch strings.ToLower(v) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		s.errs.add("%s: %q není pravdivostní hodnota, čekám true nebo false", name, v)
		return def
	}
}

func (s *source) enum(name, def string, allowed ...string) string {
	v, ok := s.value(name)
	if !ok || v == "" {
		return def
	}
	for _, a := range allowed {
		if v == a {
			return v
		}
	}
	s.errs.add("%s: %q není povolená hodnota, čekám jednu z %s", name, v, strings.Join(allowed, ", "))
	return def
}

// LoadFromOS je zkratka pro produkční běh.
func LoadFromOS() (*Config, error) { return Load(os.LookupEnv, os.ReadFile) }

// Load načte a zvaliduje konfiguraci. Vrací vždy neprázdný *Config (s výchozími
// hodnotami tam, kde vstup neprošel), takže volající může chybu vypsat a skončit,
// aniž by musel hlídat nil.
func Load(lookup func(string) (string, bool), readFile func(string) ([]byte, error)) (*Config, error) {
	errs := &Errors{}
	s := &source{lookup: lookup, readFile: readFile, errs: errs}
	c := &Config{}

	c.Mode = s.enum("MODE", "all", "web", "worker", "sender", "all")
	c.SecretKey = s.required("SECRET_KEY")
	c.SecretKeyPrevious = s.str("SECRET_KEY_PREVIOUS", "")

	c.DatabaseURL = s.str("DATABASE_URL_SENDER", "")
	if c.DatabaseURL == "" {
		if base := s.str("DATABASE_URL", ""); base != "" {
			derived, err := deriveSenderURL(base)
			if err != nil {
				errs.add("DATABASE_URL: %v", err)
			} else {
				c.DatabaseURL = derived
			}
		}
	}
	if c.DatabaseURL == "" {
		errs.add("DATABASE_URL_SENDER: chybí a nejde odvodit z DATABASE_URL. " +
			"Sender se připojuje výhradně rolí mlain_sender, tichý pád zpět na aplikační roli " +
			"by zrušil bezpečnostní hranici, aniž by si toho kdokoliv všiml")
	}

	c.SenderID = s.str("SENDER_ID", defaultSenderID())
	c.Concurrency = s.intRange("SENDER_CONCURRENCY", 32, 1, 1024)
	c.BatchSize = s.intRange("SENDER_BATCH_SIZE", 100, 1, 5000)
	c.ClaimTTLSeconds = s.intRange("SENDER_CLAIM_TTL_SECONDS", 300, 30, 3600)
	c.PollIntervalMS = s.intRange("SENDER_POLL_INTERVAL_MS", 1000, 100, 60000)
	c.CredentialsMaxRetries = s.intRange("SENDER_CREDENTIALS_MAX_RETRIES", 10, 1, 100)
	c.AmbiguousPolicySES = s.enum("AMBIGUOUS_DISPATCH_POLICY_SES", "fail", "retry", "fail")
	c.AmbiguousPolicySMTP = s.enum("AMBIGUOUS_DISPATCH_POLICY_SMTP", "retry", "retry", "fail")
	c.ShutdownGraceSeconds = s.intRange("SHUTDOWN_GRACE_SECONDS", 25, 1, 300)
	c.HealthPort = s.intRange("SENDER_HEALTH_PORT", 3002, 1, 65535)
	c.LogLevel = s.enum("LOG_LEVEL", "info", "trace", "debug", "info", "warn", "error", "fatal")
	c.LogFormat = s.enum("LOG_FORMAT", "json", "json", "pretty")
	c.MetricsEnabled = s.boolean("METRICS_ENABLED", false)
	c.MetricsToken = s.str("METRICS_TOKEN", "")
	c.OTLPEndpoint = s.str("OTEL_EXPORTER_OTLP_ENDPOINT", "")

	c.TrackingDomain = strings.TrimRight(s.str("TRACKING_DOMAIN", ""), "/")
	if c.TrackingDomain == "" {
		errs.add("TRACKING_DOMAIN: chybí. Sender z ní staví odkazy /t/o/, /t/c/ a /u/. " +
			"Výchozí hodnota se podle 4.9 odvozuje z APP_URL, ale tu sender nedostává (nález K7), " +
			"takže je pro MODE=sender povinná")
	} else if u, err := url.Parse(c.TrackingDomain); err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		errs.add("TRACKING_DOMAIN: %q není absolutní URL se schématem http nebo https", c.TrackingDomain)
	}

	c.Replicas = s.intRange("SENDER_REPLICAS", 1, 1, 100)
	c.RateSafety = s.floatRange("SENDER_RATE_SAFETY", 0.9, 0.1, 1.0)
	c.MaxAttempts = s.intRange("SENDER_MAX_ATTEMPTS", 5, 1, 20)
	c.MaxBackoffSeconds = s.intRange("SENDER_MAX_BACKOFF_SECONDS", 3600, 1, 86400)
	c.DispatchTimeoutSeconds = s.intRange("SENDER_DISPATCH_TIMEOUT_SECONDS", 10, 1, 300)
	c.FatalThreshold = s.intRange("SENDER_FATAL_THRESHOLD", 3, 1, 100)
	c.SMTPMaxConnections = s.intRange("SENDER_SMTP_MAX_CONNECTIONS", 4, 1, 32)
	c.SMTPMaxMessagesPerConn = s.intRange("SENDER_SMTP_MAX_MESSAGES_PER_CONN", 100, 1, 10000)
	c.SMTPConnectTimeoutSeconds = s.intRange("SENDER_SMTP_CONNECT_TIMEOUT_SECONDS", 10, 1, 300)
	c.SMTPCommandTimeoutSeconds = s.intRange("SENDER_SMTP_COMMAND_TIMEOUT_SECONDS", 30, 1, 600)
	c.SMTPDataTimeoutSeconds = s.intRange("SENDER_SMTP_DATA_TIMEOUT_SECONDS", 120, 1, 1800)
	c.PrecedenceBulk = s.boolean("SENDER_PRECEDENCE_BULK", true)
	c.FeedbackID = s.boolean("SENDER_FEEDBACK_ID", true)
	c.TestTracking = s.boolean("SENDER_TEST_TRACKING", false)

	Validate(c, errs)
	return c, errs.orNil()
}

// deriveSenderURL zamění uživatele v připojovacím řetězci za mlain_sender.
// Kontrakt 4.9 tohle odvození předepisuje pro MODE=all. Heslo zůstává, takže
// role mlain_sender musí mít v takovém nasazení stejné heslo jako aplikační role,
// nebo se DATABASE_URL_SENDER nastaví ručně. Když heslo nesedí, připojení selže
// při startu s jasnou chybou, což je lepší než tiché spadnutí zpět.
func deriveSenderURL(base string) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("není platná URL: %w", err)
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return "", fmt.Errorf("čekám schéma postgres, dostal jsem %q", u.Scheme)
	}
	if pass, ok := u.User.Password(); ok {
		u.User = url.UserPassword("mlain_sender", pass)
	} else {
		u.User = url.User("mlain_sender")
	}
	return u.String(), nil
}

// defaultSenderID je hostname a PID podle kontraktu 4.9.
//
// POZOR na provozní důsledek, který je zapsaný jako nález K14: PID se při restartu
// mění, takže recovery pass při startu (3.3) nenajde vlastní osiřelé claimy a kampaň
// se na dobu jednoho TTL zadrhne. Není to nekorektnost, jen zbytečné čekání.
// Kdo chce rychlý restart, nastaví SENDER_ID ručně na stabilní hodnotu.
func defaultSenderID() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "sender"
	}
	id := fmt.Sprintf("%s-%d", host, os.Getpid())
	if len(id) > 64 {
		id = id[:64]
	}
	return id
}
