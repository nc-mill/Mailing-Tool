package app

import (
	"errors"
	"strings"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/provider"
)

func TestBuildMIMEProducesSendableMessage(t *testing.T) {
	h := testHeader(t, `<html><body>Ahoj {{ contact.first_name }}</body></html>`, "Ahoj {{ contact.first_name }}")
	msg := testMessage()
	rendered, err := testRenderer(t).Render(h, msg)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := BuildMIME(h, msg, rendered, MIMEOptions{
		Boundary:       "----=_OE_00000000000000000000",
		PrecedenceBulk: true,
		FeedbackID:     true,
		ProviderKind:   "smtp",
	})
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if !strings.Contains(s, "From: =?utf-8?B?SmFuIE5vdsOhaw==?= <newsletter@mail.example.cz>") {
		t.Error("chybí správná hlavička From")
	}
	if !strings.Contains(s, "To: <jana@example.cz>") {
		t.Error("chybí hlavička To")
	}
	if !strings.Contains(s, "Precedence: bulk") {
		t.Error("chybí Precedence")
	}
	if !strings.Contains(s, "Feedback-ID: ") {
		t.Error("u SMTP se Feedback-ID přidává")
	}
	if !strings.Contains(s, "Ahoj Jana") {
		t.Error("v těle chybí interpolovaný obsah")
	}
}

// Feedback-ID se u SES nenastavuje, tam ho řídí Configuration Set přes message tagy.
func TestFeedbackIDIsSMTPOnly(t *testing.T) {
	h := testHeader(t, `<html><body>x</body></html>`, "x")
	msg := testMessage()
	rendered, err := testRenderer(t).Render(h, msg)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := BuildMIME(h, msg, rendered, MIMEOptions{
		Boundary: "----=_OE_00000000000000000000", FeedbackID: true, ProviderKind: "ses",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "Feedback-ID:") {
		t.Fatal("u SES se Feedback-ID nenastavuje")
	}
}

// AK-6.25: zpráva větší než max_message_size skončí jako failed bez jediného
// volání providera. Když pole chybí, platí 9 MiB.
func TestMessageTooLargeIsRejectedBeforeDispatch(t *testing.T) {
	if err := CheckMessageSize(make([]byte, 10*1024*1024), 0); err == nil {
		t.Fatal("při chybějícím poli platí 9 MiB a 10 MB má selhat")
	} else {
		var re *RenderError
		if !AsRenderError(err, &re) || re.Code != errcatalog.MessageTooLarge {
			t.Fatalf("chyba = %v, chci message_too_large", err)
		}
	}
	if err := CheckMessageSize(make([]byte, 12*1024*1024), 25*1000*1000); err != nil {
		t.Fatalf("při limitu 25 MB má 12 MB projít, dostal jsem %v", err)
	}
}

// AK-19.2: testovací zpráva nese hlavičku X-Mlain-Test.
func TestTestMessageCarriesTestHeader(t *testing.T) {
	h := testHeader(t, `<html><body>x</body></html>`, "x")
	msg := testMessage()
	msg.Kind = "test"
	rendered, err := testRenderer(t).Render(h, msg)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := BuildMIME(h, msg, rendered, MIMEOptions{Boundary: "----=_OE_00000000000000000000"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "X-Mlain-Test: 1") {
		t.Fatal("chybí hlavička testovacího odeslání")
	}
}

// Rozhodnutí o osudu chyby: fatální chyba NIKDY neoznačí zprávu jako failed.
func TestOutcomeForVerdict(t *testing.T) {
	cases := []struct {
		class    errcatalog.ErrorClass
		attempts int
		max      int
		want     Outcome
	}{
		{errcatalog.ClassThrottled, 1, 5, OutcomeThrottled},
		{errcatalog.ClassFatal, 1, 5, OutcomeFatal},
		{errcatalog.ClassPermanent, 1, 5, OutcomeFailed},
		{errcatalog.ClassRetryable, 1, 5, OutcomeRetry},
		{errcatalog.ClassRetryable, 5, 5, OutcomeFailed},
	}
	for _, c := range cases {
		if got := OutcomeFor(provider.Verdict{Class: c.class}, c.attempts, c.max); got != c.want {
			t.Errorf("class=%v attempts=%d: got %v, chci %v", c.class, c.attempts, got, c.want)
		}
	}
}

func TestSendingDomainComesFromFromAddress(t *testing.T) {
	if got := sendingDomain("newsletter@mail.example.cz"); got != "mail.example.cz" {
		t.Fatalf("got %q", got)
	}
	if got := sendingDomain("bez-zavinace"); got != "localhost" {
		t.Fatalf("got %q, u nesmyslné adresy chci bezpečnou náhradu", got)
	}
}

func TestFeedbackIDFormat(t *testing.T) {
	got := feedbackID(testMessage())
	parts := strings.Split(got, ":")
	if len(parts) != 4 {
		t.Fatalf("Feedback-ID = %q, chci čtyři pole oddělená dvojtečkou", got)
	}
	if parts[2] != "campaign" || parts[3] != "mlain" {
		t.Fatalf("Feedback-ID = %q", got)
	}
}

func TestCheckMessageSizeAcceptsErrorsIs(t *testing.T) {
	err := CheckMessageSize(make([]byte, 10*1024*1024), 0)
	if !errors.As(err, new(*RenderError)) {
		t.Fatal("chyba musí být RenderError, aby ji volající uměl přeložit na kód")
	}
}
