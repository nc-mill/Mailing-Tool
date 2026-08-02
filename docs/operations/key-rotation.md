# Rotace šifrovacího klíče

Provozní runbook. Postup je totožný s výpisem příkazu `mlain genkey`, tenhle
dokument ho doplňuje o to, co se z výpisu nevejde.

## Postup

```bash
# 1. Vygeneruj nové pokolení klíče.
docker compose exec app mlain genkey
```

Výpis obsahuje nový klíč ve tvaru `<id>:<base64>` a přesné pořadí dalších kroků.

```bash
# 2. Do konfigurace zapiš NOVÝ klíč jako SECRET_KEY a STARÝ přesuň
#    na začátek SECRET_KEY_PREVIOUS (čárkou oddělený seznam).
# 3. Restartuj VŠECHNY procesy: web, worker i sender.
docker compose up -d --force-recreate

# 4. Přešifruj uložené obálky na aktuální pokolení.
docker compose exec app mlain rotate-credentials

# 5. Ověř.
docker compose exec app mlain doctor
```

## Pořadí kroků 2 a 3 se nesmí prohodit

Kdyby se restart udělal dřív, než je nový klíč v konfiguraci, běží procesy dál
se starým klíčem. Jenže konfigurace, kterou mezitím zapíše web, je zašifrovaná
**novým** klíčem, a sender ji přečíst nedokáže. Každé dešifrování selže.

U kampaně na milion příjemců to znamená **milion zpráv označených jako
neúspěšné**, protože sender nemá jak získat přístupové údaje k providerovi.
Chyba se navíc projeví až ve chvíli odesílání, ne při restartu.

## `SECRET_KEY_PREVIOUS` se nikdy nevyprazdňuje

Ani po `mlain rotate-credentials`. Rotace přešifruje **obálky** uložených
přístupů, ale otisky smazaných adres v `suppressions` se přepočítat nedají:
otisk je jednosměrný a původní adresa už v systému není. Otisky se proto počítají
a porovnávají **pod všemi známými pokoleními**, bez horního stropu.

Vyprázdněný `SECRET_KEY_PREVIOUS` znamená, že se smazaní lidé přestanou poznávat.
Import proběhne úspěšně, nikde se nic nezaloguje a člověk, který si odesílání
zakázal, ho dostane znovu. `mlain doctor` tenhle stav hlásí jako **kritický** pod
označením `missing_key_generations`.

## Po ztrátě klíče

`mlain doctor` ztrátu pozná: najde v datech `key_id`, ke kterému nemá klíč, a
skončí návratovým kódem 2.

Jediná oprava je:

1. zadat znovu **přístupy k providerům odesílání** (SMTP, SES a další),
2. zadat znovu **AI klíče**,
3. smířit se s tím, že **trackovací tokeny ze starých kampaní přestanou platit**;
   odkazy v už odeslaných e-mailech skončí na stránce „odkaz vypršel",
4. doplnit chybějící pokolení do `SECRET_KEY_PREVIOUS`, pokud se klíč ještě někde
   najde. Tohle je jediný krok, který ztrátu opravdu vrátí zpět.

Data kontaktů, kampaní ani reportů ztracená nejsou: šifrované jsou jen obálky
přístupů a otisky, ne obsah.
