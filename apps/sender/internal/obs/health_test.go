package obs

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthzIsAlwaysOK(t *testing.T) {
	h := NewHealth(func(context.Context) error { return errors.New("databáze je dole") }, "", false)
	rec := httptest.NewRecorder()
	h.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("kód = %d, liveness probe má hlásit jen to, že proces běží", rec.Code)
	}
}

func TestReadyzFailsWhenDatabaseIsDown(t *testing.T) {
	h := NewHealth(func(context.Context) error { return errors.New("dole") }, "", false)
	rec := httptest.NewRecorder()
	h.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("kód = %d, chci 503", rec.Code)
	}
}

func TestReadyzPassesWhenDatabaseAnswers(t *testing.T) {
	h := NewHealth(func(context.Context) error { return nil }, "", false)
	rec := httptest.NewRecorder()
	h.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("kód = %d, chci 200", rec.Code)
	}
}

func TestMetricsAreOffByDefault(t *testing.T) {
	h := NewHealth(func(context.Context) error { return nil }, "", false)
	h.AttachMetrics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	rec := httptest.NewRecorder()
	h.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("kód = %d, při METRICS_ENABLED=false nemá endpoint existovat", rec.Code)
	}
}

func TestMetricsRequireToken(t *testing.T) {
	token := "tenhle-token-ma-aspon-tricet-dva-znaky"
	h := NewHealth(func(context.Context) error { return nil }, token, true)
	h.AttachMetrics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))

	rec := httptest.NewRecorder()
	h.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bez tokenu kód = %d, chci 401", rec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	h.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("s tokenem kód = %d, chci 200", rec.Code)
	}
}
