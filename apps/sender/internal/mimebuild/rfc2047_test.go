package mimebuild

import (
	"encoding/base64"
	"strings"
	"testing"
	"unicode/utf8"
)

// AK-6.2 a testovací vektory z části 4b, kapitola 3.8.3.
func TestEncodeHeaderValueVectors(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Letní výprodej", "=?utf-8?B?TGV0bsOtIHbDvXByb2Rlag==?="},
		{"Newsletter", "Newsletter"},
		{"Jan Novák", "=?utf-8?B?SmFuIE5vdsOhaw==?="},
	}
	for _, c := range cases {
		if got := EncodeHeaderValue(c.in); got != c.want {
			t.Errorf("%q\n got %s\nchci %s", c.in, got, c.want)
		}
	}
}

// AK-6.3: dlouhý předmět se rozdělí na víc encoded-words, žádný nepřesáhne
// 75 znaků a žádný nerozdělí vícebajtový znak uprostřed.
func TestLongSubjectSplitsSafely(t *testing.T) {
	in := strings.Repeat("příliš žluťoučký kůň ", 20)
	got := EncodeHeaderValue(in)

	var decoded []byte
	for _, part := range strings.Split(got, "\r\n ") {
		part = strings.TrimSpace(part)
		if len(part) > 75 {
			t.Fatalf("encoded-word má %d znaků, limit je 75: %s", len(part), part)
		}
		if !strings.HasPrefix(part, "=?utf-8?B?") || !strings.HasSuffix(part, "?=") {
			t.Fatalf("část není encoded-word: %s", part)
		}
		payload := part[len("=?utf-8?B?") : len(part)-2]
		b, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			t.Fatalf("base64 se nedekóduje: %v", err)
		}
		if !utf8.Valid(b) {
			t.Fatal("část rozdělila vícebajtový znak uprostřed")
		}
		decoded = append(decoded, b...)
	}
	if string(decoded) != in {
		t.Fatal("po složení částí nevznikl původní řetězec")
	}
}

// V adresní hlavičce se kóduje jen display name, adresa zůstává ASCII.
func TestEncodeAddressEncodesOnlyDisplayName(t *testing.T) {
	got := EncodeAddress("Jan Novák", "newsletter@mail.example.cz")
	want := "=?utf-8?B?SmFuIE5vdsOhaw==?= <newsletter@mail.example.cz>"
	if got != want {
		t.Fatalf("got %q\nchci %q", got, want)
	}
}

func TestEncodeAddressWithoutName(t *testing.T) {
	if got := EncodeAddress("", "a@b.cz"); got != "<a@b.cz>" {
		t.Fatalf("got %q", got)
	}
}

func TestASCIIDisplayNameStaysLiteral(t *testing.T) {
	if got := EncodeAddress("Newsletter", "a@b.cz"); got != "Newsletter <a@b.cz>" {
		t.Fatalf("got %q", got)
	}
}
