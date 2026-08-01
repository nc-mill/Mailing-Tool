package campaign

import (
	"strconv"
	"sync"
)

// Cache drží připravené hlavičky kampaní podle dvojice (campaign_id, revision).
//
// Klíč nese revizi, takže cache NEPOTŘEBUJE TTL a nemůže zastarat: revision se
// inkrementuje při každé změně kterékoliv zmrazené vlastnosti kampaně a sender
// ho čte krokem 1 claimu, který na campaigns stejně sahá.
type Cache struct {
	mu     sync.RWMutex
	load   func(id string) (*Raw, error)
	items  map[string]*entry
	failed map[string]error
}

type entry struct {
	revision int32
	header   *Header
}

// NewCache vytvoří cache nad funkcí, která načte hlavičku z databáze.
func NewCache(load func(id string) (*Raw, error)) *Cache {
	return &Cache{load: load, items: map[string]*entry{}, failed: map[string]error{}}
}

// Get vrátí připravenou hlavičku. Načte ji jen tehdy, když ji nemá, nebo když
// se změnila revize.
//
// Chyba validace se zapamatuje, aby se u pozastavené kampaně nezkoušela kontrola
// znovu při každém tiku. Zapomene se při změně revize, tedy když někdo šablonu
// opravil a kampaň znovu odeslal.
func (c *Cache) Get(campaignID string, revision int32) (*Header, error) {
	c.mu.RLock()
	if e, ok := c.items[campaignID]; ok && e.revision == revision {
		c.mu.RUnlock()
		return e.header, nil
	}
	if err, ok := c.failed[key(campaignID, revision)]; ok {
		c.mu.RUnlock()
		return nil, err
	}
	c.mu.RUnlock()

	raw, err := c.load(campaignID)
	if err != nil {
		return nil, err
	}
	header, err := PrepareHeader(raw)
	if err != nil {
		c.mu.Lock()
		c.failed[key(campaignID, revision)] = err
		c.mu.Unlock()
		return nil, err
	}

	c.mu.Lock()
	c.items[campaignID] = &entry{revision: revision, header: header}
	delete(c.failed, key(campaignID, revision))
	c.mu.Unlock()
	return header, nil
}

// Forget zahodí záznam kampaně. Volá se po jejím pozastavení.
func (c *Cache) Forget(campaignID string) {
	c.mu.Lock()
	delete(c.items, campaignID)
	c.mu.Unlock()
}

func key(id string, revision int32) string {
	return id + "@" + strconv.FormatInt(int64(revision), 10)
}
