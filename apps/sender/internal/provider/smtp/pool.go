package smtp

import (
	"context"
	"strings"

	"github.com/nc-mill/mlain/apps/sender/internal/credentials"
	"github.com/nc-mill/mlain/apps/sender/internal/provider"
)

// Dispatcher je implementace pro obecné SMTP.
//
// SMTP připojení je drahé (TCP, TLS handshake, EHLO, AUTH), typicky 100 až 300 ms.
// Otevírat ho pro každou zprávu by propustnost srazilo na jednotky za sekundu,
// proto se spojení drží v poolu a mezi zprávami se resetují příkazem RSET.
type Dispatcher struct {
	cfg      *credentials.ProviderConfig
	timeouts Timeouts
	idle     chan *client
	slots    chan struct{}
}

// New vytvoří dispatcher a prázdný pool.
func New(cfg *credentials.ProviderConfig, t Timeouts) (*Dispatcher, error) {
	max := cfg.MaxConnections
	if max <= 0 {
		max = 4
	}
	d := &Dispatcher{
		cfg:      cfg,
		timeouts: t.withDefaults(),
		idle:     make(chan *client, max),
		slots:    make(chan struct{}, max),
	}
	for i := 0; i < max; i++ {
		d.slots <- struct{}{}
	}
	return d, nil
}

// Name vrací krátký identifikátor do metrik a logu.
func (d *Dispatcher) Name() string { return "smtp" }

func (d *Dispatcher) acquire(ctx context.Context) (*client, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-d.slots:
	}
	select {
	case c := <-d.idle:
		if err := c.reset(); err == nil {
			return c, nil
		}
		_ = c.Close()
	default:
	}
	c, err := dial(d.cfg.Host, d.cfg.Port, d.cfg.Encryption, d.cfg.InsecureSkipVerify, d.timeouts)
	if err != nil {
		d.slots <- struct{}{}
		return nil, err
	}
	if err := c.auth(d.cfg.Username, d.cfg.Password, d.cfg.AllowInsecureAuth); err != nil {
		_ = c.Close()
		d.slots <- struct{}{}
		return nil, err
	}
	return c, nil
}

func (d *Dispatcher) release(c *client, failed bool) {
	limit := d.cfg.MaxMessagesPerConnection
	if limit <= 0 {
		limit = 100
	}
	// Při jakékoliv chybě spojení se spojení zahodí a nevrací do poolu.
	// Po limitu zpráv se recykluje preventivně, protože mnoho MTA spojení po N
	// zprávách samo zavře a řešit chybu je dražší než ho vyměnit.
	if failed || c.sent >= limit {
		_ = c.Close()
		d.slots <- struct{}{}
		return
	}
	select {
	case d.idle <- c:
	default:
		_ = c.Close()
	}
	d.slots <- struct{}{}
}

// Dispatch odešle jednu zprávu.
func (d *Dispatcher) Dispatch(ctx context.Context, msg *provider.OutgoingMessage) (string, error) {
	c, err := d.acquire(ctx)
	if err != nil {
		return "", err
	}
	returnPath := msg.ReturnPath
	if returnPath == "" {
		returnPath = msg.From.Address
	}
	response, serr := c.send(returnPath, msg.To, msg.Raw)
	d.release(c, serr != nil)
	if serr != nil {
		return "", serr
	}
	return providerMessageID(response, msg.Raw), nil
}

// Close zavře všechna spojení v poolu.
func (d *Dispatcher) Close() error {
	for {
		select {
		case c := <-d.idle:
			_ = c.Close()
		default:
			return nil
		}
	}
}

// providerMessageID vytáhne z odpovědi na DATA poslední token, typicky
// "250 2.0.0 Ok: queued as 4Wq8Zt2xVzz1KX". Když se nedá vytáhnout nic rozumného,
// použije se naše vlastní hlavička Message-ID, aby bylo pole vždycky vyplněné
// a aplikace měla na co párovat.
func providerMessageID(response string, raw []byte) string {
	fields := strings.Fields(response)
	if len(fields) > 0 {
		last := fields[len(fields)-1]
		if len(last) >= 6 && strings.ContainsAny(last, "0123456789") && !strings.HasSuffix(last, ".") {
			return "smtp:" + last
		}
	}
	if id := headerValue(raw, "Message-ID"); id != "" {
		return "msgid:" + id
	}
	return "msgid:unknown"
}

func headerValue(raw []byte, name string) string {
	head := string(raw)
	if i := strings.Index(head, "\r\n\r\n"); i >= 0 {
		head = head[:i]
	}
	for _, line := range strings.Split(head, "\r\n") {
		if strings.HasPrefix(strings.ToLower(line), strings.ToLower(name)+":") {
			return strings.TrimSpace(line[len(name)+1:])
		}
	}
	return ""
}
