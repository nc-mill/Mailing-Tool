package outbox

import "github.com/google/uuid"

// Rotation je round robin nad seznamem běžících kampaní.
//
// Jedna velká kampaň nesmí vyhladovět ostatní, a zároveň kampaň, které došly
// splatné zprávy, nemá smysl obcházet dokola až do dalšího pollu. Rotace proto
// umí kampaň označit za vyčerpanou; Set ji z vyčerpaných zase uvolní.
type Rotation struct {
	order     []uuid.UUID
	cursor    int
	exhausted map[uuid.UUID]bool
}

// NewRotation vytvoří prázdnou rotaci.
func NewRotation() *Rotation {
	return &Rotation{exhausted: map[uuid.UUID]bool{}}
}

// Set nahradí seznam kampaní čerstvým výsledkem kroku 1 a zapomene, které byly
// vyčerpané. Volá se každých SENDER_POLL_INTERVAL_MS.
func (r *Rotation) Set(campaigns []ActiveCampaign) {
	r.order = r.order[:0]
	for _, c := range campaigns {
		r.order = append(r.order, c.ID)
	}
	r.exhausted = map[uuid.UUID]bool{}
	if r.cursor >= len(r.order) {
		r.cursor = 0
	}
}

// Exhaust vyřadí kampaň z rotace do dalšího pollu. Volá se, když claim vrátil
// nula řádků.
func (r *Rotation) Exhaust(id uuid.UUID) { r.exhausted[id] = true }

// Next vrací další kampaň k odbavení. Druhá návratová hodnota je false, když
// nezbývá žádná nevyčerpaná kampaň.
func (r *Rotation) Next() (uuid.UUID, bool) {
	if len(r.order) == 0 {
		return uuid.Nil, false
	}
	for i := 0; i < len(r.order); i++ {
		if r.cursor >= len(r.order) {
			r.cursor = 0
		}
		id := r.order[r.cursor]
		r.cursor++
		if !r.exhausted[id] {
			return id, true
		}
	}
	return uuid.Nil, false
}

// Len vrací počet kampaní v rotaci včetně vyčerpaných.
func (r *Rotation) Len() int { return len(r.order) }
