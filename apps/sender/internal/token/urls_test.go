package token

import "testing"

func TestURLsUseContractPaths(t *testing.T) {
	u := URLs{TrackingDomain: "https://track.example.com"}
	cases := []struct{ got, want string }{
		{u.Open("TOK"), "https://track.example.com/t/o/TOK"},
		{u.Click("TOK"), "https://track.example.com/t/c/TOK"},
		{u.Unsubscribe("TOK"), "https://track.example.com/u/TOK"},
		{u.Preferences("TOK"), "https://track.example.com/p/TOK"},
		{u.Webview("TOK"), "https://track.example.com/v/TOK"},
		{u.TestUnsubscribe(), "https://track.example.com/u/test"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("got %q, chci %q", c.got, c.want)
		}
	}
}

func TestTrailingSlashNeverDoubles(t *testing.T) {
	u := URLs{TrackingDomain: "https://track.example.com/"}
	if got := u.Open("TOK"); got != "https://track.example.com/t/o/TOK" {
		t.Fatalf("got %q", got)
	}
}
