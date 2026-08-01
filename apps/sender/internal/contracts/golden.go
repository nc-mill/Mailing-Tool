package contracts

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"
)

// Mismatch je jedna neshoda mezi produkčním kódem a fixture.
type Mismatch struct {
	ID     string
	Detail string
}

// Outcome je výsledek jednoho běhu runneru: co se dalo zpracovat, co se
// zpracovalo, a v čem se to rozešlo.
type Outcome struct {
	Total      int
	IDs        []string
	Mismatches []Mismatch
	Groups     map[string]int
}

// hasSide říká, jestli fixture patří téhle jazykové straně. Je to DATA ze
// zmrazené fixture, ne rozhodnutí runneru za běhu. Rozdíl je zásadní:
// t.Skip() uvnitř běhu nikdo nespočítá, kdežto chybějící "go" v poli sides
// je vidět v code review a check-parity z něj počítá očekávanou množinu.
func hasSide(sides []string, side string) bool {
	for _, item := range sides {
		if item == side {
			return true
		}
	}
	return false
}

// finish je společný závěr všech runnerů: zapiš report, pak nahlas neshody.
// V TOMHLE POŘADÍ. Kdyby se hlásilo dřív, t.Fatalf by běh ukončil a report by
// nevznikl, takže by check-parity neměl co porovnat a chybějící parita by
// vypadala stejně jako parita v pořádku.
func finish(t *testing.T, section string, outcome Outcome, files []string) {
	t.Helper()
	digest, err := FixturesDigest(section, files)
	if err != nil {
		t.Fatalf("otisk fixtures sekce %s: %v", section, err)
	}
	WriteGoldenReport(t, section, outcome.Total, outcome.IDs, outcome.Groups, digest)
	for _, mismatch := range outcome.Mismatches {
		t.Errorf("%s: %s", mismatch.ID, mismatch.Detail)
	}
}

// ---------------------------------------------------------------- kontrakt 3 --

type tokenVectors struct {
	SecretKey string `json:"secret_key"`
	Positive  []struct {
		ID            string         `json:"id"`
		Type          string         `json:"type"`
		KeyID         int            `json:"key_id"`
		Fields        map[string]any `json:"fields"`
		ExpectedToken string         `json:"expected_token"`
		ExpectedMAC   string         `json:"expected_mac_full"`
		Sides         []string       `json:"sides"`
	} `json:"positive"`
	Negative []struct {
		ID    string   `json:"id"`
		Sides []string `json:"sides"`
	} `json:"negative"`
}

// TokenRunner drží produkční funkce P09. Runner je nezná jménem ani balíčkem,
// takže se internal/contracts přeloží i bez nich.
type TokenRunner struct {
	// Init dostane obsah pole secret_key z fixture a připraví keyring i stavitele.
	Init func(secretKey string) error
	// Build vyrobí token daného typu. Typ je ASCII znak z kontraktu ("o", "c", "u").
	// Fields jsou syrová pole fixture; převod na UUID a čas dělá adaptér, protože
	// balíček contracts na uuid závislost nemá a mít nemá. Vrací i plnou HMAC
	// před zkrácením, protože kontrakt ji uvádí jako závaznou hodnotu.
	Build func(typ string, keyID uint8, fields map[string]any) (token string, macFull []byte, err error)
}

// CheckTokenGolden je čistá část runneru. Nesahá na testing, takže jde otestovat.
func CheckTokenGolden(raw []byte, runner TokenRunner) (Outcome, error) {
	var v tokenVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		return Outcome{}, fmt.Errorf("fixtures nejdou naparsovat: %w", err)
	}
	if err := runner.Init(v.SecretKey); err != nil {
		return Outcome{}, fmt.Errorf("keyring z fixture: %w", err)
	}

	outcome := Outcome{}
	for _, vec := range v.Positive {
		if !hasSide(vec.Sides, "go") {
			continue
		}
		outcome.Total++
		token, macFull, err := runner.Build(vec.Type, uint8(vec.KeyID), vec.Fields)
		if err != nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID, "build selhal: " + err.Error()})
			continue
		}
		if token != vec.ExpectedToken {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("token se rozešel\n  Go:       %s\n  kontrakt: %s", token, vec.ExpectedToken)})
			continue
		}
		if got := hex.EncodeToString(macFull); got != vec.ExpectedMAC {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("plná HMAC se rozešla\n  Go:       %s\n  kontrakt: %s", got, vec.ExpectedMAC)})
			continue
		}
		outcome.IDs = append(outcome.IDs, vec.ID)
	}
	// Negativní vektory jsou o OVĚŘENÍ tokenu, které dělá aplikace, ne sender.
	// Kdyby si je někdo nárokoval pro Go, je to chyba fixture, ne důvod k přeskočení.
	for _, vec := range v.Negative {
		if hasSide(vec.Sides, "go") {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				"má sides go, ale sender tokeny neověřuje; oprav fixture nebo runner"})
		}
	}
	return outcome, nil
}

