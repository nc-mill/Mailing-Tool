-- Fáze 2 dvoufázového zakládání cyklu mezi templates a template_versions.
-- Pojmenovaný constraint je povinný: bez ADD CONSTRAINT <jméno> by si ho
-- Postgres pojmenoval sám a příští migrace by ho nedokázala spolehlivě adresovat.
ALTER TABLE templates
  ADD CONSTRAINT fk_templates__current_version
  FOREIGN KEY (current_version_id) REFERENCES template_versions(id) ON DELETE SET NULL;
