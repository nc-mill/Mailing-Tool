package app

import (
	"errors"
	"strings"
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
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

// Transakční zpráva nesmí nést List-Unsubscribe ani Precedence: bulk, a to ani
// tehdy, když je v konfiguraci nastavená mailto adresa pro odhlášení. Ta totiž
// nejde z renderu, takže by se přilepila i k prázdnému odhlašovacímu odkazu.
func TestTransactionalMIMEHasNoUnsubscribeHeaders(t *testing.T) {
	h := testHeader(t, `<html><body>Reset</body></html>`, "Reset")
	msg := testMessage()
	msg.Kind = outbox.KindTransactional
	rendered, err := testRenderer(t).Render(h, msg)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := BuildMIME(h, msg, rendered, MIMEOptions{
		Boundary:       "----=_OE_00000000000000000000",
		PrecedenceBulk: true,
		MailtoUnsub:    "unsubscribe@mail.example.cz",
		ProviderKind:   "smtp",
	})
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	for _, header := range []string{"List-Unsubscribe:", "List-Unsubscribe-Post:", "Precedence: bulk"} {
		if strings.Contains(s, header) {
			t.Errorf("transakční zpráva nese hlavičku %s", header)
		}
	}
	if !strings.Contains(s, "Auto-Submitted: auto-generated") {
		t.Error("chybí Auto-Submitted, na reset hesla by odpověděla automatická odpověď")
	}
	if !strings.Contains(s, "X-Auto-Response-Suppress: All") {
		t.Error("chybí X-Auto-Response-Suppress")
	}
}

// Kampaňová zpráva hlavičky mít MUSÍ. Výjimka se nesmí rozlít.
func TestCampaignMIMEStillCarriesUnsubscribeHeaders(t *testing.T) {
	h := testHeader(t, `<html><body>{{ unsubscribe_url }}</body></html>`, "x")
	msg := testMessage()
	rendered, err := testRenderer(t).Render(h, msg)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := BuildMIME(h, msg, rendered, MIMEOptions{
		Boundary:       "----=_OE_00000000000000000000",
		PrecedenceBulk: true,
		MailtoUnsub:    "unsubscribe@mail.example.cz",
		ProviderKind:   "smtp",
	})
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if !strings.Contains(s, "List-Unsubscribe:") || !strings.Contains(s, "List-Unsubscribe-Post:") {
		t.Error("kampaňová zpráva přišla o odhlašovací hlavičky")
	}
	if strings.Contains(s, "Auto-Submitted:") {
		t.Error("kampaňová zpráva nemá být auto-generated")
	}
}

// CELÝ TOK JEDNÉ TRANSAKČNÍ ZPRÁVY, od render_data po hotové MIME.
//
// Tenhle test je doklad k zadání: odkaz předaný při volání API je v tlačítku
// odeslané zprávy, a odhlašovací odkaz v ní NENÍ ani v těle, ani v hlavičce.
func TestTransactionalMIMECarriesResetLinkAndNoUnsubscribe(t *testing.T) {
	const resetURL = "https://shop.cz/reset?token=eyJhbGciOi&amp;uid=8472"
	html := `<html><body>` +
		`<a href="{{ data.reset_url }}">Nastavit nové heslo</a>` +
		`<p>Odkaz platí {{ data.expires_in_minutes }} minut.</p>` +
		`</body></html>`
	h := testHeader(t, html, "{{ data.reset_url }}")

	msg := testMessage()
	msg.Kind = outbox.KindTransactional
	msg.RenderData = []byte(`{"data":{"reset_url":"https://shop.cz/reset?token=eyJhbGciOi&uid=8472","expires_in_minutes":30}}`)

	rendered, err := testRenderer(t).Render(h, msg)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := BuildMIME(h, msg, rendered, MIMEOptions{
		Boundary:       "----=_OE_00000000000000000000",
		PrecedenceBulk: true,
		MailtoUnsub:    "unsubscribe@mail.example.cz",
		ProviderKind:   "smtp",
	})
	if err != nil {
		t.Fatal(err)
	}
	// Tělo se kontroluje PŘED zakódováním do MIME: quoted-printable rozseká
	// řádky a přepíše "=" na "=3D", takže hledat v něm URL doslova nejde.
	// Hlavičky se kontrolují v hotovém MIME, tam kódované nejsou.
	if !strings.Contains(rendered.HTML, `href="`+resetURL+`"`) {
		t.Errorf("v těle chybí odkaz na reset v atributu href:\n%s", rendered.HTML)
	}
	if !strings.Contains(rendered.HTML, "Odkaz platí 30 minut.") {
		t.Errorf("v těle chybí dosazená doba platnosti:\n%s", rendered.HTML)
	}

	// 2. Odhlašovací odkaz v ní není. Ani v těle, ani v hlavičce.
	if rendered.UnsubscribeURL != "" {
		t.Errorf("render vyrobil odhlašovací odkaz %q", rendered.UnsubscribeURL)
	}
	if strings.Contains(rendered.HTML, "/u/") {
		t.Errorf("v těle je odhlašovací odkaz:\n%s", rendered.HTML)
	}
	s := string(raw)
	for _, forbidden := range []string{"List-Unsubscribe", "unsubscribe@mail.example.cz", "Precedence: bulk"} {
		if strings.Contains(s, forbidden) {
			t.Errorf("transakční zpráva obsahuje %q, což je odhlašovací nebo hromadná plocha", forbidden)
		}
	}

	// 3. Žádné sledování otevření ani prokliků.
	for _, forbidden := range []string{"/t/o/", "/t/c/"} {
		if strings.Contains(rendered.HTML, forbidden) {
			t.Errorf("transakční zpráva obsahuje sledovací adresu %q", forbidden)
		}
	}
}
