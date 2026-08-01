// Package keyring drží klíčový materiál senderu a odvozuje z něj klíče pro
// jednotlivé účely podle kontraktu z části 1, kapitola 3.10.
//
// Sender drží CELÝ keyring, ne jen aktuální klíč. Kromě dešifrování konfigurace
// providera ho potřebuje na otisky adres při dávkové kontrole suppression, a ty
// se počítají pro VŠECHNA známá pokolení klíče. Strop na počet pokolení neexistuje
// a nesmí se zavést ani jako validace: otisk smazané adresy nejde nikdy přepočítat,
// protože plaintext je po výmazu podle GDPR pryč, takže by vyčerpaný strop znamenal,
// že se smazaný člověk vrátí prvním dalším importem, aniž by cokoliv selhalo.
package keyring

import (
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Purposes jsou zmrazené navždy a nejsou to jména produktu. Při přejmenování
// produktu se NEMĚNÍ, protože otisky v suppression listu jdou ověřit jen tímtéž
// receptem, jakým vznikly, a přepočítat je nelze.
const (
	Salt = "mailer/v1"

	PurposeTrackingToken          = "mailer/v1/tracking-token"
	PurposeCredentialEncryption   = "mailer/v1/credential-encryption"
	PurposeSecretKeyFingerprint   = "mailer/v1/secret-key-fingerprint"
	PurposeSuppressionFingerprint = "mailer/v1/suppression-fingerprint"
)

// Key je jedno pokolení klíče.
type Key struct {
	ID       byte
	Material []byte
}

// String a MarshalJSON jsou přetížené, aby se klíč nemohl dostat do logu omylem.
func (k Key) String() string               { return fmt.Sprintf("Key{ID:%d, Material:[redacted]}", k.ID) }
func (k Key) MarshalJSON() ([]byte, error) { return []byte(`"[redacted]"`), nil }

// Keyring je aktuální klíč plus všechna předchozí pokolení.
type Keyring struct {
	current Key
	byID    map[byte]Key
}

// Parse načte SECRET_KEY a SECRET_KEY_PREVIOUS.
//
// SECRET_KEY přijímá obě podoby, které se v části 1 vyskytují: čistý <base64url>
// i <key_id>:<base64url>. Rozpor je zapsaný jako P1.13 a není rozhodnutý; parser,
// který přijme obojí, je správný v obou případech.
func Parse(secretKey, previous string) (*Keyring, error) {
	cur, err := parseEntry(secretKey, 1)
	if err != nil {
		return nil, fmt.Errorf("SECRET_KEY: %w", err)
	}
	kr := &Keyring{current: cur, byID: map[byte]Key{cur.ID: cur}}

	for _, raw := range strings.Split(previous, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if !strings.Contains(raw, ":") {
			return nil, fmt.Errorf("SECRET_KEY_PREVIOUS: položka %q nemá tvar <key_id>:<base64url>", raw)
		}
		k, err := parseEntry(raw, 0)
		if err != nil {
			return nil, fmt.Errorf("SECRET_KEY_PREVIOUS: %w", err)
		}
		if _, exists := kr.byID[k.ID]; exists && k.ID != cur.ID {
			return nil, fmt.Errorf("SECRET_KEY_PREVIOUS: key_id %d je uvedený dvakrát", k.ID)
		}
		if k.ID != cur.ID {
			kr.byID[k.ID] = k
		}
	}
	return kr, nil
}

func parseEntry(raw string, defaultID byte) (Key, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Key{}, fmt.Errorf("prázdná hodnota")
	}
	id := defaultID
	material := raw
	if i := strings.Index(raw, ":"); i >= 0 {
		n, err := strconv.Atoi(raw[:i])
		if err != nil {
			return Key{}, fmt.Errorf("%q není platné key_id", raw[:i])
		}
		if n < 1 || n > 255 {
			return Key{}, fmt.Errorf("key_id %d je mimo rozsah 1 až 255, formát nese key_id v jednom bajtu", n)
		}
		id = byte(n)
		material = raw[i+1:]
	}
	if id == 0 {
		return Key{}, fmt.Errorf("key_id chybí a nemá výchozí hodnotu")
	}
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(material, "="))
	if err != nil {
		return Key{}, fmt.Errorf("hodnota není base64url: %w", err)
	}
	if len(b) != 32 {
		return Key{}, fmt.Errorf("klíč se dekóduje na %d bajtů, kontrakt vyžaduje přesně 32", len(b))
	}
	return Key{ID: id, Material: b}, nil
}

// Current vrací aktuální klíč, kterým se podepisují nové tokeny.
func (kr *Keyring) Current() Key { return kr.current }

// ByID vrací pokolení podle identifikátoru z tokenu nebo ze šifrové obálky.
func (kr *Keyring) ByID(id byte) (Key, bool) {
	k, ok := kr.byID[id]
	return k, ok
}

// All vrací všechna pokolení v deterministickém pořadí podle key_id vzestupně.
// Determinismus je důležitý, protože pole otisků jde do SQL dotazu a testy ho
// porovnávají.
func (kr *Keyring) All() []Key {
	out := make([]Key, 0, len(kr.byID))
	for _, k := range kr.byID {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// DeriveFor odvodí klíč daného účelu z konkrétního pokolení.
func (kr *Keyring) DeriveFor(id byte, purpose string) ([]byte, error) {
	k, ok := kr.byID[id]
	if !ok {
		return nil, fmt.Errorf("crypto_unknown_key")
	}
	return hkdf.Key(sha256.New, k.Material, []byte(Salt), purpose, 32)
}

// Derive odvodí klíč daného účelu z aktuálního pokolení.
func (kr *Keyring) Derive(purpose string) ([]byte, error) {
	return kr.DeriveFor(kr.current.ID, purpose)
}

// SuppressionFingerprints spočítá otisk adresy pro VŠECHNA známá pokolení klíče.
//
// Recept je z části 2, kapitola 3.5:
//
//	HMAC-SHA256(HKDF(SECRET_KEY, "mailer/v1", "mailer/v1/suppression-fingerprint"), lower(email))
//
// Pořadí odpovídá All(), tedy vzestupně podle key_id.
func (kr *Keyring) SuppressionFingerprints(email string) ([][]byte, error) {
	normalized := []byte(strings.ToLower(strings.TrimSpace(email)))
	keys := kr.All()
	out := make([][]byte, 0, len(keys))
	for _, k := range keys {
		mk, err := hkdf.Key(sha256.New, k.Material, []byte(Salt), PurposeSuppressionFingerprint, 32)
		if err != nil {
			return nil, err
		}
		m := hmac.New(sha256.New, mk)
		m.Write(normalized)
		out = append(out, m.Sum(nil))
	}
	return out, nil
}
