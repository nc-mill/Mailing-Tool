-- Řádek zakládá migrace, ne aplikace: migrační runner na něj zapisuje
-- schema_version hned v prvním běhu a downgrade guard z něj čte.
--
-- secret_key_fingerprint zůstává prázdný, protože migrace SECRET_KEY nezná
-- a znát nemá. Doplní ho POST /api/v1/setup (P04). Prázdná hodnota tak znamená
-- "instalace ještě neproběhla" a mlain doctor (P16) na ni má dosah.
INSERT INTO system_settings (id, schema_version, secret_key_fingerprint)
VALUES (true, 0, '')
ON CONFLICT (id) DO NOTHING;
