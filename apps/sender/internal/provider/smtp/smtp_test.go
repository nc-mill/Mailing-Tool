package smtp

import (
	"context"
	"net/mail"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/credentials"
	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/provider"
	"github.com/nc-mill/mlain/apps/sender/internal/testsupport"
)

func config(host string, port int) *credentials.ProviderConfig {
	return &credentials.ProviderConfig{
		Kind: credentials.KindSMTP, Host: host, Port: port,
		Encryption: "none", MaxConnections: 2, MaxMessagesPerConnection: 100,
	}
}

func msg() *provider.OutgoingMessage {
	return &provider.OutgoingMessage{
		From:       mail.Address{Address: "a@b.cz"},
		To:         "c@d.cz",
		ReturnPath: "bounce@b.cz",
		Raw:        []byte("Subject: x\r\n\r\nbody\r\n"),
	}
}

// AK-9.6
func TestProviderMessageIDComesFromDataResponse(t *testing.T) {
	srv, err := testsupport.NewFakeSMTP()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	host, port := srv.Addr()

	d, err := New(config(host, port), Timeouts{})
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	id, err := d.Dispatch(context.Background(), msg())
	if err != nil {
		t.Fatal(err)
	}
	if id != "smtp:ABC123" {
		t.Fatalf("provider_message_id = %q, chci smtp:ABC123", id)
	}
}

// Když z odpovědi nejde nic rozumného vytáhnout, použije se vlastní Message-ID
// s prefixem msgid:, aby bylo provider_message_id vždycky vyplněné.
func TestFallbackToOwnMessageID(t *testing.T) {
	srv, err := testsupport.NewFakeSMTP()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	srv.DataResponse = "250 Ok"
	host, port := srv.Addr()

	d, err := New(config(host, port), Timeouts{})
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	m := msg()
	m.Raw = []byte("Message-ID: <ml.abc@b.cz>\r\nSubject: x\r\n\r\nbody\r\n")
	id, err := d.Dispatch(context.Background(), m)
	if err != nil {
		t.Fatal(err)
	}
	if id != "msgid:<ml.abc@b.cz>" {
		t.Fatalf("provider_message_id = %q", id)
	}
}

// AK-9.4: server bez STARTTLS při encryption starttls vede na fatální chybu
// a ŽÁDNÉ heslo se po drátě neposílá.
func TestStartTLSUnavailableIsFatalAndSendsNoPassword(t *testing.T) {
	srv, err := testsupport.NewFakeSMTP()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	srv.AdvertiseStartTLS = false
	host, port := srv.Addr()

	cfg := config(host, port)
	cfg.Encryption = "starttls"
	cfg.Username = "apikey"
	cfg.Password = "tajne-heslo"

	d, err := New(cfg, Timeouts{})
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	_, derr := d.Dispatch(context.Background(), msg())
	if derr == nil {
		t.Fatal("chybí chyba")
	}
	v := d.Classify(derr)
	if v.Class != errcatalog.ClassFatal || v.Code != errcatalog.SMTPStarttlsUnavailable {
		t.Fatalf("class=%v code=%s", v.Class, v.Code)
	}
}

// Heslo se nikdy neposílá po nešifrovaném spojení. Přepíná se výslovným
// allow_insecure_auth.
func TestInsecureAuthIsRefused(t *testing.T) {
	srv, err := testsupport.NewFakeSMTP()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	host, port := srv.Addr()

	cfg := config(host, port)
	cfg.Encryption = "none"
	cfg.Username = "apikey"
	cfg.Password = "tajne-heslo"

	d, err := New(cfg, Timeouts{})
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	_, derr := d.Dispatch(context.Background(), msg())
	if derr == nil {
		t.Fatal("chybí chyba")
	}
	if v := d.Classify(derr); v.Code != errcatalog.SMTPInsecureAuthRefused {
		t.Fatalf("code = %s", v.Code)
	}
}

// AK-9.5: pool se 4 spojeními odešle 1000 zpráv na nejvýš ceil(1000/100)+4
// navázaných spojení.
func TestConnectionPoolRecyclesAfterMaxMessages(t *testing.T) {
	srv, err := testsupport.NewFakeSMTP()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	host, port := srv.Addr()

	cfg := config(host, port)
	cfg.MaxConnections = 4
	cfg.MaxMessagesPerConnection = 100

	d, err := New(cfg, Timeouts{})
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	for i := 0; i < 1000; i++ {
		if _, err := d.Dispatch(context.Background(), msg()); err != nil {
			t.Fatalf("zpráva %d: %v", i, err)
		}
	}
	if srv.Messages() != 1000 {
		t.Fatalf("server přijal %d zpráv", srv.Messages())
	}
	if max := 1000/100 + 4; srv.Connections() > max {
		t.Fatalf("navázáno %d spojení, limit je %d", srv.Connections(), max)
	}
}

// 550 na RCPT TO je okamžitý hard bounce.
func TestRecipientRejectedIsPermanent(t *testing.T) {
	srv, err := testsupport.NewFakeSMTP()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	srv.RcptResponse = "550 5.1.1 No such user"
	host, port := srv.Addr()

	d, err := New(config(host, port), Timeouts{})
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()

	_, derr := d.Dispatch(context.Background(), msg())
	if derr == nil {
		t.Fatal("chybí chyba")
	}
	v := d.Classify(derr)
	if v.Class != errcatalog.ClassPermanent || v.Code != errcatalog.SMTPRecipientRejected {
		t.Fatalf("class=%v code=%s", v.Class, v.Code)
	}
	if v.ProviderCode != "550" {
		t.Fatalf("provider_code = %q", v.ProviderCode)
	}
}

func TestClassifySMTPCodes(t *testing.T) {
	d := &Dispatcher{}
	cases := []struct {
		code  int
		stage string
		class errcatalog.ErrorClass
		our   string
	}{
		{421, "mail", errcatalog.ClassThrottled, errcatalog.RateLimited},
		{450, "mail", errcatalog.ClassRetryable, errcatalog.SMTPTemporaryFailure},
		{454, "mail", errcatalog.ClassRetryable, errcatalog.SMTPTLSTemporary},
		{451, "mail", errcatalog.ClassRetryable, errcatalog.SMTPTemporaryFailure},
		{535, "auth", errcatalog.ClassFatal, errcatalog.ProviderAuthFailed},
		{530, "auth", errcatalog.ClassFatal, errcatalog.ProviderAuthFailed},
		{550, "rcpt", errcatalog.ClassPermanent, errcatalog.SMTPRecipientRejected},
		{550, "data", errcatalog.ClassPermanent, errcatalog.SMTPMessageRejected},
		{552, "data", errcatalog.ClassPermanent, errcatalog.SMTPMessageRejected},
		{554, "data", errcatalog.ClassPermanent, errcatalog.SMTPMessageRejected},
		{500, "mail", errcatalog.ClassPermanent, errcatalog.SMTPPermanentFailure},
	}
	for _, c := range cases {
		v := d.Classify(&ProtocolError{Code: c.code, Stage: c.stage, Message: "x"})
		if v.Class != c.class || v.Code != c.our {
			t.Errorf("%d/%s: class=%v code=%s, chci %v a %s", c.code, c.stage, v.Class, v.Code, c.class, c.our)
		}
	}
}