func RunTokenGolden(t *testing.T, runner TokenRunner) {
	t.Helper()
	raw, err := ReadFixture("token/vectors.json")
	if err != nil {
		t.Fatalf("fixtures nejdou přečíst: %v", err)
	}
	outcome, err := CheckTokenGolden(raw, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "token", outcome, []string{"vectors.json"})
}

// ---------------------------------------------------------------- kontrakt 4 --

type cryptoVectors struct {
	SecretKey string `json:"secret_key"`
	Positive  []struct {
		ID             string   `json:"id"`
		Context        string   `json:"context"`
		WorkspaceID    string   `json:"workspace_id"`
		Plaintext      string   `json:"plaintext"`
		ExpectedStored string   `json:"expected_stored"`
		Sides          []string `json:"sides"`
	} `json:"positive"`
	Negative []struct {
		ID            string   `json:"id"`
		Stored        string   `json:"stored"`
		Context       string   `json:"context"`
		WorkspaceID   string   `json:"workspace_id"`
		ExpectedError string   `json:"expected_error"`
		Sides         []string `json:"sides"`
	} `json:"negative"`
}

type CryptoRunner struct {
	Init func(secretKey string) error
	// Decrypt je jediná operace, kterou sender má. Šifruje aplikace.
	Decrypt func(stored, expectedContext, workspaceID string) ([]byte, error)
	// ErrorCode přeloží chybu produkčního balíčku na kontraktní kód. Runner
	// nezná taxonomii chyb P09, takže překlad dodává adaptér.
	ErrorCode func(err error) string
}

// CheckCryptoGolden u pozitivního vektoru ověřuje, že Go přečte obálku, kterou
// zapsal TypeScript. Bajtová shoda při šifrování se v Go netestuje, protože
// sender šifrovat neumí; tu drží TypeScript strana proti závaznému vektoru.
func CheckCryptoGolden(raw []byte, runner CryptoRunner) (Outcome, error) {
	var v cryptoVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		return Outcome{}, fmt.Errorf("fixtures nejdou naparsovat: %w", err)
	}
	if err := runner.Init(v.SecretKey); err != nil {
		return Outcome{}, fmt.Errorf("keyring z fixture: %w", err)
	}

	outcome := Outcome{}
	for _, vec := range v.Positive {
		if !hasSide(vec.Sides, "go") {
			continue
		}
		outcome.Total++
		plain, err := runner.Decrypt(vec.ExpectedStored, vec.Context, vec.WorkspaceID)
		if err != nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				"dešifrování obálky z TypeScriptu selhalo: " + err.Error()})
			continue
		}
		if string(plain) != vec.Plaintext {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("plaintext se rozešel\n  Go: %q\n  TS: %q", string(plain), vec.Plaintext)})
			continue
		}
		outcome.IDs = append(outcome.IDs, vec.ID)
	}
	for _, vec := range v.Negative {
		if !hasSide(vec.Sides, "go") {
			continue
		}
		outcome.Total++
		if _, err := runner.Decrypt(vec.Stored, vec.Context, vec.WorkspaceID); err == nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID, "dešifrování mělo selhat"})
			continue
		} else if code := runner.ErrorCode(err); code != vec.ExpectedError {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("kód se rozešel: %s, čekal se %s", code, vec.ExpectedError)})
			continue
		}
		outcome.IDs = append(outcome.IDs, vec.ID)
	}
	return outcome, nil
}

