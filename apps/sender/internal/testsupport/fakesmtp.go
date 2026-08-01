//go:build integration || !integration

// Package testsupport, část pro jednotkové testy SMTP. Falešný server je
// záměrně mimo tag integration, protože databázi nepotřebuje.
package testsupport

import (
	"bufio"
	"fmt"
	"net"
	"strings"
	"sync"
)

// FakeSMTP je minimální SMTP server pro testy.
type FakeSMTP struct {
	ln          net.Listener
	mu          sync.Mutex
	connections int
	messages    int
	// AdvertiseStartTLS řídí, jestli server v EHLO inzeruje STARTTLS.
	AdvertiseStartTLS bool
	// DataResponse je odpověď na konec DATA.
	DataResponse string
	// RcptResponse je odpověď na RCPT TO.
	RcptResponse string
}

// NewFakeSMTP spustí server na náhodném portu.
func NewFakeSMTP() (*FakeSMTP, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s := &FakeSMTP{ln: ln, DataResponse: "250 2.0.0 Ok: queued as ABC123", RcptResponse: "250 2.1.5 Ok"}
	go s.serve()
	return s, nil
}

// Addr vrací hostitele a port.
func (s *FakeSMTP) Addr() (string, int) {
	a := s.ln.Addr().(*net.TCPAddr)
	return "127.0.0.1", a.Port
}

// Connections vrací počet navázaných spojení.
func (s *FakeSMTP) Connections() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.connections
}

// Messages vrací počet přijatých zpráv.
func (s *FakeSMTP) Messages() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.messages
}

// Close zastaví server.
func (s *FakeSMTP) Close() error { return s.ln.Close() }

func (s *FakeSMTP) serve() {
	for {
		conn, err := s.ln.Accept()
		if err != nil {
			return
		}
		s.mu.Lock()
		s.connections++
		s.mu.Unlock()
		go s.handle(conn)
	}
}

func (s *FakeSMTP) handle(conn net.Conn) {
	defer conn.Close()
	r := bufio.NewReader(conn)
	fmt.Fprint(conn, "220 fake ESMTP\r\n")
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		cmd := strings.ToUpper(strings.TrimSpace(line))
		switch {
		case strings.HasPrefix(cmd, "EHLO"):
			fmt.Fprint(conn, "250-fake\r\n250-PIPELINING\r\n")
			s.mu.Lock()
			advertise := s.AdvertiseStartTLS
			s.mu.Unlock()
			if advertise {
				fmt.Fprint(conn, "250-STARTTLS\r\n")
			}
			fmt.Fprint(conn, "250 AUTH PLAIN LOGIN\r\n")
		case strings.HasPrefix(cmd, "MAIL FROM"):
			fmt.Fprint(conn, "250 2.1.0 Ok\r\n")
		case strings.HasPrefix(cmd, "RCPT TO"):
			s.mu.Lock()
			rcpt := s.RcptResponse
			s.mu.Unlock()
			fmt.Fprint(conn, rcpt+"\r\n")
		case cmd == "DATA":
			fmt.Fprint(conn, "354 End data with <CR><LF>.<CR><LF>\r\n")
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if strings.TrimRight(l, "\r\n") == "." {
					break
				}
			}
			s.mu.Lock()
			s.messages++
			data := s.DataResponse
			s.mu.Unlock()
			fmt.Fprint(conn, data+"\r\n")
		case cmd == "RSET":
			fmt.Fprint(conn, "250 2.0.0 Ok\r\n")
		case cmd == "QUIT":
			fmt.Fprint(conn, "221 2.0.0 Bye\r\n")
			return
		default:
			fmt.Fprint(conn, "500 5.5.2 Unknown\r\n")
		}
	}
}
