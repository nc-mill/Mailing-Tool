-- mlain:timeout=120

-- ===========================================================================
-- Nové druhy zprávy v outboxu: transactional a automation.
--
-- PROČ OBĚ NAJEDNOU. Transakční pošta přes API (`{{ data.reset_url }}` v tlačítku)
-- a automatizace (plán P17) potřebují každá vlastní hodnotu `messages.kind`
-- ze stejného důvodu: jsou to zprávy mimo kampaň, které nesmí spadnout pod
-- `kind = 'test'`. Test nese hlavičku `X-Mlain-Test: 1`, má vlastní větev
-- odhlašovacího odkazu a v reportech se počítá jako testovací.
--
-- Dvě nezávislé migrace téhož CHECKu by se srazily a druhá by musela znát
-- znění první. Rozhodnutí zadavatele z 5. 8. 2026: jedna migrace, obě hodnoty.
--
-- CO SE TÍM NEMĚNÍ. Význam `campaign` ani `test` zůstává. Generovaný sloupec
-- `audience_campaign_id` počítá `CASE WHEN kind = 'campaign' THEN campaign_id END`,
-- takže nová hodnota má NULL a cizí klíč `fk_messages__campaign_audience` se
-- podle MATCH SIMPLE přeskočí, stejně jako u testu. Částečný unikátní index
-- `uq_messages__campaign_contact` je taky vázaný na `kind = 'campaign'`, takže
-- dva resety hesla na tutéž adresu ve stejném měsíci se o sebe nezavadí.
--
-- Kontrakt 4.10.1 povoluje přidávat sloupce a indexy, omezení ne. Změna omezení
-- je tady VĚDOMÁ: bez ní nejde transakční zprávu do outboxu vůbec vložit.
--
-- Rozšíření výčtu je striktní nadmnožina, takže žádný existující řádek novou
-- podmínku porušit nemůže. Validační sken přesto proběhne, proto timeout 120.
-- ===========================================================================
ALTER TABLE messages DROP CONSTRAINT IF EXISTS ck_messages__kind;
--> statement-breakpoint
ALTER TABLE messages
  ADD CONSTRAINT ck_messages__kind
  CHECK (kind IN ('campaign','test','transactional','automation'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Index pro claim ne-kampaňových zpráv.
--
-- Ne-kampaňové druhy se claimují vlastní smyčkou napříč kampaněmi, tedy bez
-- `campaign_id` ve WHERE. Bez tohohle indexu by každý tik té smyčky, a ten je
-- řádově sekundový, prošel všechny partition tabulky messages.
--
-- Částečný přes `status = 'pending'`: claim se ptá výhradně na splatné čekající
-- zprávy a odeslaných je v tabulce o řády víc.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages__non_campaign_claim
  ON messages (next_attempt_at, id)
  WHERE status = 'pending' AND kind <> 'campaign';