func RunCryptoGolden(t *testing.T, runner CryptoRunner) {
	t.Helper()
	raw, err := ReadFixture("crypto/vectors.json")
	if err != nil {
		t.Fatalf("fixtures nejdou přečíst: %v", err)
	}
	outcome, err := CheckCryptoGolden(raw, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "crypto", outcome, []string{"vectors.json"})
}

// ----------------------------------------------------------------- Message-ID --

type messageIDVectors struct {
	Cases []struct {
		ID             string   `json:"id"`
		MessageID      string   `json:"message_id"`
		SendingDomain  string   `json:"sending_domain"`
		ExpectedHeader string   `json:"expected_header"`
		Sides          []string `json:"sides"`
	} `json:"cases"`
}

type MessageIDRunner struct {
	Build func(messageID, sendingDomain string) (string, error)
}

func CheckMessageIDGolden(raw []byte, runner MessageIDRunner) (Outcome, error) {
	var v messageIDVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		return Outcome{}, fmt.Errorf("fixtures nejdou naparsovat: %w", err)
	}
	outcome := Outcome{}
	for _, vec := range v.Cases {
		if !hasSide(vec.Sides, "go") {
			continue
		}
		outcome.Total++
		first, err := runner.Build(vec.MessageID, vec.SendingDomain)
		if err != nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID, "build selhal: " + err.Error()})
			continue
		}
		if first != vec.ExpectedHeader {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("Message-ID se rozešel s TypeScript stranou\n  Go: %s\n  TS: %s",
					first, vec.ExpectedHeader)})
			continue
		}
		// OB-11: dva pokusy téže zprávy dají identický řetězec.
		second, err := runner.Build(vec.MessageID, vec.SendingDomain)
		if err != nil || first != second {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				"OB-11: dva pokusy dají různý Message-ID"})
			continue
		}
		outcome.IDs = append(outcome.IDs, vec.ID)
	}
	return outcome, nil
}

func RunMessageIDGolden(t *testing.T, runner MessageIDRunner) {
	t.Helper()
	raw, err := ReadFixture("message-id/vectors.json")
	if err != nil {
		t.Fatalf("fixtures nejdou přečíst: %v", err)
	}
	outcome, err := CheckMessageIDGolden(raw, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "message-id", outcome, []string{"vectors.json"})
}

// ---------------------------------------------------------------- kontrakt 2 --

type liquidFixture struct {
	ID          string         `json:"id"`
	Description string         `json:"description"`
	Context     string         `json:"context"`
	Level       string         `json:"level"`
	Template    string         `json:"template"`
	Data        map[string]any `json:"data"`
	Presence    []string       `json:"presence"`
	Expected    string         `json:"expected"`
	ExpectError *struct {
		Code         string `json:"code"`
		HintContains string `json:"hint_contains"`
	} `json:"expect_validation_error"`
}

// LiquidRunner drží produkční render P09. Jedna funkce schválně: pořadí kroků
// (Prepare, DecodeRenderData, WithBlankBindings, Render) je věc balíčku liquidx
// a runner do něj nemá mluvit. Kdyby si ho runner poskládal sám, testoval by
// jiné pořadí, než jakým se opravdu odesílá.
type LiquidRunner struct {
	// Render dostane šablonu, syrová data jako JSON a příznak textové varianty.
	Render func(template string, rawData []byte, presence []string, plainText bool) (string, error)
}

// templateIsInertInGo vyjmenovává fixtury, které jsou pro Go knihovnu
// syntakticky platné, ale zakazuje je NÁŠ validátor, ne knihovna. Seznam je
// explicitní, aby nešlo tiše přehlédnout, že Go přijalo něco, co přijmout nemělo.
//
// Seznam je OVĚŘENÝ SPUŠTĚNÍM proti github.com/osteele/liquid v1.8.1, ne odhad.
// Dřívější znění tady mělo devět položek a chyběly v něm LQ-501 ({% assign %}),
// LQ-502 (whitespace control) a LQ-507 (indexování pole), které knihovna
// zpracuje bez chyby. Test na nich padal.
func templateIsInertInGo(id string) bool {
	switch id {
	case "LQ-308", "LQ-501", "LQ-502", "LQ-503", "LQ-504", "LQ-505",
		"LQ-506", "LQ-507", "LQ-509", "LQ-511", "LQ-700", "LQ-701", "LQ-702":
		return true
	default:
		return false
	}
}

