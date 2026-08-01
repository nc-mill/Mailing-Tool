package config

import (
	"strings"
	"testing"
)

func TestClaimTTLMustCoverFourDispatchTimeouts(t *testing.T) {
	c := &Config{ClaimTTLSeconds: 30, DispatchTimeoutSeconds: 10, SenderID: "a", MetricsEnabled: false}
	errs := &Errors{}
	Validate(c, errs)
	if err := errs.orNil(); err == nil || !strings.Contains(err.Error(), "SENDER_CLAIM_TTL_SECONDS") {
		t.Fatalf("chci chybu o poměru TTL a timeoutu, dostal jsem %v", err)
	}
}

func TestMetricsTokenIsRequiredWhenMetricsEnabled(t *testing.T) {
	c := &Config{ClaimTTLSeconds: 300, DispatchTimeoutSeconds: 10, SenderID: "a", MetricsEnabled: true, MetricsToken: "krátký"}
	errs := &Errors{}
	Validate(c, errs)
	if err := errs.orNil(); err == nil || !strings.Contains(err.Error(), "METRICS_TOKEN") {
		t.Fatalf("chci chybu o METRICS_TOKEN, dostal jsem %v", err)
	}
}

func TestSenderIDLengthIsCapped(t *testing.T) {
	c := &Config{ClaimTTLSeconds: 300, DispatchTimeoutSeconds: 10, SenderID: strings.Repeat("x", 65)}
	errs := &Errors{}
	Validate(c, errs)
	if err := errs.orNil(); err == nil || !strings.Contains(err.Error(), "SENDER_ID") {
		t.Fatalf("chci chybu o délce SENDER_ID, dostal jsem %v", err)
	}
}

func TestHealthPortMustNotCollideInModeAll(t *testing.T) {
	c := &Config{Mode: "all", ClaimTTLSeconds: 300, DispatchTimeoutSeconds: 10, SenderID: "a", HealthPort: 3001}
	errs := &Errors{}
	Validate(c, errs)
	if err := errs.orNil(); err == nil || !strings.Contains(err.Error(), "SENDER_HEALTH_PORT") {
		t.Fatalf("chci chybu o kolizi portů, dostal jsem %v", err)
	}
}

func TestValidConfigurationPasses(t *testing.T) {
	c := &Config{ClaimTTLSeconds: 300, DispatchTimeoutSeconds: 10, SenderID: "sender-1"}
	errs := &Errors{}
	Validate(c, errs)
	if err := errs.orNil(); err != nil {
		t.Fatalf("platná konfigurace neprošla: %v", err)
	}
}
