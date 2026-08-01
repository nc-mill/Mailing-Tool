package app

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/campaign"
	"github.com/nc-mill/mlain/apps/sender/internal/errcatalog"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
	"github.com/nc-mill/mlain/apps/sender/internal/token"
)

func testHeader(t *testing.T, html, text string) *campaign.Header {
	t.Helper()
	h, err := campaign.PrepareHeader(&campaign.Raw{
		ID:           uuid.MustParse("0192f3a0-1c2d-7e44-9e5f-60718293a4b5"),
		WorkspaceID:  uuid.MustParse("0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071"),
		Subject:      "Ahoj {{ contact.first_name }}",
		Preheader:    "Sleva",
		FromName:     "Jan Novák",
		FromEmail:    "newsletter@mail.example.cz",
		CompiledHTML: html,
		CompiledText: text,
		Revision:     1,
		TrackOpens:   true,
		TrackClicks:  true,
		Timezone:     "Europe/Prague",
	})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func testRenderer(t *testing.T) *Renderer {
	t.Helper()
	kr, err := keyring.Parse("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := token.NewBuilder(kr)
	if err != nil {
		t.Fatal(err)
	}
	return NewRenderer(b, token.URLs{TrackingDomain: "https://track.example.com"}, false)
}

func testMessage() outbox.Message {
	contact := uuid.MustParse("0192f3a0-1c2d-7e43-8d4e-5f60718293a4")
	return outbox.Message{
		Key: outbox.MessageKey{
			ID:        uuid.MustParse("0192f3a0-1c2d-7e41-8b2c-3d4e5f607182"),
			CreatedAt: time.Date(2026, 7, 25, 16, 0, 0, 0, time.UTC),
		},
		WorkspaceID: uuid.MustParse("0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071"),
		CampaignID:  uuid.MustParse("0192f3a0-1c2d-7e44-9e5f-60718293a4b5"),
		ContactID:   &contact,
		Email:       "jana@example.cz",
		RenderData:  []byte(`{"contact":{"first_name":"Jana"}}`),
		Kind:        "campaign",
	}
}

// Značky se nahradí trackovacími odkazy a pixel se vloží.
func TestRenderReplacesMarkersAndPixel(t *testing.T) {
	html := `<html><body>Ahoj {{ contact.first_name }} ` +
		`<a href="https://track.mlain.invalid/c/0192f3a0-1c2d-7e42-9c3d-4e5f60718293">sem</a>` +
		`<!--ML_OPEN_PIXEL--></body></html>`
	out, err := testRenderer(t).Render(testHeader(t, html, "Ahoj {{ contact.first_name }}"), testMessage())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.HTML, "Ahoj Jana") {
		t.Errorf("interpolace neproběhla:\n%s", out.HTML)
	}
	if !strings.Contains(out.HTML, "https://track.example.com/t/c/t1") {
		t.Errorf("odkaz se nenahradil:\n%s", out.HTML)
	}
	if !strings.Contains(out.HTML, `<img src="https://track.example.com/t/o/t1`) {
		t.Errorf("pixel se nevložil:\n%s", out.HTML)
	}
	if out.Subject != "Ahoj Jana" {
		t.Errorf("předmět = %q", out.Subject)
	}
}

// AK-6.22, CT-016: kontakt, jehož pole obsahuje řetězec značky, ho dostane
// v těle DOSLOVA, nikoli jako funkční trackovací odkaz. Zaručuje to pořadí
// operací: v okamžiku interpolace už žádné značky neexistují.
func TestContactDataCannotInjectTrackingLink(t *testing.T) {
	msg := testMessage()
	msg.RenderData = []byte(`{"contact":{"first_name":"https://track.mlain.invalid/c/0192f3a0-1c2d-7e42-9c3d-4e5f60718293"}}`)
	out, err := testRenderer(t).Render(testHeader(t, `<html><body>{{ contact.first_name }}</body></html>`, ""), msg)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.HTML, "track.example.com/t/c/") {
		t.Fatal("z dat kontaktu vznikl funkční trackovací odkaz")
	}
	if !strings.Contains(out.HTML, "track.mlain.invalid") {
		t.Fatal("řetězec se měl do těla dostat doslova")
	}
}

