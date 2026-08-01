// Package obs je pozorovatelnost senderu: strukturovaný log, metriky a health.
package obs

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"strings"
)

// MessageFields jsou pole povinná u každého záznamu vztaženého ke zprávě.
type MessageFields struct {
	MessageID   string
	CampaignID  string
	WorkspaceID string
	SenderID    string
	Attempt     int
}

// NewLogger vytvoří logger. Výchozí formát je JSON, pretty se používá jen
// mimo produkci.
func NewLogger(w io.Writer, level, format string) *slog.Logger {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "trace", "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error", "fatal":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	opts := &slog.HandlerOptions{Level: lvl}
	if format == "pretty" {
		return slog.New(slog.NewTextHandler(w, opts))
	}
	return slog.New(slog.NewJSONHandler(w, opts))
}

// MessageLogger doplní k loggeru povinná pole zprávy.
func MessageLogger(log *slog.Logger, f MessageFields) *slog.Logger {
	return log.With(
		"message_id", f.MessageID,
		"campaign_id", f.CampaignID,
		"workspace_id", f.WorkspaceID,
		"sender_id", f.SenderID,
		"attempt", f.Attempt,
	)
}

// HashEmail vrací zkrácený otisk adresy.
//
// Do logu NIKDY nesmí e-mailová adresa příjemce, obsah render_data, obsah zprávy
// ani dešifrovaná konfigurace providera. Otisk umožní dohledat konkrétní případ,
// aniž by log obsahoval osobní údaj.
func HashEmail(email string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	return hex.EncodeToString(sum[:])[:12]
}
