package mimebuild

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func input() Input {
	return Input{
		MessageID:       MessageID(uuid.MustParse("0192f3a0-1c2d-7e41-8b2c-3d4e5f607182"), "mail.example.cz"),
		Date:            time.Date(2026, 7, 31, 9, 14, 2, 0, time.UTC),
		FromName:        "Jan Novák",
		FromEmail:       "newsletter@mail.example.cz",
		To:              "jana@example.cz",
		Subject:         "Letní výprodej začíná",
		Text:            "Dobrý den, Jano,\nmáme pro vás slevu.\n",
		HTML:            "<!DOCTYPE html><html><body>Dobrý den, Jano</body></html>",
		ListUnsubscribe: []string{"https://track.example.com/u/t1abc"},
		OneClick:        true,
		PrecedenceBulk:  true,
		Boundary:        "----=_OE_9f2c8a41d05b7e63a1c4",
	}
}

// AK-6.4
func TestBuildProducesMultipartAlternativeWithTwoParts(t *testing.T) {
	raw, err := Build(input())
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if !strings.Contains(s, `Content-Type: multipart/alternative; boundary="----=_OE_9f2c8a41d05b7e63a1c4"`) {
		t.Error("chybí multipart/alternative s boundary")
	}
	if strings.Count(s, "Content-Type: text/plain; charset=UTF-8") != 1 {
		t.Error("textová část chybí nebo je vícekrát")
	}
	if strings.Count(s, "Content-Type: text/html; charset=UTF-8") != 1 {
		t.Error("HTML část chybí nebo je vícekrát")
	}
	if strings.Count(s, "Content-Transfer-Encoding: quoted-printable") != 2 {
		t.Error("obě části musí být quoted-printable")
	}
	if !strings.HasSuffix(s, "------=_OE_9f2c8a41d05b7e63a1c4--\r\n") {
		t.Error("chybí koncová hranice")
	}
}

// AK-6.5
func TestNoLineExceeds998Octets(t *testing.T) {
	in := input()
	in.HTML = "<html><body>" + strings.Repeat("dlouhý řádek bez zalomení ", 400) + "</body></html>"
	raw, err := Build(in)
	if err != nil {
		t.Fatal(err)
	}
	for i, line := range strings.Split(string(raw), "\r\n") {
		if len(line) > 998 {
			t.Fatalf("řádek %d má %d oktetů", i, len(line))
		}
	}
}

func TestEveryLineEndsWithCRLF(t *testing.T) {
	raw, err := Build(input())
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if strings.Contains(strings.ReplaceAll(s, "\r\n", ""), "\n") {
		t.Fatal("ve zprávě je osamocené LF, konec řádku musí být vždy CRLF")
	}
}

// AK-6.6
func TestListUnsubscribeAndOneClick(t *testing.T) {
	raw, err := Build(input())
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	if !strings.Contains(s, "List-Unsubscribe: <https://track.example.com/u/t1abc>\r\n") {
		t.Error("chybí List-Unsubscribe")
	}
	if strings.Count(s, "List-Unsubscribe-Post: List-Unsubscribe=One-Click") != 1 {
		t.Error("List-Unsubscribe-Post musí být právě jednou")
	}
	if strings.Count(s, "List-Unsubscribe:") != 1 {
		t.Error("List-Unsubscribe musí být právě jednou")
	}
}

func TestHTTPSURIComesFirstWhenMailtoIsConfigured(t *testing.T) {
	in := input()
	in.ListUnsubscribe = []string{"https://track.example.com/u/t1abc", "mailto:unsub@example.cz"}
	raw, err := Build(in)
	if err != nil {
		t.Fatal(err)
	}
	want := "List-Unsubscribe: <https://track.example.com/u/t1abc>, <mailto:unsub@example.cz>\r\n"
	if !strings.Contains(string(raw), want) {
		t.Fatalf("got jinak, chci %q", want)
	}
}

// AK-6.6 druhá polovina: bez HTTPS URI se List-Unsubscribe-Post nepřidává.
func TestNoOneClickWithoutHTTPSURI(t *testing.T) {
	in := input()
	in.ListUnsubscribe = []string{"mailto:unsub@example.cz"}
	in.OneClick = true
	raw, err := Build(in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "List-Unsubscribe-Post") {
		t.Fatal("bez HTTPS URI se One-Click přidat nesmí, RFC 8058 to zakazuje")
	}
}

func TestHeaderOrderIsFixed(t *testing.T) {
	in := input()
	in.ReplyTo = "podpora@example.cz"
	in.FeedbackID = "7f3a2b10:9c1d4e55:campaign:mlain"
	in.TestHeader = true
	raw, err := Build(in)
	if err != nil {
		t.Fatal(err)
	}
	head := strings.SplitN(string(raw), "\r\n\r\n", 2)[0]
	want := []string{
		"Date:", "Message-ID:", "From:", "To:", "Subject:", "MIME-Version:",
		"Content-Type:", "Reply-To:", "List-Unsubscribe:", "List-Unsubscribe-Post:",
		"Feedback-ID:", "Precedence:", "X-Mlain-Test:",
	}
	pos := -1
	for _, h := range want {
		i := strings.Index(head, h)
		if i < 0 {
			t.Fatalf("hlavička %s chybí", h)
		}
		if i < pos {
			t.Fatalf("hlavička %s je mimo pořadí", h)
		}
		pos = i
	}
}

func TestReplyToIsOmittedWhenSameAsFrom(t *testing.T) {
	in := input()
	in.ReplyTo = in.FromEmail
	raw, err := Build(in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "Reply-To:") {
		t.Fatal("Reply-To shodné s From se nepřidává")
	}
}

func TestSenderDoesNotSetForbiddenHeaders(t *testing.T) {
	raw, err := Build(input())
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range []string{"Return-Path:", "DKIM-Signature:", "Auto-Submitted:", "List-Id:", "Bcc:", "Cc:", "Sender:"} {
		if strings.Contains(string(raw), h) {
			t.Errorf("sender nastavil hlavičku %s, kterou nastavovat nemá", h)
		}
	}
}

// OB-11: Message-ID je u dvou pokusů téže zprávy identické a nikdy nezahrnuje
// číslo pokusu ani čas.
func TestMessageIDIsDeterministic(t *testing.T) {
	id := uuid.MustParse("0192f3a0-1c2d-7e41-8b2c-3d4e5f607182")
	a := MessageID(id, "mail.example.cz")
	b := MessageID(id, "mail.example.cz")
	if a != b {
		t.Fatalf("%s != %s", a, b)
	}
	if !strings.HasPrefix(a, "<ml.") || !strings.HasSuffix(a, "@mail.example.cz>") {
		t.Fatalf("tvar Message-ID = %s", a)
	}
	if strings.ContainsAny(a[4:strings.Index(a, "@")], "ABCDEFGHIJKLMNOPQRSTUVWXYZ=") {
		t.Fatal("base32 musí být malými písmeny a bez paddingu")
	}
}

func TestDateIsRFC5322InUTC(t *testing.T) {
	raw, err := Build(input())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "Date: Fri, 31 Jul 2026 09:14:02 +0000\r\n") {
		t.Fatalf("chybí správná hlavička Date:\n%s", strings.SplitN(string(raw), "\r\n\r\n", 2)[0])
	}
}

func TestBoundaryGeneratorIsDeterministicWhenInjected(t *testing.T) {
	b1, err := NewBoundary(func(p []byte) (int, error) {
		for i := range p {
			p[i] = 0xab
		}
		return len(p), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if b1 != "----=_OE_abababababababababab" {
		t.Fatalf("got %q", b1)
	}
}