// AK-6.18: odkaz v hlavičce List-Unsubscribe a odkaz dosazený za
// {{ unsubscribe_url }} v těle jsou identický řetězec.
func TestUnsubscribeURLIsIdenticalInBodyAndHeader(t *testing.T) {
	out, err := testRenderer(t).Render(
		testHeader(t, `<html><body>{{ unsubscribe_url }}</body></html>`, "{{ unsubscribe_url }}"),
		testMessage())
	if err != nil {
		t.Fatal(err)
	}
	if out.UnsubscribeURL == "" {
		t.Fatal("odhlašovací odkaz je prázdný")
	}
	if !strings.Contains(out.HTML, out.UnsubscribeURL) {
		t.Fatal("v těle je jiný odkaz než v hlavičce")
	}
	if !strings.Contains(out.Text, out.UnsubscribeURL) {
		t.Fatal("v textové části je jiný odkaz než v hlavičce")
	}
}

// AK-6.8: zpráva bez contact_id a bez příznaku testu se neodešle.
func TestMissingContactIDIsPermanentFailure(t *testing.T) {
	msg := testMessage()
	msg.ContactID = nil
	_, err := testRenderer(t).Render(testHeader(t, `<html><body>x</body></html>`, "x"), msg)
	if err == nil {
		t.Fatal("chybí chyba")
	}
	var re *RenderError
	if !AsRenderError(err, &re) || re.Code != errcatalog.UnsubscribeURLMissing {
		t.Fatalf("chyba = %v, chci unsubscribe_url_missing", err)
	}
}

// U testovacího odeslání bez contact_id se dosadí stránka s vysvětlením
// a hlavička List-Unsubscribe-Post se nepřidává.
func TestTestMessageWithoutContactUsesExplanationPage(t *testing.T) {
	msg := testMessage()
	msg.ContactID = nil
	msg.Kind = "test"
	out, err := testRenderer(t).Render(testHeader(t, `<html><body>x</body></html>`, "x"), msg)
	if err != nil {
		t.Fatal(err)
	}
	if out.UnsubscribeURL != "https://track.example.com/u/test" {
		t.Fatalf("odkaz = %q", out.UnsubscribeURL)
	}
	if out.OneClick {
		t.Fatal("u testovací zprávy se One-Click nepřidává")
	}
}

// AK-19.2: testovací zpráva při vypnutém sledování neobsahuje pixel.
func TestTestMessageWithoutTrackingHasNoPixel(t *testing.T) {
	msg := testMessage()
	msg.Kind = "test"
	out, err := testRenderer(t).Render(
		testHeader(t, `<html><body><!--ML_OPEN_PIXEL--></body></html>`, ""), msg)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.HTML, "/t/o/") {
		t.Fatal("testovací zpráva nesmí obsahovat open pixel")
	}
	if !out.IsTest {
		t.Fatal("chybí příznak testovací zprávy pro hlavičku X-Mlain-Test")
	}
}

// AK-6.20: nenahrazená značka ve výstupu znamená, že se zpráva neodešle.
func TestResidualMarkerIsPermanentFailure(t *testing.T) {
	// Značka v textové části s neplatným UUID projde přípravou jen tehdy,
	// když ji tam vloží interpolace, což je právě ta situace, kterou hlídáme.
	r := testRenderer(t)
	h := testHeader(t, `<html><body>ok</body></html>`, "ok")
	h.TextSource = "https://track.mlain.invalid/c/zbytek {{ contact.first_name | ml_out_text }}"
	_, err := r.Render(h, testMessage())
	if err == nil {
		t.Fatal("chybí chyba")
	}
	var re *RenderError
	if !AsRenderError(err, &re) || re.Code != errcatalog.MarkerNotReplaced {
		t.Fatalf("chyba = %v, chci marker_not_replaced", err)
	}
}

// AK-6.23: řádek prostého textu se značkou není po náhradě zalomený,
// i když výsledná URL přesáhne 78 znaků.
func TestPlainTextLinkLineIsNotWrapped(t *testing.T) {
	text := "Klikněte sem:\nhttps://track.mlain.invalid/c/0192f3a0-1c2d-7e42-9c3d-4e5f60718293\nDěkujeme."
	out, err := testRenderer(t).Render(testHeader(t, `<html><body>x</body></html>`, text), testMessage())
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(out.Text, "\n") {
		if strings.Contains(line, "/t/c/") && strings.Contains(line, " ") {
			t.Fatalf("řádek se značkou se zalomil: %q", line)
		}
	}
}

func TestSubjectTooLongIsPermanentFailure(t *testing.T) {
	h := testHeader(t, `<html><body>x</body></html>`, "x")
	h.SubjectSource = strings.Repeat("á", 900) + "{{ contact.first_name | ml_out_text }}"
	_, err := testRenderer(t).Render(h, testMessage())
	if err == nil {
		t.Fatal("chybí chyba")
	}
	var re *RenderError
	if !AsRenderError(err, &re) || re.Code != errcatalog.SubjectTooLong {
		t.Fatalf("chyba = %v, chci subject_too_long", err)
	}
}
