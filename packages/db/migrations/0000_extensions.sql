-- mlain:timeout=120

-- citext: jen pro e-mailové adresy. Porovnání adres musí být necitlivé na
-- velikost písmen v databázi, protože porovnávají dvě aplikace a jedna je v Go.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
-- pg_trgm: hledání kontaktu podle části jména nebo adresy. Bez něj je hledání
-- "nov" nad pěti miliony řádků seq scan v řádu sekund, a je to nejčastější
-- operace v celém nástroji. Požadavek části 2, kapitola 11.1, bod 1.1.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- btree_gin: aby šlo workspace_id (uuid) do stejného GIN indexu jako trigramy.
-- Bez něj by hledání procházelo cizí projekty a teprve pak je zahodilo.
-- Požadavek části 2, kapitola 11.1, bod 1.2.
CREATE EXTENSION IF NOT EXISTS btree_gin;