func CheckLiquidGolden(dir string, names []string, read func(string) ([]byte, error), runner LiquidRunner) (Outcome, error) {
	outcome := Outcome{Groups: map[string]int{}}
	for _, name := range names {
		raw, err := read(name)
		if err != nil {
			return Outcome{}, fmt.Errorf("%s: %w", name, err)
		}
		var fixture liquidFixture
		if err := json.Unmarshal(raw, &fixture); err != nil {
			return Outcome{}, fmt.Errorf("%s: %w", name, err)
		}
		outcome.Total++

		rawData, err := json.Marshal(fixture.Data)
		if err != nil {
			return Outcome{}, fmt.Errorf("%s: data nejdou serializovat: %w", fixture.ID, err)
		}
		out, renderErr := runner.Render(fixture.Template, rawData, fixture.Presence, fixture.Context == "text")

		if fixture.ExpectError != nil {
			// Validátor je vlastnictví TypeScript strany a v Go neexistuje.
			// Go tu ověřuje slabší, ale netriviální tvrzení: šablona se buď
			// nezparsuje, nebo je uvedená v seznamu inertních.
			if renderErr == nil && !templateIsInertInGo(fixture.ID) {
				outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
					"šablona odmítnutá validátorem prošla v Go bez chyby a není v templateIsInertInGo"})
				continue
			}
		} else {
			if renderErr != nil {
				outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
					"render selhal: " + renderErr.Error()})
				continue
			}
			if out != fixture.Expected {
				outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
					fmt.Sprintf("výstup se rozešel bajt po bajtu\n  Go: %q\n  TS: %q", out, fixture.Expected)})
				continue
			}
		}

		// AŽ TADY. Dřívější znění plnilo groups i rendered MIMO tělo podtestu,
		// takže přeskočení uvnitř běhu nebylo v počtech vidět vůbec.
		outcome.Groups["LQ-"+fixture.ID[3:4]+"xx"]++
		outcome.IDs = append(outcome.IDs, fixture.ID)
	}
	return outcome, nil
}

func RunLiquidGolden(t *testing.T, runner LiquidRunner) {
	t.Helper()
	names, err := ListFixtures("liquid")
	if err != nil {
		t.Fatalf("nelze číst fixtures: %v", err)
	}
	if len(names) < 54 {
		t.Fatalf("čekám nejméně 54 fixtur podle kritéria 41, je jich %d", len(names))
	}
	outcome, err := CheckLiquidGolden("liquid", names, func(name string) ([]byte, error) {
		return ReadFixture("liquid/" + name)
	}, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "liquid", outcome, names)
}

// ---------------------------------------------------------------- kontrakt 1 --

type outboxRegistry struct {
	Transitions []struct {
		ID        string  `json:"id"`
		From      string  `json:"from"`
		To        string  `json:"to"`
		Actor     string  `json:"actor"`
		ErrorCode *string `json:"error_code"`
		Allowed   bool    `json:"allowed"`
	} `json:"transitions"`
}

// OutboxRunner drží produkční tabulku přechodů P09. ErrorCode je prázdný řetězec
// pro NULL, protože tak ho nese sloupec messages.error_code.
type OutboxRunner struct {
	CanTransition func(from, to, actor, errorCode string) bool
}

func CheckOutboxTransitions(raw []byte, runner OutboxRunner) (Outcome, error) {
	var registry outboxRegistry
	if err := json.Unmarshal(raw, &registry); err != nil {
		return Outcome{}, fmt.Errorf("registr nejde naparsovat: %w", err)
	}
	outcome := Outcome{}
	for _, testCase := range registry.Transitions {
		outcome.Total++
		code := ""
		if testCase.ErrorCode != nil {
			code = *testCase.ErrorCode
		}
		got := runner.CanTransition(testCase.From, testCase.To, testCase.Actor, code)
		if got != testCase.Allowed {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{testCase.ID,
				fmt.Sprintf("%s -> %s (%s, error_code %q): Go vrací %v, kontrakt %v",
					testCase.From, testCase.To, testCase.Actor, code, got, testCase.Allowed)})
			continue
		}
		outcome.IDs = append(outcome.IDs, testCase.ID)
	}
	return outcome, nil
}

