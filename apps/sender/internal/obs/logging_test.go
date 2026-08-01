package obs

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

// Do logu NIKDY nesmí e-mailová adresa. Loguje se jen otisk, aby šlo dohledat
// konkrétní případ, aniž by log obsahoval osobní údaj.
func TestEmailIsLoggedOnlyAsHash(t *testing.T) {
	h := HashEmail("jana@example.cz")
	if len(h) != 12 {
		t.Fatalf("otisk má %d znaků, chci 12", len(h))
	}
	if strings.Contains(h, "@") || strings.Contains(h, "jana") {
		t.Fatalf("otisk prozrazuje adresu: %s", h)
	}
	if HashEmail("Jana@Example.CZ") != h {
		t.Fatal("otisk se musí počítat z normalizované adresy")
	}
}

func TestLoggerWritesJSONWithRequiredFields(t *testing.T) {
	var buf bytes.Buffer
	log := NewLogger(&buf, "info", "json")
	MessageLogger(log, MessageFields{
		MessageID:   "0192f3a0-1c2d-7e41-8b2c-3d4e5f607182",
		CampaignID:  "0192f3a0-1c2d-7e44-9e5f-60718293a4b5",
		WorkspaceID: "0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071",
		SenderID:    "sender-A",
		Attempt:     2,
	}).Info("claim_lost_after_dispatch")

	var record map[string]any
	if err := json.Unmarshal(buf.Bytes(), &record); err != nil {
		t.Fatalf("log není JSON: %v\n%s", err, buf.String())
	}
	for _, key := range []string{"message_id", "campaign_id", "workspace_id", "sender_id", "attempt"} {
		if _, ok := record[key]; !ok {
			t.Errorf("v záznamu chybí povinné pole %s", key)
		}
	}
	if record["msg"] != "claim_lost_after_dispatch" {
		t.Errorf("msg = %v", record["msg"])
	}
}

func TestUnknownLevelFallsBackToInfo(t *testing.T) {
	var buf bytes.Buffer
	log := NewLogger(&buf, "nesmysl", "json")
	log.Info("vidím se")
	if buf.Len() == 0 {
		t.Fatal("při neznámé úrovni se má použít info, ne ticho")
	}
}
