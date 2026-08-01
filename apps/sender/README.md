# mlain sender

Odesílací komponenta. Samostatná binárka v Go, spouštěná jako `MODE=sender`.
Konzumuje outbox `messages` z PostgreSQL a odesílá přes Amazon SES v2 nebo SMTP.

## Testy

    go test ./...                        jednotkové, bez databáze
    go test -tags=integration ./...      integrační, vyžaduje PostgreSQL 18

Integrační testy potřebují **jedinou** proměnnou:

    DATABASE_URL_MIGRATOR   připojení, kterým se zakládají role a aplikují migrace

Harness je samobootstrapovací: založí roli `mlain_sender`, aplikuje skutečné
migrace z `packages/db/migrations` a připojení senderu si z téhle jediné
proměnné odvodí sám. Testy senderu se nikdy nespouštějí pod migrátorem, protože
by zamaskovaly chybějící politiku `sender_bypass` a claim by v produkci vracel
nula řádků, aniž by cokoliv selhalo. Hlídá to `TestScenariosRunAsSenderRole`.

## Co tenhle adresář vlastní

Schéma databáze vlastní `packages/db` (P03), kontrakt a runnery golden fixtures
`packages/contracts` a `internal/contracts` (P02), modul a obraz P01. Sender
schéma nikdy nemění a fixtures nikdy neupravuje.
