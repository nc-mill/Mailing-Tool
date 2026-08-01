package config

// Validate provádí kontroly, které nejde udělat u jedné proměnné samostatně.
// Zapisuje do errs, nikdy nepanikaří a nikdy nekončí proces sama.
func Validate(c *Config, errs *Errors) {
	// Claim musí přežít několik pokusů o odeslání. Bez tohohle poměru by reaper
	// bral zprávy, které sender právě odesílá. Kontraktní podmínka z 4.9.
	if c.ClaimTTLSeconds <= 4*c.DispatchTimeoutSeconds {
		errs.add("SENDER_CLAIM_TTL_SECONDS (%d) musí být větší než 4 × SENDER_DISPATCH_TIMEOUT_SECONDS (%d)",
			c.ClaimTTLSeconds, c.DispatchTimeoutSeconds)
	}

	// Heartbeat běží každou třetinu TTL, takže se do TTL vejde třikrát. Platí to
	// z definice, kontroluje se pro případ, že by se interval stal konfigurovatelným.
	if c.ClaimTTLSeconds/3 <= 0 {
		errs.add("SENDER_CLAIM_TTL_SECONDS (%d) je tak malé, že interval heartbeatu vyjde na nulu", c.ClaimTTLSeconds)
	}

	if len(c.SenderID) > 64 {
		errs.add("SENDER_ID: %d znaků je víc než 64, sloupec messages.claimed_by je na 64 znaků", len(c.SenderID))
	}
	if c.SenderID == "" {
		errs.add("SENDER_ID: nesmí být prázdné, jinak by se claimy nedaly přiřadit instanci")
	}

	if c.MetricsEnabled && len(c.MetricsToken) < 32 {
		errs.add("METRICS_TOKEN: při METRICS_ENABLED=true je povinný a musí mít aspoň 32 znaků")
	}

	// Při MODE=all běží web, worker i sender ve stejném prostředí a sdílejí
	// proměnné. Kolize portů by znamenala, že jeden z procesů nenastartuje,
	// a chyba by se projevila až za běhu.
	if c.Mode == "all" && c.HealthPort == 3001 {
		errs.add("SENDER_HEALTH_PORT: 3001 patří workeru (WORKER_HEALTH_PORT), " +
			"při MODE=all se porty nesmí krýt")
	}
	if c.Mode == "all" && c.HealthPort == 3000 {
		errs.add("SENDER_HEALTH_PORT: 3000 patří webu (PORT), při MODE=all se porty nesmí krýt")
	}

	// POZOR: strop na počet pokolení klíče se tady NEKONTROLUJE a kontrolovat se nesmí.
	// Kontrakt 3.10 ho výslovně ruší a zakazuje jeho návrat i v podobě validace
	// konfigurace. Otisk smazané adresy nejde nikdy přepočítat, takže by vyčerpaný
	// strop znamenal, že se smazaný člověk vrátí prvním dalším importem, aniž by
	// cokoliv selhalo nebo se zalogovalo. Viz AK-20.9.
}
