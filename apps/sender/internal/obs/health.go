package obs

import (
	"context"
	"crypto/subtle"
	"net"
	"net/http"
	"strconv"
	"time"
)

// Health obsluhuje /healthz, /readyz a /metrics.
//
// Žádný z endpointů nevyžaduje autentizaci kromě /metrics a žádný nevrací data
// zákazníka. Port se v compose nepublikuje ven.
type Health struct {
	ping         func(context.Context) error
	metricsToken string
	metrics      bool
	handler      http.Handler
}

// NewHealth sestaví health server. metricsHandler se připojí jen tehdy,
// když je METRICS_ENABLED true.
func NewHealth(ping func(context.Context) error, metricsToken string, metricsEnabled bool) *Health {
	h := &Health{ping: ping, metricsToken: metricsToken, metrics: metricsEnabled}
	mux := http.NewServeMux()

	// /healthz je liveness probe: hlásí jen to, že proces běží. Kdyby závisel
	// na databázi, orchestrátor by kontejner restartoval při každém výpadku
	// databáze, což problém nevyřeší a jen prodlouží výpadek.
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})

	// /readyz je readiness probe: databáze musí odpovědět do 2 sekund.
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := h.ping(ctx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("database unavailable\n"))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready\n"))
	})

	h.handler = mux
	return h
}

// AttachMetrics připojí Prometheus endpoint chráněný tokenem.
func (h *Health) AttachMetrics(promHandler http.Handler) {
	mux, ok := h.handler.(*http.ServeMux)
	if !ok || !h.metrics {
		return
	}
	mux.Handle("/metrics", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !h.authorized(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		promHandler.ServeHTTP(w, r)
	}))
}

func (h *Health) authorized(r *http.Request) bool {
	if h.metricsToken == "" {
		return false
	}
	got := r.Header.Get("Authorization")
	want := "Bearer " + h.metricsToken
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// Handler vrací obsluhu pro testy i pro server.
func (h *Health) Handler() http.Handler {
	// Bez zapnutých metrik se cesta /metrics nikdy nepřipojí a ServeMux
	// na ni vrátí 404 sám.
	return h.handler
}

// Serve spustí HTTP server na daném portu a vrátí ho, aby ho šlo zavřít
// při ukončování procesu.
//
// Port je SENDER_HEALTH_PORT s výchozí hodnotou 3002. Trojka 3001 patří workeru
// a při MODE=all by kolize znamenala, že jeden z procesů nenastartuje.
func (h *Health) Serve(port int) (*http.Server, error) {
	ln, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return nil, err
	}
	srv := &http.Server{Handler: h.handler, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	return srv, nil
}
