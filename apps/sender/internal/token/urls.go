package token

import "strings"

// URLs skládá veřejné adresy z TRACKING_DOMAIN.
//
// Cesty /t/o/, /t/c/, /u/ a /p/ jsou dané specifikacemi částí 5 a 2.
//
// POZOR na /v/: cestu pro webview NEURČUJE žádná specifikace. Sender ji přesto
// potřebuje, protože {{ webview_url }} je kořenová proměnná, kterou podle kontraktu
// staví on. Plán P09 ji tímhle zavádí jako /v/<token> a je to jediné místo, kde si
// sender určuje veřejnou cestu sám. Je to zapsané jako požadavek na P07 v kapitole 31.
type URLs struct {
	TrackingDomain string
}

func (u URLs) base() string { return strings.TrimRight(u.TrackingDomain, "/") }

// Open je adresa open pixelu.
func (u URLs) Open(tok string) string { return u.base() + "/t/o/" + tok }

// Click je adresa přesměrování prokliku.
func (u URLs) Click(tok string) string { return u.base() + "/t/c/" + tok }

// Unsubscribe je adresa odhlášení. Tentýž řetězec jde do těla zprávy i do
// hlavičky List-Unsubscribe, viz AK-6.18.
func (u URLs) Unsubscribe(tok string) string { return u.base() + "/u/" + tok }

// Preferences je adresa stránky s předvolbami.
func (u URLs) Preferences(tok string) string { return u.base() + "/p/" + tok }

// Webview je adresa zobrazení kampaně v prohlížeči.
func (u URLs) Webview(tok string) string { return u.base() + "/v/" + tok }

// TestUnsubscribe je pevná stránka pro testovací odeslání, u kterého nejde
// sestavit token, protože chybí contact_id. Hlavička List-Unsubscribe-Post se
// u ní nepřidává, aby si poštovní klient nemyslel, že jde o funkční one-click.
func (u URLs) TestUnsubscribe() string { return u.base() + "/u/test" }
