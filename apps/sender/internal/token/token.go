// Package token vyrábí trackovací tokeny podle kontraktu 3 z části 1, kapitola 4.10.3.
//
// Sender vyrábí typy o (open), c (click) a u (unsubscribe). Typ i (identity) vyrábí
// aplikace, protože potřebuje mechanismus jednorázových nonce, který sender nemá.
// Sender token nikdy nezapisuje do databáze ani do logu.
package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
)

const (
	// Prefix je čitelná značka verze formátu. Budoucí formát bude "t2".
	Prefix = "t1"
	// macInputPrefix je zmrazený navždy. Jeho změna zneplatní každý pixel
	// a každý proklik ve všech už odeslaných kampaních.
	macInputPrefix = "mailer/token/v1"
	macLen         = 16
)

// Typy tokenů. Znak je ASCII, ne číslo.
const (
	TypeOpen        byte = 'o'
	TypeClick       byte = 'c'
	TypeUnsubscribe byte = 'u'
)

// Builder vyrábí tokeny aktuálním pokolením klíče.
type Builder struct {
	keyID  byte
	macKey []byte
}

// NewBuilder odvodí HMAC klíč z aktuálního pokolení keyringu.
func NewBuilder(kr *keyring.Keyring) (*Builder, error) {
	k, err := kr.Derive(keyring.PurposeTrackingToken)
	if err != nil {
		return nil, fmt.Errorf("odvození klíče pro tokeny selhalo: %w", err)
	}
	return &Builder{keyID: kr.Current().ID, macKey: k}, nil
}

func u32Seconds(t time.Time) uint32 { return uint32(t.UTC().Unix()) }

func payloadOpen(workspaceID, messageID uuid.UUID, createdAt time.Time) []byte {
	p := make([]byte, 0, 36)
	p = append(p, workspaceID[:]...)
	p = append(p, messageID[:]...)
	p = binary.BigEndian.AppendUint32(p, u32Seconds(createdAt))
	return p
}

func payloadClick(workspaceID, messageID, linkID uuid.UUID, createdAt time.Time) []byte {
	p := make([]byte, 0, 52)
	p = append(p, workspaceID[:]...)
	p = append(p, messageID[:]...)
	p = append(p, linkID[:]...)
	p = binary.BigEndian.AppendUint32(p, u32Seconds(createdAt))
	return p
}

func payloadUnsubscribe(workspaceID, messageID, contactID, listID uuid.UUID, createdAt time.Time) []byte {
	p := make([]byte, 0, 68)
	p = append(p, workspaceID[:]...)
	p = append(p, messageID[:]...)
	p = append(p, contactID[:]...)
	p = append(p, listID[:]...)
	p = binary.BigEndian.AppendUint32(p, u32Seconds(createdAt))
	return p
}

// fullMAC vrací celé HMAC-SHA256 před zkrácením. Existuje kvůli ladění
// a kvůli kontraktním vektorům, které plné HMAC uvádějí.
func (b *Builder) fullMAC(typ byte, payload []byte) ([]byte, error) {
	m := hmac.New(sha256.New, b.macKey)
	m.Write([]byte(macInputPrefix))
	m.Write([]byte{typ, b.keyID})
	m.Write(payload)
	return m.Sum(nil), nil
}

// assembleWith složí tělo tokenu z už spočítané plné HMAC. Je to JEDINÉ místo,
// kde se token skládá: dvě cesty skládání by se rozešly přesně v tom bajtu,
// o kterém by nikdo nevěděl.
func (b *Builder) assembleWith(typ byte, payload, full []byte) (string, error) {
	body := make([]byte, 0, 2+len(payload)+macLen)
	body = append(body, typ, b.keyID)
	body = append(body, payload...)
	body = append(body, full[:macLen]...)
	return Prefix + base64.RawURLEncoding.EncodeToString(body), nil
}

// assembleWithMAC je jádro, které dosud plnou HMAC zahazovalo uvnitř assemble.
func (b *Builder) assembleWithMAC(typ byte, payload []byte) (string, []byte, error) {
	full, err := b.fullMAC(typ, payload)
	if err != nil {
		return "", nil, err
	}
	tok, err := b.assembleWith(typ, payload, full)
	if err != nil {
		return "", nil, err
	}
	return tok, full, nil
}

func (b *Builder) assemble(typ byte, payload []byte) (string, error) {
	tok, _, err := b.assembleWithMAC(typ, payload)
	return tok, err
}

// Open vyrobí token pro sledování otevření.
func (b *Builder) Open(workspaceID, messageID uuid.UUID, messageCreatedAt time.Time) (string, error) {
	return b.assemble(TypeOpen, payloadOpen(workspaceID, messageID, messageCreatedAt))
}

// Click vyrobí token pro sledování prokliku jednoho odkazu.
func (b *Builder) Click(workspaceID, messageID, linkID uuid.UUID, messageCreatedAt time.Time) (string, error) {
	return b.assemble(TypeClick, payloadClick(workspaceID, messageID, linkID, messageCreatedAt))
}

// Unsubscribe vyrobí token pro odhlášení. Nulové listID znamená globální odhlášení,
// ne odhlášení ze seznamu.
func (b *Builder) Unsubscribe(workspaceID, messageID, contactID, listID uuid.UUID, messageCreatedAt time.Time) (string, error) {
	return b.assemble(TypeUnsubscribe, payloadUnsubscribe(workspaceID, messageID, contactID, listID, messageCreatedAt))
}

// OpenWithMAC vrací token i plnou HMAC před zkrácením. Kontrakt plnou hodnotu
// v tabulce vektorů uvádí jako závaznou, takže ji golden runner porovnává.
func (b *Builder) OpenWithMAC(workspaceID, messageID uuid.UUID, messageCreatedAt time.Time) (string, []byte, error) {
	return b.assembleWithMAC(TypeOpen, payloadOpen(workspaceID, messageID, messageCreatedAt))
}

// ClickWithMAC vrací token prokliku i plnou HMAC před zkrácením.
func (b *Builder) ClickWithMAC(workspaceID, messageID, linkID uuid.UUID, messageCreatedAt time.Time) (string, []byte, error) {
	return b.assembleWithMAC(TypeClick, payloadClick(workspaceID, messageID, linkID, messageCreatedAt))
}

// UnsubscribeWithMAC vrací odhlašovací token i plnou HMAC před zkrácením.
func (b *Builder) UnsubscribeWithMAC(workspaceID, messageID, contactID, listID uuid.UUID, messageCreatedAt time.Time) (string, []byte, error) {
	return b.assembleWithMAC(TypeUnsubscribe, payloadUnsubscribe(workspaceID, messageID, contactID, listID, messageCreatedAt))
}
