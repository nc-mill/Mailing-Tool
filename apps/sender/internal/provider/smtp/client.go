// Package smtp odesílá přes obecný SMTP server.
//
// Klient je vlastní, nad net, crypto/tls a net/textproto. Důvod je konkrétní:
// potřebujeme přečíst syrovou odpověď serveru na DATA a vytáhnout z ní
// provider_message_id (AK-9.6), což vysokoúrovňová API nevracejí.
package smtp

import (
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

// ProtocolError je odpověď serveru, která nesedí s očekáváním.
type ProtocolError struct {
	Code    int
	Stage   string
	Message string
}

func (e *ProtocolError) Error() string {
	return fmt.Sprintf("smtp %s: %d %s", e.Stage, e.Code, e.Message)
}

// Timeouts jsou lhůty jednotlivých fází.
type Timeouts struct {
	Connect time.Duration
	Command time.Duration
	Data    time.Duration
}

func (t Timeouts) withDefaults() Timeouts {
	if t.Connect == 0 {
		t.Connect = 10 * time.Second
	}
	if t.Command == 0 {
		t.Command = 30 * time.Second
	}
	if t.Data == 0 {
		t.Data = 120 * time.Second
	}
	return t
}

type client struct {
	conn     net.Conn
	text     *textproto.Conn
	timeouts Timeouts
	sent     int
	tlsOn    bool
	exts     map[string]string
}

func dial(host string, port int, encryption string, insecureSkipVerify bool, t Timeouts) (*client, error) {
	t = t.withDefaults()
	// JoinHostPort, ne fmt.Sprintf: hostitel může být adresa IPv6 a ta se musí
	// do hranatých závorek, jinak net.Dial adresu nerozebere.
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	var conn net.Conn
	var err error
	tlsCfg := &tls.Config{ServerName: host, InsecureSkipVerify: insecureSkipVerify}

	if encryption == "tls" {
		conn, err = tls.DialWithDialer(&net.Dialer{Timeout: t.Connect}, "tcp", addr, tlsCfg)
	} else {
		conn, err = net.DialTimeout("tcp", addr, t.Connect)
	}
	if err != nil {
		return nil, err
	}
	c := &client{conn: conn, text: textproto.NewConn(conn), timeouts: t, tlsOn: encryption == "tls"}
	if _, _, err := c.expect(220, "greeting"); err != nil {
		c.Close()
		return nil, err
	}
	if err := c.hello(host); err != nil {
		c.Close()
		return nil, err
	}
	if encryption == "starttls" {
		if _, ok := c.exts["STARTTLS"]; !ok {
			c.Close()
			return nil, &ProtocolError{Code: 0, Stage: "starttls", Message: "server neinzeruje STARTTLS"}
		}
		if err := c.cmd(220, "starttls", "STARTTLS"); err != nil {
			c.Close()
			return nil, err
		}
		tconn := tls.Client(conn, tlsCfg)
		if err := tconn.Handshake(); err != nil {
			c.Close()
			return nil, err
		}
		c.conn = tconn
		c.text = textproto.NewConn(tconn)
		c.tlsOn = true
		if err := c.hello(host); err != nil {
			c.Close()
			return nil, err
		}
	}
	return c, nil
}

func (c *client) hello(host string) error {
	if err := c.write("EHLO %s", localName()); err != nil {
		return err
	}
	code, msg, err := c.expect(250, "ehlo")
	if err != nil {
		return err
	}
	_ = code
	c.exts = map[string]string{}
	for _, line := range strings.Split(msg, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, " ", 2)
		name := strings.ToUpper(parts[0])
		if len(parts) == 2 {
			c.exts[name] = parts[1]
		} else {
			c.exts[name] = ""
		}
	}
	return nil
}

func localName() string { return "mlain-sender" }

func (c *client) write(format string, args ...any) error {
	_ = c.conn.SetDeadline(time.Now().Add(c.timeouts.Command))
	return c.text.PrintfLine(format, args...)
}

func (c *client) expect(want int, stage string) (int, string, error) {
	_ = c.conn.SetDeadline(time.Now().Add(c.timeouts.Command))
	code, msg, err := c.text.ReadResponse(want)
	if err != nil {
		var pe *textproto.Error
		if errors.As(err, &pe) {
			return pe.Code, pe.Msg, &ProtocolError{Code: pe.Code, Stage: stage, Message: pe.Msg}
		}
		return 0, "", err
	}
	return code, msg, nil
}

func (c *client) cmd(want int, stage, format string, args ...any) error {
	if err := c.write(format, args...); err != nil {
		return err
	}
	_, _, err := c.expect(want, stage)
	return err
}

// auth pošle přihlašovací údaje. NIKDY po nešifrovaném spojení, pokud to není
// výslovně povolené.
func (c *client) auth(username, password string, allowInsecure bool) error {
	if username == "" {
		return nil
	}
	if !c.tlsOn && !allowInsecure {
		return &ProtocolError{Code: 0, Stage: "auth_insecure", Message: "odmítáme poslat heslo po nešifrovaném spojení"}
	}
	mechs := strings.ToUpper(c.exts["AUTH"])
	switch {
	case strings.Contains(mechs, "PLAIN"):
		return c.cmd(235, "auth", "AUTH PLAIN %s", encodePlain(username, password))
	case strings.Contains(mechs, "LOGIN"):
		if err := c.cmd(334, "auth", "AUTH LOGIN"); err != nil {
			return err
		}
		if err := c.cmd(334, "auth", "%s", encodeB64(username)); err != nil {
			return err
		}
		return c.cmd(235, "auth", "%s", encodeB64(password))
	default:
		return &ProtocolError{Code: 0, Stage: "auth", Message: "server neinzeruje PLAIN ani LOGIN"}
	}
}

// send odešle jednu zprávu a vrátí syrovou odpověď na DATA.
func (c *client) send(returnPath, recipient string, raw []byte) (string, error) {
	if err := c.cmd(250, "mail", "MAIL FROM:<%s>", returnPath); err != nil {
		return "", err
	}
	if err := c.cmd(250, "rcpt", "RCPT TO:<%s>", recipient); err != nil {
		return "", err
	}
	if err := c.cmd(354, "data", "DATA"); err != nil {
		return "", err
	}
	_ = c.conn.SetDeadline(time.Now().Add(c.timeouts.Data))
	w := c.text.DotWriter()
	if _, err := w.Write(raw); err != nil {
		w.Close()
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	_, msg, err := c.expect(250, "data")
	if err != nil {
		return "", err
	}
	c.sent++
	return msg, nil
}

func (c *client) reset() error { return c.cmd(250, "rset", "RSET") }

func (c *client) Close() error {
	_ = c.write("QUIT")
	return c.conn.Close()
}

func encodeB64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

func encodePlain(user, pass string) string {
	return base64.StdEncoding.EncodeToString([]byte("\x00" + user + "\x00" + pass))
}
