// Package liquidx je fáze 2 renderu: Liquid interpolace per příjemce.
//
// Balíček je zároveň hranicí výměny knihovny. Kdyby se osteele/liquid vyměnil,
// mění se tenhle balíček a nic jiného. Závazné jsou golden fixtures z
// packages/contracts, ne jména volání knihovny.
//
// Escapování v HTML kontextu NEŘEŠÍ knihovna, ale injektáž filtru při přípravě
// zdroje (viz rewrite.go). Důvod je v plánu, kapitola 1.3: escapování musí proběhnout
// až PO filtrech, injektáž to zaručuje bez závislosti na vnitřnostech knihovny,
// a stejným mechanismem se zavírá i nález K11 o tichém filtru safe.
package liquidx

import (
	"fmt"
	"time"

	"github.com/osteele/liquid"
)

// Options konfigurují engine. Časová zóna se fixuje při vytvoření, protože
// filtr date v Go nedostane bindings a _context.timezone si přečíst nemůže.
// Předpokládá se, že zóna je konstantní v rámci kampaně.
type Options struct {
	Timezone       string
	MaxOutputBytes int
	RenderTimeout  time.Duration
}

// Výchozí limity podle kontraktu 4.10.2 a části 4b, kapitola 3.6.
const (
	DefaultMaxOutputBytes = 2 * 1024 * 1024
	DefaultRenderTimeout  = 50 * time.Millisecond
)

// Engine renderuje připravený zdroj šablony.
//
// Sender drží jednu sadu per worker, ne per kampaň. Souběžná bezpečnost renderu
// není v knihovně dokumentovaná a jedna sada na worker je bezpečná bez ohledu
// na to, jak se knihovna chová. Při 32 workerech je to paměťově zanedbatelné.
type Engine struct {
	eng  *liquid.Engine
	loc  *time.Location
	opts Options
}

// New vytvoří engine se všemi kontraktními filtry.
//
// Tři volání se schválně NEDĚLAJÍ, protože výchozí chování knihovny je přesně to,
// co kontrakt chce: StrictVariables (chybějící proměnná je prázdný řetězec),
// LaxFilters (neznámý filtr je chyba) a EnableJekyllExtensions.
func New(opts Options) (*Engine, error) {
	if opts.MaxOutputBytes == 0 {
		opts.MaxOutputBytes = DefaultMaxOutputBytes
	}
	if opts.RenderTimeout == 0 {
		opts.RenderTimeout = DefaultRenderTimeout
	}
	loc := time.UTC
	if opts.Timezone != "" {
		l, err := time.LoadLocation(opts.Timezone)
		if err != nil {
			return nil, fmt.Errorf("neznámá časová zóna %q: %w", opts.Timezone, err)
		}
		loc = l
	}
	e := &Engine{eng: liquid.NewEngine(), loc: loc, opts: opts}
	registerFilters(e.eng, loc)
	return e, nil
}

// ErrRenderTimeout znamená překročení 50 ms.
var ErrRenderTimeout = fmt.Errorf("render_timeout")

// ErrOutputTooLarge znamená překročení limitu velikosti výstupu.
var ErrOutputTooLarge = fmt.Errorf("body_too_large")

// Validate ověří, že se zdroj zparsuje. Volá se jednou na kampaň, ne na zprávu.
func (e *Engine) Validate(source string) error {
	_, err := e.eng.ParseTemplate([]byte(source))
	return err
}

// Render vykoná šablonu nad danými daty.
//
// Limit 50 ms se vyhodnocuje po doběhnutí, ne přerušením. Povolený subset nemá
// žádnou neomezenou konstrukci: cyklus jede nad polem oříznutým na 200 prvků,
// vnoření je nejvýš 3 a výstupních výrazů nejvýš 500, takže render nemůže běžet
// neomezeně dlouho a přerušení uprostřed by proti kontrole po doběhnutí nic
// nepřineslo. Pozorovatelné chování, tedy zpráva na failed s render_timeout,
// je v obou případech stejné.
func (e *Engine) Render(source string, bindings map[string]any) (string, error) {
	start := time.Now()
	tpl, err := e.eng.ParseTemplate([]byte(source))
	if err != nil {
		return "", err
	}
	out, err := tpl.Render(bindings)
	if err != nil {
		return "", err
	}
	if len(out) > e.opts.MaxOutputBytes {
		return "", ErrOutputTooLarge
	}
	if time.Since(start) > e.opts.RenderTimeout {
		return "", ErrRenderTimeout
	}
	return string(out), nil
}

// Timezone vrací zónu, na kterou je engine zafixovaný. Cache engine se drží
// podle téhle hodnoty.
func (e *Engine) Timezone() string { return e.loc.String() }
