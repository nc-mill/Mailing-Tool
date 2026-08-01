package obs

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// PrometheusHandler vrací obsluhu /metrics nad naším registrem.
func PrometheusHandler(m *Metrics) http.Handler {
	return promhttp.HandlerFor(m.Registry, promhttp.HandlerOpts{})
}

// Metrics je sada metrik senderu.
//
// Popisky NIKDY neobsahují campaign_id ani workspace_id, protože by to
// vygenerovalo neomezenou kardinalitu. Průběh kampaně je vidět v aplikaci,
// která na to má databázi.
type Metrics struct {
	Registry *prometheus.Registry

	MessagesDispatched *prometheus.CounterVec
	DispatchDuration   *prometheus.HistogramVec
	RenderDuration     prometheus.Histogram
	ClaimBatchRows     prometheus.Histogram
	Inflight           prometheus.Gauge
	RateLimitCurrent   *prometheus.GaugeVec
	ThrottleEvents     *prometheus.CounterVec
	ReaperRequeued     prometheus.Counter
	AmbiguousDispatch  *prometheus.CounterVec
	CircuitBreakerTrip *prometheus.CounterVec
	ShutdownForced     prometheus.Counter
	DBErrors           *prometheus.CounterVec
}

// NewMetrics zaregistruje všechny metriky do vlastního registru.
func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()
	m := &Metrics{
		Registry: reg,
		MessagesDispatched: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "sender_messages_dispatched_total",
			Help: "Počet zpráv podle providera a výsledku.",
		}, []string{"provider", "result"}),
		DispatchDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "sender_dispatch_duration_seconds",
			Help:    "Latence volání providera.",
			Buckets: prometheus.DefBuckets,
		}, []string{"provider"}),
		RenderDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "sender_render_duration_seconds",
			Help:    "Doba interpolace jedné zprávy.",
			Buckets: []float64{0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1},
		}),
		ClaimBatchRows: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "sender_claim_batch_rows",
			Help:    "Kolik řádků vrátil claim.",
			Buckets: []float64{0, 1, 10, 25, 50, 100, 250, 500, 1000},
		}),
		Inflight: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "sender_inflight",
			Help: "Kolik zpráv je právě v letu.",
		}),
		RateLimitCurrent: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "sender_rate_limit_current",
			Help: "Aktuální limit po úpravách AIMD.",
		}, []string{"provider"}),
		ThrottleEvents: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "sender_throttle_events_total",
			Help: "Kolikrát provider škrtil.",
		}, []string{"provider"}),
		ReaperRequeued: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "sender_reaper_requeued_total",
			Help: "Kolik řádků vrátil reaper do fronty.",
		}),
		AmbiguousDispatch: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "sender_ambiguous_dispatch_total",
			Help: "Kolik zpráv skončilo v nejistotě. Klíčová metrika.",
		}, []string{"outcome"}),
		CircuitBreakerTrip: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "sender_circuit_breaker_trips_total",
			Help: "Jak často se kampaně pauzují.",
		}, []string{"code"}),
		ShutdownForced: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "sender_shutdown_forced_total",
			Help: "Kolikrát vypršel shutdown deadline.",
		}),
		DBErrors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "sender_db_errors_total",
			Help: "Chyby databáze podle operace.",
		}, []string{"op"}),
	}
	reg.MustRegister(
		m.MessagesDispatched, m.DispatchDuration, m.RenderDuration, m.ClaimBatchRows,
		m.Inflight, m.RateLimitCurrent, m.ThrottleEvents, m.ReaperRequeued,
		m.AmbiguousDispatch, m.CircuitBreakerTrip, m.ShutdownForced, m.DBErrors,
	)
	return m
}
