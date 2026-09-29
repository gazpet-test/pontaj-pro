-- Extensie a fixture-ului R5. Tabele sintetice; controalele și triggerele sunt SQL-ul real din repo.
ALTER TABLE ofertare_cerinte ADD COLUMN IF NOT EXISTS duplicat_al bigint, ADD COLUMN IF NOT EXISTS tip text DEFAULT 'propunere', ADD COLUMN IF NOT EXISTS text_cerinta text;
ALTER TABLE ofertare_acoperire ADD COLUMN verificat_pe_scan boolean DEFAULT false, ADD COLUMN reverificare_ceruta boolean DEFAULT false;
ALTER TABLE ofertare_pt_pachet ADD COLUMN versiune integer NOT NULL DEFAULT 1 CHECK (versiune>=1),
  ADD COLUMN aprobat_de uuid REFERENCES profiles(id), ADD COLUMN aprobat_la timestamptz,
  ADD COLUMN depus_la timestamptz, ADD COLUMN nota text, ADD COLUMN grafic_versiune int,
  ADD COLUMN pt_poarta_id bigint, ADD COLUMN creat_de uuid DEFAULT auth.uid(), ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD UNIQUE(licitatie_id,versiune),
  ADD CHECK (stare IN ('propus','aprobat','depus')),
  ADD CHECK (stare='propus' OR (stare='aprobat' AND aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL)
    OR (stare='depus' AND aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL AND depus_la IS NOT NULL));
CREATE TABLE ofertare_pt_poarta (id bigint PRIMARY KEY, licitatie_id bigint, versiune int, verdict text);
CREATE TABLE ofertare_pt_capitole (
  id bigint PRIMARY KEY, licitatie_id bigint REFERENCES ofertare_licitatii(id), nr smallint CHECK(nr BETWEEN 1 AND 40),
  titlu text NOT NULL, eticheta text, formular text, continut text, fisier_path text,
  obligatoriu boolean NOT NULL DEFAULT true, stare text NOT NULL DEFAULT 'scris', sursa text NOT NULL DEFAULT 'om',
  versiune int NOT NULL DEFAULT 1, UNIQUE(licitatie_id,nr));
CREATE TABLE ofertare_pt_capitole_versiuni (
  id bigserial PRIMARY KEY, capitol_id bigint, versiune int, titlu text, continut text, fisier_path text,
  sursa text, stare text, schimbat_de uuid, UNIQUE(capitol_id,versiune));
CREATE TABLE ofertare_pt_legaturi (id bigint PRIMARY KEY, cerinta_id bigint REFERENCES ofertare_cerinte(id),
  capitol_id bigint REFERENCES ofertare_pt_capitole(id), fel text DEFAULT 'capitol', stare text DEFAULT 'verificata',
  verificat_la_versiunea int DEFAULT 1, confirmat_de uuid DEFAULT auth.uid(), confirmat_la timestamptz DEFAULT now(), constatare text,
  CHECK(stare IN ('atribuita','redactata','dovedita','verificata','blocata')),
  CHECK((stare<>'verificata' OR (confirmat_de IS NOT NULL AND confirmat_la IS NOT NULL AND verificat_la_versiunea IS NOT NULL))
    AND (stare<>'blocata' OR btrim(coalesce(constatare,''))<>'')));
CREATE TABLE ofertare_pt_observatii (id bigint PRIMARY KEY, licitatie_id bigint, stare text);
CREATE VIEW v_ofertare_pt_conformitate WITH(security_invoker=on) AS SELECT NULL::bigint licitatie_id,NULL::text verdict WHERE false;
CREATE TABLE grafic_parametri (licitatie_id bigint PRIMARY KEY, parametri jsonb);
CREATE TABLE grafic_versiuni (id bigserial PRIMARY KEY, licitatie_id bigint REFERENCES ofertare_licitatii(id),
  versiune int NOT NULL, activitati jsonb, poarta jsonb DEFAULT '[]', mod text DEFAULT 'oferta', UNIQUE(licitatie_id,versiune));
CREATE TABLE ofertare_pt_garantie (licitatie_id bigint PRIMARY KEY, cerut_luni int, oferit_luni int,
  cerut_moment text, oferit_moment text, confirmat_de uuid, justificare text);
CREATE TABLE ofertare_pt_anexe_asteptate (id bigint PRIMARY KEY, licitatie_id bigint, ref text);
CREATE TRIGGER trg_pt_capitole_versioneaza BEFORE UPDATE ON ofertare_pt_capitole FOR EACH ROW EXECUTE FUNCTION fn_pt_capitol_versioneaza();
CREATE TRIGGER trg_pt_invalideaza BEFORE UPDATE ON ofertare_cerinte FOR EACH ROW EXECUTE FUNCTION fn_pt_invalideaza_la_inlocuire();