func RunOutboxTransitions(t *testing.T, runner OutboxRunner) {
	t.Helper()
	raw, err := ReadFixture("outbox/scenarios.json")
	if err != nil {
		t.Fatalf("registr nejde přečíst: %v", err)
	}
	outcome, err := CheckOutboxTransitions(raw, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	// Sekce `outbox` se do parity nepočítá jako soubory fixtures, ale jako
	// případy uvnitř jednoho souboru; otisk je proto nad tím jedním souborem.
	finish(t, "outbox", outcome, []string{"scenarios.json"})
}

// ---------------------------------------------------------------- kontrakt 5 --

type markerFixture struct {
	ID                   string            `json:"id"`
	Description          string            `json:"description"`
	Source               string            `json:"source"`
	TrackingDomain       string            `json:"tracking_domain"`
	LinkTokens           map[string]string `json:"link_tokens"`
	OpenToken            *string           `json:"open_token"`
	Expected             string            `json:"expected"`
	ExpectedReplacements int               `json:"expected_replacements"`
}

// MarkersRunner drží produkční funkce P09. Jména se v P09 liší (ReplaceLinks,
// ReplacePixel, HasResidual), proto je runner bere jako hodnoty a překlad jmen
// je v tenkém adaptéru, ne tady.
type MarkersRunner struct {
	ReplaceLinks func(src string, tokenFor func(linkID string) (string, error)) (string, int, error)
	ReplacePixel func(src, replacement string) (string, int)
	HasResidual  func(s string) bool
	PixelHTML    func(url string) string
}

func CheckMarkersGolden(names []string, read func(string) ([]byte, error), runner MarkersRunner) (Outcome, error) {
	outcome := Outcome{}
	for _, name := range names {
		raw, err := read(name)
		if err != nil {
			return Outcome{}, fmt.Errorf("%s: %w", name, err)
		}
		var fixture markerFixture
		if err := json.Unmarshal(raw, &fixture); err != nil {
			return Outcome{}, fmt.Errorf("%s: %w", name, err)
		}
		outcome.Total++

		out, count, err := runner.ReplaceLinks(fixture.Source, func(linkID string) (string, error) {
			token, ok := fixture.LinkTokens[linkID]
			if !ok {
				return "", fmt.Errorf("neznámé link_id %s", linkID)
			}
			return fixture.TrackingDomain + "/t/c/" + token, nil
		})
		if err != nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID, "náhrada selhala: " + err.Error()})
			continue
		}
		if count != fixture.ExpectedReplacements {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
				fmt.Sprintf("počet náhrad %d, čekal se %d", count, fixture.ExpectedReplacements)})
			continue
		}
		pixel := ""
		if fixture.OpenToken != nil {
			pixel = runner.PixelHTML(fixture.TrackingDomain + "/t/o/" + *fixture.OpenToken)
		}
		out, _ = runner.ReplacePixel(out, pixel)
		if out != fixture.Expected {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
				fmt.Sprintf("výstup se rozešel s TypeScript stranou\n  Go: %q\n  TS: %q", out, fixture.Expected)})
			continue
		}
		if runner.HasResidual(out) {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
				"ve výstupu zůstal vyhrazený řetězec"})
			continue
		}
		outcome.IDs = append(outcome.IDs, fixture.ID)
	}
	return outcome, nil
}

func RunMarkersGolden(t *testing.T, runner MarkersRunner) {
	t.Helper()
	names, err := ListFixtures("markers")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	if len(names) != 10 {
		t.Fatalf("čekám 10 fixtur značek, je jich %d", len(names))
	}
	outcome, err := CheckMarkersGolden(names, func(name string) ([]byte, error) {
		return ReadFixture("markers/" + name)
	}, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "markers", outcome, names)
}
