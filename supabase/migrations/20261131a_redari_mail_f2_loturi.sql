-- Baseline unic: Claude completează din citiri live și revizuiește callee-urile
-- tranzitive (inclusiv PL/pgSQL, pe care pg_depend NU le descoperă complet).
-- Manifestul conservator include TOATE obiectele public/auth/storage: închiderea
-- tranzitivă în aceste scheme este acoperită fără parsare regex a SQL-ului.
-- Callee în alte scheme / EXECUTE dinamic / search_path moștenit: refuz la review,
-- nu se completează certificarea până la eliminarea lor sau inventarierea explicită.
CREATE OR REPLACE FUNCTION pg_temp.f2_preflight() RETURNS void LANGUAGE plpgsql AS $gate$
DECLARE
  -- Baseline live recitit 06.11.2026 după #998/#1003/#1002 aplicate (Claude, READ ONLY REPEATABLE READ, exact interogările de mai jos;
  -- revizie callee refăcută: triggerele noi 31c/31d pe red_convocari/red_proiecte fără EXECUTE, search_path fix). Relatii/triggere
  -- după amprenta fără OID-uri, r4). Revizie callee: funcțiile
  -- din inventar + toate triggerele de pe red_convocari/red_proiecte/red_mail_setari/red_mail_evenimente/red_jurnal/red_numere/
  -- red_detinatori(_contact): fără EXECUTE dinamic, search_path fix, apeluri doar public/auth; singurul callee extern
  -- (extensions.gen_random_bytes în fn_red_detinatori_token_dupa) stă pe red_detinatori, pe care migrarea NU o scrie.
  baseline constant jsonb := '{"functii":"d9cc4d51e3f971c6731bf7bbe4c1992f","relatii":"34d6b65a681265788869264639d4eed7","triggere":"efcb21e9d38c806c9e43f4efc4fc081f","revizie_callee":"revizuit_fara_dynamic_sau_callee_externe"}';
  r record; obiecte jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('auth.uid()','uuid'),('auth.role()','text'),('auth.jwt()','jsonb'),
    ('public.fn_sms_e_owner()','boolean'),('public.fn_red_nivel()','text'),
    ('public.fn_red_jurnal()','trigger'),('public.fn_red_jurnal_imuabil()','trigger'),
    ('public.fn_red_versiune_creste()','trigger'),
    ('public.fn_red_informare_publicata(text)','boolean'),
    ('public.fn_red_mail_setari_reguli()','trigger'),
    ('public.fn_red_mail_evenimente_reguli()','trigger'),
    ('public.fn_red_convocari_informare_garda()','trigger'),
    ('public.fn_red_autorizare_tgz_garda()','trigger')
  ) v(sig,ret) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(r.sig)
      AND prorettype=to_regtype(r.ret) AND NOT proretset) THEN
      RAISE EXCEPTION 'F2 L15: functie absenta / semnatura diferita % -> %',r.sig,r.ret;
    END IF;
  END LOOP;
  -- Coloane utilizate direct; restul coloanelor, ACL, politici, secvențe și
  -- constrângeri sunt incluse integral în amprenta relațiilor de mai jos.
  FOR r IN SELECT key AS tabela,value AS coloane FROM jsonb_each('{
    "public.profiles":{"id":"uuid","is_owner":"boolean"},
    "public.red_proiecte":{"id":"uuid","cod":"text","activ":"boolean","retentie_mail_pana":"date","autorizare_tgz_nr":"text","autorizare_tgz_data":"date","autorizare_tgz_fisier":"text","autorizare_tgz_obiect":"uuid","autorizare_tgz_etag":"text"},
    "public.red_uat":{"id":"uuid","proiect_id":"uuid"},
    "public.red_parcele":{"id":"uuid","proiect_id":"uuid","uat_id":"uuid","sters_la":"timestamp with time zone"},
    "public.red_detinatori":{"id":"uuid","parcela_id":"uuid","nume":"text","sters_la":"timestamp with time zone"},
    "public.red_detinatori_contact":{"detinator_id":"uuid","email":"text"},
    "public.red_convocari":{"id":"uuid","detinator_id":"uuid","canal":"text","stare":"text","sters_la":"timestamp with time zone","fisier_convocator_path":"text"},
    "public.red_numere":{"cheie":"text","ultimul":"integer"},
    "public.red_mail_setari":{"id":"smallint","versiune":"integer"},
    "public.red_mail_primite":{"id":"uuid"},
    "public.red_mail_evenimente":{"id":"bigint","tip":"text","cod":"text","obiect_id":"uuid","autor":"uuid","creat_la":"timestamp with time zone"},
    "public.red_jurnal":{"id":"bigint"},
    "storage.objects":{"id":"uuid","bucket_id":"text","name":"text","owner_id":"text","metadata":"jsonb"}
  }'::jsonb) LOOP
    IF to_regclass(r.tabela) IS NULL THEN RAISE EXCEPTION 'F2 L15: tabela absenta %',r.tabela; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each_text(r.coloane) c WHERE NOT EXISTS
      (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(r.tabela)
       AND a.attname=c.key AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid=to_regtype(c.value))) THEN
      RAISE EXCEPTION 'F2 L15: coloana absenta / tip diferit %',r.tabela;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('public.red_convocari','trg_red_convocari_informare','public.fn_red_convocari_informare_garda()'),
    ('public.red_proiecte','trg_red_autorizare_tgz','public.fn_red_autorizare_tgz_garda()'),
    ('public.red_mail_setari','trg_red_mail_setari_reguli','public.fn_red_mail_setari_reguli()'),
    ('public.red_mail_evenimente','trg_red_mail_evenimente_reguli','public.fn_red_mail_evenimente_reguli()')
  ) v(tabela,nume,fn) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(r.tabela)
      AND tgname=r.nume AND tgfoid=to_regprocedure(r.fn) AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'F2 L15: trigger absent / diferit %.%',r.tabela,r.nume;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(baseline) WHERE value='PLACEHOLDER_LIVE')
    OR baseline->>'revizie_callee' IS DISTINCT FROM 'revizuit_fara_dynamic_sau_callee_externe' THEN
    RAISE EXCEPTION 'F2 L15: PLACEHOLDER_LIVE; completare si review Claude obligatorii inainte de DRY';
  END IF;
  SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),
    pg_get_function_result(p.oid),md5(replace(p.prosrc,chr(13),'')),p.prosecdef,
    pg_get_userbyid(p.proowner),p.proconfig,p.proacl,p.provolatile,p.prolang)
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) INTO obiecte
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage');
  IF md5(obiecte::text) IS DISTINCT FROM baseline->>'functii' THEN RAISE EXCEPTION 'F2 L15: baseline functii diferit'; END IF;
  -- Fără OID-uri (r4): identitate pe nume, tipuri / expresii / constrângeri / politici prin forma lor textuală; coloanele „dropped”
  -- nu intră (un DROP COLUMN le lasă în catalog). O revenire care recreează identic obiectele dă aceeași amprentă.
  SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
       a.attacl::text,(SELECT co.collname FROM pg_collation co WHERE co.oid=a.attcollation AND a.attcollation<>0),
       (SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=c.oid AND d.adnum=a.attnum)) ORDER BY a.attname)
       FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    (SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,
       (SELECT array_agg(CASE WHEN rol=0 THEN 'public' ELSE pg_get_userbyid(rol) END ORDER BY 1) FROM unnest(p.polroles) rol),
       pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),
    (SELECT jsonb_agg(jsonb_build_array(k.conname,k.contype,pg_get_constraintdef(k.oid),k.condeferrable,k.condeferred,k.convalidated) ORDER BY k.conname)
       FROM pg_constraint k WHERE k.conrelid=c.oid),
    (SELECT jsonb_build_array(format_type(q.seqtypid,NULL),q.seqstart,q.seqincrement,q.seqmax,q.seqmin,q.seqcache,q.seqcycle)
       FROM pg_sequence q WHERE q.seqrelid=c.oid)) ORDER BY n.nspname,c.relname) INTO obiecte
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage');
  IF md5(obiecte::text) IS DISTINCT FROM baseline->>'relatii' THEN RAISE EXCEPTION 'F2 L15: baseline relatii/coloane/ACL/RLS/politici/secvente diferit'; END IF;
  SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgfoid::regprocedure::text,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid))
    ORDER BY n.nspname,c.relname,t.tgname) INTO obiecte
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth','storage') AND NOT t.tgisinternal;   -- interne = FK (nume cu OID), acoperite de pg_constraint
  IF md5(obiecte::text) IS DISTINCT FROM baseline->>'triggere' THEN RAISE EXCEPTION 'F2 L15: baseline triggere (tgfoid/enabled/WHEN) diferit'; END IF;
END $gate$;
-- Version 20261131120000. Runner: o singură tranzacție; NU se aplică din această sesiune.
-- F2 construit OPRIT. Nu introduce cron, secrete, drepturi de modul sau modificări de date de business.
-- Baseline L15 complet: vezi docs/redari/RAPORT_F2_EMAIL.md; aplicarea cere baseline revizuit separat.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true)
      IS DISTINCT FROM '20261131a_redari_mail_f2_loturi:' || txid_current() THEN
    RAISE EXCEPTION 'F2: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout','500ms',true);
  PERFORM pg_temp.f2_preflight();
  -- Migrarea blochează înaintea preflight-ului (aceeași ordine copii -> părinți ca 30m).
  LOCK TABLE public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_proiecte IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_mail_setari IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.red_mail_evenimente IN ACCESS EXCLUSIVE MODE;
  -- Revalidare sub lock; prima verificare oferă diagnosticul obiectelor absente.
  PERFORM pg_temp.f2_preflight();
  IF to_regclass('public.red_mail_loturi') IS NOT NULL THEN RAISE EXCEPTION 'F2: deja instalat'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_convocari WHERE canal='email') THEN
    RAISE EXCEPTION 'F2: convocari email legacy; necesita decizia owner';
  END IF;
  -- L15: inventar explicit + baseline unic, revizuit offline, NU un GUC calculat pe live.
END $pre$;

ALTER TABLE public.red_mail_evenimente DROP CONSTRAINT red_mail_evenimente_tip_ck;
ALTER TABLE public.red_mail_evenimente ADD CONSTRAINT red_mail_evenimente_tip_ck CHECK (tip IN ('activare', 'ingestie_ok', 'ingestie_neprocesabil', 'deja_golit', 'disparut', 'spam_numarat',
    'dry_rulat', 'recuperare_inceputa', 'recuperare_terminata', 'lease_pierdut', 'eroare_citire', 'descarcare', 'golire', 'blocaj_cerut', 'blocaj_activ',
    'blocaj_ridicat', 'orfane_sterse', 'alerta_de_triat', 'alerta_escaladare', 'oauth_conectat', 'oauth_respins', 'oauth_revocat', 'tombstone_sters',
    'neprocesabil_eliberat', 'eliberare_anulata', 'gmail_trash_inceput', 'gmail_in_cos', 'gmail_trash_ambiguu', 'gmail_de_decis', 'gmail_absent_verificat',
    'gmail_stergere_esuata', 'metoda_nepermisa', 'trash_tardiv', 'alerta_gmail_stergere', 'alerta_dedup_expira', 'tombstone_sters_termen', 'hmac_cheie_retrasa', 'f2'));

ALTER TABLE public.red_mail_setari
  ADD COLUMN trimitere_oprita boolean NOT NULL DEFAULT true,
  ADD COLUMN extern_permis boolean NOT NULL DEFAULT false,
  ADD COLUMN plafon_zi integer NOT NULL DEFAULT 200 CHECK (plafon_zi BETWEEN 1 AND 200),
  ADD COLUMN plafon_luna integer NOT NULL DEFAULT 1000 CHECK (plafon_luna BETWEEN 1 AND 1000),
  ADD COLUMN pauza_pana timestamptz,
  ADD COLUMN ultim_apel_la timestamptz;
-- F2a este inert inclusiv pentru UPDATE direct; F2b va necesita migrare separată.
ALTER TABLE public.red_mail_setari ADD CONSTRAINT red_mail_f2_inert_ck
 CHECK (trimitere_oprita IS TRUE AND extern_permis IS FALSE);

CREATE TABLE public.red_mail_loturi (
  id uuid PRIMARY KEY, -- UUID per intenție, reutilizat după timeout
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  uat_id uuid NOT NULL REFERENCES public.red_uat(id),
  cerere_sha256 text NOT NULL CHECK (cerere_sha256 ~ '^[0-9a-f]{64}$'),
  stare text NOT NULL DEFAULT 'ciorna' CHECK (stare IN ('ciorna','aprobat','in_trimitere','blocat_integritate','incheiat')),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune>0),
  lot_sha256 text NOT NULL CHECK (lot_sha256 ~ '^[0-9a-f]{64}$'),
  aprobat_lot_sha256 text CHECK (aprobat_lot_sha256 ~ '^[0-9a-f]{64}$'),
  aprobat_versiune integer, aprobat_de uuid, aprobat_la timestamptz,
  creat_de uuid NOT NULL, creat_la timestamptz NOT NULL DEFAULT now(),
  incheiat_la timestamptz,
  CHECK ((aprobat_la IS NULL)=(aprobat_de IS NULL) AND (aprobat_la IS NULL)=(aprobat_lot_sha256 IS NULL)
    AND (aprobat_la IS NULL)=(aprobat_versiune IS NULL)),
  CHECK (stare NOT IN ('aprobat','in_trimitere','blocat_integritate') OR aprobat_la IS NOT NULL)
);
CREATE TABLE public.red_mail_mesaje (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.red_mail_loturi(id),
  detinator_id uuid NOT NULL REFERENCES public.red_detinatori(id),
  tip text NOT NULL DEFAULT 'convocare' CHECK (tip='convocare'),
  nr_document text NOT NULL UNIQUE,
  convocare_postala_id uuid REFERENCES public.red_convocari(id),
  catre text, subiect_final text, corp_text_final text, corp_html_final text,
  message_id text UNIQUE,
  antete_snapshot jsonb,
  atasament_path text, atasament_nume text, atasament_mime text, atasament_sha256 text, atasament_marime bigint,
  CONSTRAINT red_mail_f2_atasament_ck CHECK (
    (atasament_path IS NULL AND atasament_nume IS NULL AND atasament_mime IS NULL AND atasament_sha256 IS NULL AND atasament_marime IS NULL)
    OR (atasament_path IS NOT NULL AND atasament_nume IS NOT NULL AND atasament_mime IS NOT NULL AND atasament_sha256 IS NOT NULL AND atasament_marime IS NOT NULL
      AND atasament_mime='application/pdf' AND atasament_marime BETWEEN 5 AND 10000000 AND atasament_sha256 ~ '^[0-9a-f]{64}$'
      -- r3 (Cop r2 P2-01 / Gem r2 P2-01): cale și nume nevide, nume 1..150 fără caractere de control — paritate cu formaMesaj (JS)
      AND length(btrim(atasament_path)) > 0 AND atasament_path !~ '[[:cntrl:]]'
      AND length(btrim(atasament_nume)) BETWEEN 1 AND 150 AND atasament_nume !~ '[[:cntrl:]]')),
  mesaj_sha256 text NOT NULL CHECK (mesaj_sha256 ~ '^[0-9a-f]{64}$'),
  stare text NOT NULL DEFAULT 'in_coada' CHECK (stare IN ('in_coada','rezervat','in_apel','trimis','esuat_sigur','necunoscut','esuat_confirmat','anulat')),
  lease_token uuid, lease_pana timestamptz, rezervare_nr integer NOT NULL DEFAULT 0,
  rezervat_la timestamptz, apel_inceput_la timestamptz, trimis_la timestamptz,
  gmail_id text, thread_id text, gmail_id_raportat text,
  eroare_cod text CHECK (eroare_cod ~ '^[a-z0-9_]{1,64}$'),
  retentie_stare text NOT NULL DEFAULT 'activ' CHECK (retentie_stare IN ('activ','golit')),
  UNIQUE (lot_id,detinator_id),
  CHECK ((stare='trimis')=(trimis_la IS NOT NULL)),
  CHECK (retentie_stare='golit' OR (catre IS NOT NULL AND corp_text_final IS NOT NULL AND subiect_final IS NOT NULL AND message_id IS NOT NULL))
);
CREATE INDEX red_mail_mesaje_coada ON public.red_mail_mesaje(lot_id,stare,id);
CREATE INDEX red_mail_mesaje_rezervari ON public.red_mail_mesaje(rezervat_la) WHERE rezervat_la IS NOT NULL;
CREATE TABLE public.red_mail_optout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  activ boolean NOT NULL DEFAULT true, motiv text NOT NULL CHECK (length(btrim(motiv)) BETWEEN 1 AND 500),
  sursa text NOT NULL CHECK (sursa IN ('cerere_om','mail_primit')), primit_id uuid REFERENCES public.red_mail_primite(id),
  setat_de uuid NOT NULL, setat_la timestamptz NOT NULL DEFAULT now(),
  CHECK (email=lower(email))
);
CREATE TABLE public.red_mail_fisiere_inventar_antet (
  lot_id uuid PRIMARY KEY REFERENCES public.red_mail_loturi(id), inventar_complet_la timestamptz NOT NULL DEFAULT now(),
  nr_fisiere integer NOT NULL CHECK (nr_fisiere>=0), inventar_sha256 text NOT NULL CHECK (inventar_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE TABLE public.red_mail_fisiere_inventar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lot_id uuid NOT NULL REFERENCES public.red_mail_loturi(id),
  mesaj_id uuid NOT NULL REFERENCES public.red_mail_mesaje(id), cale text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'), marime bigint NOT NULL CHECK (marime>0),
  proprietate text NOT NULL CHECK (proprietate IN ('exclusiv','partajat')),
  stare text NOT NULL CHECK (stare IN ('de_sters','sters','pastrat')), UNIQUE(lot_id,mesaj_id,cale)
);
-- Audit F2 separat, fără câmp liber sau conținut. F1 rămâne neschimbat.
CREATE TABLE public.red_mail_jurnal_f2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lot_id uuid, mesaj_id uuid, autor uuid,
  cod text NOT NULL CHECK (cod IN ('creat','aprobat','rezervat','apel_inceput','trimis','esuat_sigur','necunoscut','esuat_confirmat','anulat','lot_integritate','lot_incheiat','golit','lot_sters_final','setari','optout')),
  creat_la timestamptz NOT NULL DEFAULT now()
);

-- Contract comun JS/SQL: chei ASCII fixe și numai întregi siguri (±9007199254740991).
-- Nu este un canonicalizator JSON general pentru chei Unicode sau numere fracționare.
CREATE FUNCTION public.fn_red_mail_f2_canonic(v jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  CASE jsonb_typeof(v)
    WHEN 'object' THEN RETURN '{'||coalesce((SELECT string_agg(to_jsonb(key)::text||':'||public.fn_red_mail_f2_canonic(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(v)),'')||'}';
    WHEN 'array' THEN RETURN '['||coalesce((SELECT string_agg(public.fn_red_mail_f2_canonic(value),',' ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord)),'')||']';
    ELSE RETURN v::text;
  END CASE;
END $fn$;
-- Restul funcțiilor F2 sunt definite mai jos; toate privilegiile se închid la final.
CREATE FUNCTION public.fn_red_mail_f2_hash(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
 SELECT encode(sha256(convert_to(public.fn_red_mail_f2_canonic(v),'UTF8')),'hex')
$fn$;
CREATE FUNCTION public.fn_red_mail_f2_email(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
 SELECT coalesce(length(v)<=254 AND v ~ '^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+([.][A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$',false)
$fn$;
CREATE FUNCTION public.fn_red_mail_f2_text(v text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
 SELECT regexp_replace(replace(replace(normalize(v,NFC),E'\r\n',E'\n'),E'\r',E'\n'),'[ \t]+$','','gn')
$fn$;
ALTER TABLE public.red_mail_mesaje ADD CONSTRAINT red_mail_f2_snapshot_ck CHECK (
 retentie_stare='golit' OR (public.fn_red_mail_f2_email(catre) AND catre=lower(catre)
 AND length(btrim(subiect_final)) BETWEEN 1 AND 500 AND subiect_final !~ '[[:cntrl:]]'
 AND length(btrim(corp_text_final)) BETWEEN 1 AND 20000 AND message_id='<'||id::text||'@gazpet.ro>'));
CREATE FUNCTION public.fn_red_mail_f2_mesaj_hash(m public.red_mail_mesaje) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
 SELECT public.fn_red_mail_f2_hash(jsonb_build_object('v',1,'mesaj_id',m.id,'from','redari@gazpet.ro','to',lower(m.catre),
  'subiect',public.fn_red_mail_f2_text(m.subiect_final),'message_id',m.message_id,'in_reply_to',NULL,'references','[]'::jsonb,
  'corp_text',public.fn_red_mail_f2_text(m.corp_text_final),'corp_html',public.fn_red_mail_f2_text(m.corp_html_final),
  'atasamente',CASE WHEN m.atasament_path IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('nume',m.atasament_nume,
   'mime',m.atasament_mime,'marime',m.atasament_marime,'sha256',m.atasament_sha256)) END))
$fn$;
CREATE FUNCTION public.fn_red_mail_f2_lot_hash(p_lot uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $fn$
 SELECT public.fn_red_mail_f2_hash(coalesce(jsonb_agg(mesaj_sha256 ORDER BY id),'[]'::jsonb)) FROM public.red_mail_mesaje WHERE lot_id=p_lot
$fn$;
CREATE FUNCTION public.fn_red_mail_f2_owner() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 IF auth.uid() IS NULL OR public.fn_sms_e_owner() IS NOT TRUE THEN RAISE EXCEPTION 'non_owner' USING ERRCODE='42501'; END IF;
END $fn$;
CREATE FUNCTION public.fn_red_mail_f2_audit(p_lot uuid,p_mesaj uuid,p_cod text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 INSERT INTO public.red_mail_jurnal_f2(lot_id,mesaj_id,autor,cod) VALUES(p_lot,p_mesaj,auth.uid(),p_cod);
 -- F1 nu are tip F2: nu reutilizăm semantic un tip F1 nepotrivit.
 INSERT INTO public.red_mail_evenimente(tip,cod,obiect_id,autor)
 VALUES('f2', 'f2_'||p_cod,coalesce(p_mesaj,p_lot),auth.uid());
END $fn$;

-- Gardă suplimentară; rolurile nu au deloc scriere directă. Fără GUC sau bypass de identitate.
CREATE FUNCTION public.fn_red_mail_f2_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi;
BEGIN
 IF TG_TABLE_NAME='red_mail_loturi' THEN
  IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW.proiect_id,NEW.uat_id,NEW.cerere_sha256,NEW.creat_de,NEW.creat_la) IS DISTINCT FROM (OLD.id,OLD.proiect_id,OLD.uat_id,OLD.cerere_sha256,OLD.creat_de,OLD.creat_la) THEN RAISE EXCEPTION 'identitate_imuabila'; END IF;
   IF OLD.stare<>'ciorna' AND (NEW.lot_sha256,NEW.aprobat_lot_sha256,NEW.aprobat_versiune,NEW.aprobat_de,NEW.aprobat_la) IS DISTINCT FROM (OLD.lot_sha256,OLD.aprobat_lot_sha256,OLD.aprobat_versiune,OLD.aprobat_de,OLD.aprobat_la) THEN RAISE EXCEPTION 'aprobare_imuabila'; END IF;
   IF NEW.stare<>OLD.stare AND NOT ((OLD.stare='ciorna' AND NEW.stare='aprobat') OR (OLD.stare='aprobat' AND NEW.stare='in_trimitere') OR (OLD.stare IN ('aprobat','in_trimitere') AND NEW.stare='blocat_integritate') OR (OLD.stare<>'incheiat' AND NEW.stare='incheiat')) THEN RAISE EXCEPTION 'tranzitie_lot_invalida'; END IF;
  END IF;
 ELSE
  -- Ordine: lot -> mesaj; RPC-ul deține deja lotul înaintea DML-ului.
  SELECT * INTO l FROM public.red_mail_loturi WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.lot_id ELSE NEW.lot_id END FOR UPDATE;
  IF TG_OP='INSERT' AND l.stare<>'ciorna' THEN RAISE EXCEPTION 'lot_inghetat'; END IF;
  IF TG_OP='UPDATE' THEN
   IF (NEW.lot_id,NEW.detinator_id,NEW.id,NEW.nr_document,NEW.mesaj_sha256,NEW.convocare_postala_id) IS DISTINCT FROM (OLD.lot_id,OLD.detinator_id,OLD.id,OLD.nr_document,OLD.mesaj_sha256,OLD.convocare_postala_id) THEN RAISE EXCEPTION 'identitate_imuabila'; END IF;
   IF NEW.stare<>OLD.stare AND NOT ((OLD.stare='in_coada' AND NEW.stare IN ('rezervat','anulat'))
     OR (OLD.stare='rezervat' AND NEW.stare IN ('in_coada','in_apel','anulat','esuat_sigur'))
     OR (OLD.stare='in_apel' AND NEW.stare IN ('trimis','esuat_sigur','necunoscut'))
     OR (OLD.stare='necunoscut' AND NEW.stare IN ('trimis','esuat_confirmat'))) THEN RAISE EXCEPTION 'tranzitie_mesaj_invalida'; END IF;
   IF l.stare IN ('incheiat','blocat_integritate') AND NEW.stare IN ('in_coada','rezervat') AND NEW.stare<>OLD.stare THEN RAISE EXCEPTION 'lot_terminal'; END IF;
   IF (NEW.catre,NEW.subiect_final,NEW.corp_text_final,NEW.corp_html_final,NEW.antete_snapshot,NEW.atasament_path,NEW.atasament_sha256,NEW.atasament_marime,NEW.atasament_nume,NEW.atasament_mime,NEW.message_id,NEW.mesaj_sha256,NEW.nr_document,NEW.convocare_postala_id)
     IS DISTINCT FROM (OLD.catre,OLD.subiect_final,OLD.corp_text_final,OLD.corp_html_final,OLD.antete_snapshot,OLD.atasament_path,OLD.atasament_sha256,OLD.atasament_marime,OLD.atasament_nume,OLD.atasament_mime,OLD.message_id,OLD.mesaj_sha256,OLD.nr_document,OLD.convocare_postala_id)
     AND NOT (NEW.retentie_stare='golit' AND public.fn_red_mail_f2_retentie_poate(l.id) IS TRUE AND NEW.catre IS NULL AND NEW.subiect_final IS NULL AND NEW.corp_text_final IS NULL AND NEW.corp_html_final IS NULL AND NEW.antete_snapshot IS NULL AND NEW.message_id IS NULL AND NEW.atasament_path IS NULL AND NEW.atasament_sha256 IS NULL AND NEW.atasament_nume IS NULL AND NEW.atasament_mime IS NULL AND NEW.atasament_marime IS NULL) THEN RAISE EXCEPTION 'snapshot_imuabil'; END IF;
  END IF;
  IF TG_OP='DELETE' AND (l.stare<>'incheiat' OR EXISTS(SELECT 1 FROM public.red_mail_mesaje WHERE lot_id=l.id AND stare IN ('in_apel','necunoscut')) OR EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar WHERE lot_id=l.id AND stare='de_sters') OR NOT EXISTS(SELECT 1 FROM public.red_proiecte WHERE id=l.proiect_id AND retentie_mail_pana < (now() AT TIME ZONE 'Europe/Bucharest')::date)) THEN RAISE EXCEPTION 'retentie_refuzata'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $fn$;
CREATE TRIGGER trg_red_mail_f2_lot BEFORE UPDATE ON public.red_mail_loturi FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_f2_garda();
CREATE TRIGGER trg_red_mail_f2_mesaj BEFORE INSERT OR UPDATE OR DELETE ON public.red_mail_mesaje FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_f2_garda();
CREATE FUNCTION public.fn_red_mail_f2_fara_convocare_email() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
 IF NEW.canal='email' THEN RAISE EXCEPTION 'E-mailul suplimentar se inregistreaza numai in red_mail_mesaje' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER trg_red_mail_f2_canal BEFORE INSERT OR UPDATE ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_red_mail_f2_fara_convocare_email();

-- RPC-uri cu JWT-ul utilizatorului; auth.uid() rămâne identitatea, fără p_user și fără service_role.
-- Ordine pentru toate RPC-urile: setări -> lot -> mesaje ORDER BY id. Nicio cale nu ia lock-uri invers.
CREATE FUNCTION public.fn_red_mail_lot_creeaza(p_operatie uuid,p_proiect uuid,p_uat uuid,p_destinatari uuid[],p_subiect text,p_text text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE h text; existent public.red_mail_loturi; dst record; msg public.red_mail_mesaje; n bigint; pr public.red_proiecte; nou boolean;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 IF p_operatie IS NULL OR p_proiect IS NULL OR p_uat IS NULL OR cardinality(p_destinatari) IS NULL OR cardinality(p_destinatari) NOT BETWEEN 1 AND 300 OR array_position(p_destinatari,NULL) IS NOT NULL THEN RAISE EXCEPTION 'cerere_invalida' USING ERRCODE='22023'; END IF;
 IF p_subiect IS NULL OR length(btrim(p_subiect)) NOT BETWEEN 1 AND 400 OR p_subiect ~ '[[:cntrl:]]' OR p_text IS NULL OR length(btrim(p_text)) NOT BETWEEN 1 AND 19000 THEN RAISE EXCEPTION 'continut_invalid' USING ERRCODE='22023'; END IF;
 h:=public.fn_red_mail_f2_hash(jsonb_build_object('proiect',p_proiect,'uat',p_uat,'destinatari',(SELECT jsonb_agg(x ORDER BY x) FROM unnest(p_destinatari)x),'subiect',p_subiect,'text',p_text));
 PERFORM 1 FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;
 INSERT INTO public.red_mail_loturi(id,proiect_id,uat_id,cerere_sha256,lot_sha256,creat_de) VALUES(p_operatie,p_proiect,p_uat,h,public.fn_red_mail_f2_hash('[]'::jsonb),auth.uid()) ON CONFLICT(id) DO NOTHING RETURNING * INTO existent;
 nou:=FOUND;
 SELECT * INTO existent FROM public.red_mail_loturi WHERE id=p_operatie FOR UPDATE;
 IF NOT nou THEN IF existent.cerere_sha256<>h THEN RAISE EXCEPTION 'operatie_reutilizata'; END IF; RETURN existent.id; END IF;
 SELECT * INTO pr FROM public.red_proiecte WHERE id=p_proiect;
 IF NOT FOUND OR pr.activ IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.red_uat WHERE id=p_uat AND proiect_id=p_proiect) THEN RAISE EXCEPTION 'tinta_invalida'; END IF;
 IF cardinality(p_destinatari)<>(SELECT count(DISTINCT x) FROM unnest(p_destinatari)x) OR cardinality(p_destinatari)<>(SELECT count(*) FROM public.red_detinatori d JOIN public.red_parcele p ON p.id=d.parcela_id JOIN public.red_detinatori_contact c ON c.detinator_id=d.id WHERE d.id=ANY(p_destinatari) AND d.sters_la IS NULL AND p.sters_la IS NULL AND p.proiect_id=p_proiect AND p.uat_id=p_uat AND public.fn_red_mail_f2_email(c.email)) THEN RAISE EXCEPTION 'destinatari_invalizi'; END IF;
 IF EXISTS(SELECT 1 FROM public.red_detinatori_contact c WHERE c.detinator_id=ANY(p_destinatari)
 AND EXISTS(SELECT 1 FROM public.red_mail_optout o WHERE o.email=lower(c.email) AND o.activ))
 OR EXISTS(SELECT 1 FROM public.red_mail_mesaje m JOIN public.red_mail_loturi l ON l.id=m.lot_id
 WHERE m.detinator_id=ANY(p_destinatari) AND l.proiect_id=p_proiect
 AND m.stare IN ('in_coada','rezervat','in_apel','necunoscut','trimis')) THEN RAISE EXCEPTION 'destinatari_neeligibili'; END IF;
 FOR dst IN SELECT d.id,c.email FROM public.red_detinatori d JOIN public.red_detinatori_contact c ON c.detinator_id=d.id WHERE d.id=ANY(p_destinatari) ORDER BY d.id LOOP
  -- Numerotare M atomică, fără modificarea RPC-ului existent de numerotare.
  INSERT INTO public.red_numere(cheie,ultimul) VALUES('M',1) ON CONFLICT(cheie) DO UPDATE SET ultimul=red_numere.ultimul+1 RETURNING ultimul INTO n;
  msg.id:=gen_random_uuid(); msg.lot_id:=p_operatie; msg.detinator_id:=dst.id; msg.tip:='convocare'; msg.nr_document:='M-'||lpad(n::text,6,'0');
  msg.catre:=lower(dst.email); msg.message_id:='<'||msg.id::text||'@gazpet.ro>';
  msg.subiect_final:=public.fn_red_mail_f2_text(p_subiect); msg.corp_text_final:=public.fn_red_mail_f2_text(p_text); msg.corp_html_final:=NULL;
  msg.antete_snapshot:=jsonb_build_object('From','redari@gazpet.ro','To',msg.catre,'Message-ID',msg.message_id,'List-Unsubscribe','<mailto:redari@gazpet.ro?subject=dezabonare>');
  msg.mesaj_sha256:=public.fn_red_mail_f2_mesaj_hash(msg);
  INSERT INTO public.red_mail_mesaje(id,lot_id,detinator_id,nr_document,catre,message_id,subiect_final,corp_text_final,antete_snapshot,mesaj_sha256) VALUES(msg.id,msg.lot_id,msg.detinator_id,msg.nr_document,msg.catre,msg.message_id,msg.subiect_final,msg.corp_text_final,msg.antete_snapshot,msg.mesaj_sha256);
 END LOOP;
 UPDATE public.red_mail_loturi SET lot_sha256=public.fn_red_mail_f2_lot_hash(p_operatie) WHERE id=p_operatie;
 PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'creat'); RETURN p_operatie;
END $fn$;
CREATE FUNCTION public.fn_red_mail_lot_aproba(p_lot uuid,p_versiune integer,p_lot_sha256 text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> mesaje (citire după lock pe lot).
 PERFORM 1 FROM public.red_mail_setari WHERE id=1 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=p_lot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lot_inexistent'; END IF;
 IF l.aprobat_versiune=p_versiune AND l.aprobat_lot_sha256=p_lot_sha256 THEN RETURN true; END IF;
 IF l.stare<>'ciorna' OR l.versiune IS DISTINCT FROM p_versiune OR l.lot_sha256 IS DISTINCT FROM p_lot_sha256 OR public.fn_red_mail_f2_lot_hash(l.id) IS DISTINCT FROM p_lot_sha256 OR NOT EXISTS(SELECT 1 FROM public.red_mail_mesaje WHERE lot_id=l.id) THEN RAISE EXCEPTION 'lot_modificat'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_proiecte WHERE id=l.proiect_id AND public.fn_red_informare_publicata(cod) IS TRUE) THEN RAISE EXCEPTION 'informare_nepublicata'; END IF;
 UPDATE public.red_mail_loturi SET stare='aprobat',aprobat_de=auth.uid(),aprobat_la=now(),aprobat_lot_sha256=p_lot_sha256,aprobat_versiune=p_versiune,versiune=versiune+1 WHERE id=l.id;
 PERFORM public.fn_red_mail_f2_audit(l.id,NULL,'aprobat'); RETURN true;
END $fn$;

CREATE FUNCTION public.fn_red_mail_f2_poate(l public.red_mail_loturi) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_setari WHERE id=1 AND trimitere_oprita IS FALSE AND (pauza_pana IS NULL OR pauza_pana<=now())) THEN RETURN 'trimitere_oprita'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_proiecte WHERE id=l.proiect_id AND public.fn_red_informare_publicata(cod) IS TRUE) THEN RETURN 'informare_nepublicata'; END IF;
 IF l.stare NOT IN ('aprobat','in_trimitere') OR l.aprobat_de IS NULL THEN RETURN 'lot_neaprobat'; END IF;
 IF l.aprobat_la IS NULL OR l.aprobat_la+interval '7 days'<=now() THEN RETURN 'aprobare_expirata'; END IF;
 IF public.fn_red_mail_f2_lot_hash(l.id) IS DISTINCT FROM l.lot_sha256 OR l.lot_sha256 IS DISTINCT FROM l.aprobat_lot_sha256 THEN RETURN 'lot_integritate'; END IF;
 RETURN NULL;
END $fn$;
CREATE FUNCTION public.fn_red_mail_rezerva(p_lot uuid) RETURNS SETOF public.red_mail_mesaje
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; s public.red_mail_setari; cod text;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> mesaje ORDER BY id. Setările serializează și cotele globale.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=p_lot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lot_inexistent'; END IF;
 -- Reconcilierea locală a lease-urilor nu reia un send ambiguu.
 PERFORM 1 FROM public.red_mail_mesaje WHERE lot_id=l.id ORDER BY id FOR UPDATE;
 UPDATE public.red_mail_mesaje SET stare='necunoscut',eroare_cod='lease_expirat' WHERE lot_id=l.id AND stare='in_apel' AND lease_pana<=now();
 UPDATE public.red_mail_mesaje SET stare=CASE WHEN l.stare IN ('incheiat','blocat_integritate') THEN 'anulat' ELSE 'in_coada' END,rezervat_la=NULL,lease_token=NULL,lease_pana=NULL WHERE lot_id=l.id AND stare='rezervat' AND lease_pana<=now();
 cod:=public.fn_red_mail_f2_poate(l);
 IF cod='lot_integritate' THEN UPDATE public.red_mail_loturi SET stare='blocat_integritate',versiune=versiune+1 WHERE id=l.id; PERFORM public.fn_red_mail_f2_audit(l.id,NULL,cod); END IF;
 IF cod='aprobare_expirata' THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod=cod WHERE lot_id=l.id AND stare='in_coada'; END IF;
 IF cod IS NOT NULL THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.red_mail_mesaje WHERE stare IN ('rezervat','in_apel','necunoscut'))>=50 THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.red_mail_mesaje WHERE rezervat_la IS NOT NULL AND (rezervat_la AT TIME ZONE 'Europe/Bucharest')::date=(now() AT TIME ZONE 'Europe/Bucharest')::date)>=s.plafon_zi OR (SELECT count(*) FROM public.red_mail_mesaje WHERE rezervat_la IS NOT NULL AND date_trunc('month',rezervat_la AT TIME ZONE 'Europe/Bucharest')=date_trunc('month',now() AT TIME ZONE 'Europe/Bucharest'))>=s.plafon_luna THEN RETURN; END IF;
 SELECT * INTO m FROM public.red_mail_mesaje WHERE lot_id=l.id AND stare='in_coada' ORDER BY id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.red_mail_optout WHERE email=m.catre AND activ) THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='optout' WHERE id=m.id; RETURN; END IF;
 IF NOT s.extern_permis AND split_part(m.catre,'@',2)<>'gazpet.ro' THEN RETURN; END IF;
 IF l.stare='aprobat' THEN UPDATE public.red_mail_loturi SET stare='in_trimitere',versiune=versiune+1 WHERE id=l.id; END IF;
 UPDATE public.red_mail_mesaje SET stare='rezervat',lease_token=gen_random_uuid(),lease_pana=now()+interval '2 minutes',rezervat_la=now(),rezervare_nr=rezervare_nr+1 WHERE id=m.id RETURNING * INTO m;
 PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'rezervat'); RETURN NEXT m;
END $fn$;
CREATE FUNCTION public.fn_red_mail_apel_incepe(p_mesaj uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; cod text; s public.red_mail_setari;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> mesaj; primul SELECT al id-ului nu blochează.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=(SELECT lot_id FROM public.red_mail_mesaje WHERE id=p_mesaj) FOR UPDATE;
 SELECT * INTO m FROM public.red_mail_mesaje WHERE id=p_mesaj FOR UPDATE;
 IF NOT FOUND OR m.stare<>'rezervat' OR m.lease_token IS DISTINCT FROM p_token OR m.lease_pana<=now() THEN RETURN false; END IF;
 cod:=public.fn_red_mail_f2_poate(l);
 IF cod='lot_integritate' THEN UPDATE public.red_mail_loturi SET stare='blocat_integritate',versiune=versiune+1 WHERE id=l.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,cod); END IF;
 IF cod IS NOT NULL OR (NOT s.extern_permis AND split_part(m.catre,'@',2)<>'gazpet.ro') OR EXISTS(SELECT 1 FROM public.red_mail_optout WHERE email=m.catre AND activ) OR s.ultim_apel_la>now()-interval '2 seconds' THEN RETURN false; END IF;
 UPDATE public.red_mail_mesaje SET stare='in_apel',apel_inceput_la=now() WHERE id=m.id;
 UPDATE public.red_mail_setari SET ultim_apel_la=now() WHERE id=1;
 PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'apel_inceput'); RETURN true;
END $fn$;
CREATE FUNCTION public.fn_red_mail_rezultat(p_mesaj uuid,p_token uuid,p_stare text,p_gmail_id text DEFAULT NULL,p_thread_id text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> mesaj. CAS pe tokenul propriu; rezultatul nu repune în coadă.
 PERFORM 1 FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=(SELECT lot_id FROM public.red_mail_mesaje WHERE id=p_mesaj) FOR UPDATE;
 SELECT * INTO m FROM public.red_mail_mesaje WHERE id=p_mesaj FOR UPDATE;
 IF NOT FOUND OR m.lease_token IS DISTINCT FROM p_token THEN RETURN false; END IF;
 IF p_stare IS NULL OR p_stare NOT IN ('trimis','esuat_sigur','necunoscut') THEN RAISE EXCEPTION 'rezultat_invalid'; END IF;
 IF m.stare IN ('trimis','esuat_sigur','necunoscut') THEN
  IF (m.stare,m.gmail_id,m.thread_id) IS NOT DISTINCT FROM (p_stare,p_gmail_id,p_thread_id) THEN RETURN true; END IF;
  RAISE EXCEPTION 'rezultat_conflict' USING ERRCODE='22023';
 END IF;
 IF m.stare NOT IN ('in_apel','rezervat') THEN RETURN false; END IF;
 IF m.stare='rezervat' AND p_stare<>'esuat_sigur' THEN RETURN false; END IF;
 IF p_stare='trimis' AND (p_gmail_id IS NULL OR p_gmail_id !~ '^[A-Za-z0-9_-]{1,64}$' OR p_thread_id IS NULL OR p_thread_id !~ '^[A-Za-z0-9_-]{1,64}$') THEN RAISE EXCEPTION 'rezultat_invalid'; END IF;
 UPDATE public.red_mail_mesaje SET stare=p_stare,gmail_id=p_gmail_id,thread_id=p_thread_id,trimis_la=CASE WHEN p_stare='trimis' THEN now() END WHERE id=m.id;
 IF p_stare='necunoscut' THEN UPDATE public.red_mail_setari SET pauza_pana=now()+interval '15 minutes' WHERE id=1; END IF;
 PERFORM public.fn_red_mail_f2_audit(l.id,m.id,p_stare); RETURN true;
END $fn$;

CREATE FUNCTION public.fn_red_mail_destinatari(p_proiect uuid,p_uat uuid,p_dupa uuid DEFAULT NULL)
RETURNS TABLE(id uuid,nume text,email text,motive text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 RETURN QUERY SELECT d.id,d.nume,lower(c.email),array_remove(ARRAY[
 CASE WHEN public.fn_red_mail_f2_email(c.email) IS NOT TRUE THEN 'fara_email' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.red_mail_optout o WHERE o.email=lower(c.email) AND o.activ) THEN 'opt_out' END,
 -- Canalul poștal NU exclude e-mailul suplimentar. Este inventariat separat.
 CASE WHEN public.fn_red_mail_f2_email(c.email) IS NOT TRUE AND EXISTS(SELECT 1 FROM public.red_convocari cv WHERE cv.detinator_id=d.id AND cv.canal='posta' AND cv.stare='activ' AND cv.sters_la IS NULL) THEN 'canal_postal' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.red_mail_mesaje m JOIN public.red_mail_loturi l ON l.id=m.lot_id WHERE m.detinator_id=d.id AND l.proiect_id=p_proiect AND m.stare IN ('in_coada','rezervat','in_apel','necunoscut','trimis')) THEN 'deja_rezervat_trimis' END
 ]::text[],NULL)
 FROM public.red_detinatori d JOIN public.red_parcele p ON p.id=d.parcela_id
 LEFT JOIN public.red_detinatori_contact c ON c.detinator_id=d.id
 WHERE p.proiect_id=p_proiect AND p.uat_id=p_uat AND p.sters_la IS NULL AND d.sters_la IS NULL
 AND (p_dupa IS NULL OR d.id>p_dupa) ORDER BY d.id LIMIT 300;
END $fn$;
CREATE FUNCTION public.fn_red_mail_lot_inchide(p_lot uuid,p_versiune integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; nr integer; h text;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> mesaje ORDER BY id -> inventar. Fără revenire în coadă.
 PERFORM 1 FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=p_lot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lot_inexistent'; END IF;
 IF l.stare='incheiat' THEN RETURN true; END IF;
 IF l.versiune IS DISTINCT FROM p_versiune THEN RAISE EXCEPTION 'lot_modificat'; END IF;
 PERFORM 1 FROM public.red_mail_mesaje WHERE lot_id=l.id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar WHERE lot_id=l.id) OR EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar_antet WHERE lot_id=l.id) THEN RAISE EXCEPTION 'inventar_inconsistent'; END IF;
 -- Fișierele care aparțin și convocării poștale rămân sub retenția ei.
 INSERT INTO public.red_mail_fisiere_inventar(lot_id,mesaj_id,cale,sha256,marime,proprietate,stare)
 SELECT l.id,m.id,m.atasament_path,m.atasament_sha256,m.atasament_marime,
   CASE WHEN EXISTS(SELECT 1 FROM public.red_convocari c WHERE c.fisier_convocator_path=m.atasament_path) THEN 'partajat' ELSE 'exclusiv' END,
   CASE WHEN EXISTS(SELECT 1 FROM public.red_convocari c WHERE c.fisier_convocator_path=m.atasament_path) THEN 'pastrat' ELSE 'de_sters' END
 FROM public.red_mail_mesaje m WHERE m.lot_id=l.id AND m.atasament_path IS NOT NULL;
 SELECT count(*),public.fn_red_mail_f2_hash(coalesce(jsonb_agg(jsonb_build_array(lot_id,mesaj_id,cale,sha256,marime) ORDER BY mesaj_id,cale),'[]'::jsonb)) INTO nr,h FROM public.red_mail_fisiere_inventar WHERE lot_id=l.id;
 IF nr<>(SELECT count(*) FROM public.red_mail_mesaje WHERE lot_id=l.id AND atasament_path IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar f FULL JOIN public.red_mail_mesaje m ON f.mesaj_id=m.id AND f.lot_id=m.lot_id
   WHERE (f.lot_id=l.id OR m.lot_id=l.id) AND (f.cale IS NOT NULL OR m.atasament_path IS NOT NULL)
   AND (f.cale,f.sha256,f.marime) IS DISTINCT FROM (m.atasament_path,m.atasament_sha256,m.atasament_marime)) THEN RAISE EXCEPTION 'inventar_inconsistent'; END IF;
 INSERT INTO public.red_mail_fisiere_inventar_antet(lot_id,nr_fisiere,inventar_sha256) VALUES(l.id,nr,h);
 UPDATE public.red_mail_mesaje SET stare='anulat',rezervat_la=NULL,lease_token=NULL,lease_pana=NULL,eroare_cod='lot_incheiat' WHERE lot_id=l.id AND stare IN ('in_coada','rezervat');
 UPDATE public.red_mail_loturi SET stare='incheiat',incheiat_la=now(),versiune=versiune+1 WHERE id=l.id;
 PERFORM public.fn_red_mail_f2_audit(l.id,NULL,'lot_incheiat'); RETURN true;
END $fn$;
CREATE FUNCTION public.fn_red_mail_f2_retentie_poate(p_lot uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.red_mail_loturi l JOIN public.red_proiecte p ON p.id=l.proiect_id
  JOIN public.red_mail_fisiere_inventar_antet a ON a.lot_id=l.id WHERE l.id=p_lot AND l.stare='incheiat'
  AND p.retentie_mail_pana < (now() AT TIME ZONE 'Europe/Bucharest')::date
  AND NOT EXISTS(SELECT 1 FROM public.red_mail_mesaje WHERE lot_id=l.id AND stare IN ('in_apel','necunoscut'))
  AND a.nr_fisiere=(SELECT count(*) FROM public.red_mail_fisiere_inventar WHERE lot_id=l.id)
  AND a.inventar_sha256=(SELECT public.fn_red_mail_f2_hash(coalesce(jsonb_agg(jsonb_build_array(lot_id,mesaj_id,cale,sha256,marime) ORDER BY mesaj_id,cale),'[]'::jsonb)) FROM public.red_mail_fisiere_inventar WHERE lot_id=l.id))
$fn$;
CREATE FUNCTION public.fn_red_mail_lot_goleste(p_lot uuid,p_versiune integer,p_confirm boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> mesaje. Termenul și inventarul se reverifică sub lock.
 PERFORM 1 FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=p_lot FOR UPDATE;
 IF NOT FOUND OR p_confirm IS NOT TRUE OR l.versiune IS DISTINCT FROM p_versiune OR public.fn_red_mail_f2_retentie_poate(l.id) IS NOT TRUE THEN RAISE EXCEPTION 'retentie_refuzata'; END IF;
 UPDATE public.red_mail_mesaje SET catre=NULL,subiect_final=NULL,corp_text_final=NULL,corp_html_final=NULL,antete_snapshot=NULL,message_id=NULL,
 atasament_path=NULL,atasament_sha256=NULL,atasament_marime=NULL,atasament_nume=NULL,atasament_mime=NULL,
 gmail_id=NULL,thread_id=NULL,gmail_id_raportat=NULL,retentie_stare='golit' WHERE lot_id=l.id AND retentie_stare<>'golit';
 PERFORM public.fn_red_mail_f2_audit(l.id,NULL,'golit'); RETURN true;
END $fn$;
CREATE FUNCTION public.fn_red_mail_lot_sterge_final(p_lot uuid,p_versiune integer,p_confirm boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> mesaje -> inventar. Fișierele se confirmă absente înaintea DELETE.
 PERFORM 1 FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=p_lot FOR UPDATE;
 IF NOT FOUND THEN RETURN true; END IF;
 IF p_confirm IS NOT TRUE OR l.versiune IS DISTINCT FROM p_versiune OR public.fn_red_mail_f2_retentie_poate(l.id) IS NOT TRUE
 OR EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar WHERE lot_id=l.id AND stare='de_sters') THEN RAISE EXCEPTION 'retentie_refuzata'; END IF;
 DELETE FROM public.red_mail_fisiere_inventar WHERE lot_id=l.id;
 -- Copiii FK înaintea mesajelor; lotul și antetul rămân vii pentru triggerul mesajului.
 DELETE FROM public.red_mail_mesaje WHERE lot_id=l.id;
 DELETE FROM public.red_mail_fisiere_inventar_antet WHERE lot_id=l.id;
 DELETE FROM public.red_mail_loturi WHERE id=l.id;
 PERFORM public.fn_red_mail_f2_audit(l.id,NULL,'lot_sters_final'); RETURN true;
END $fn$;
CREATE FUNCTION public.fn_red_mail_f2_setari(p_oprit boolean,p_extern boolean,p_versiune integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE s public.red_mail_setari;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;
 IF p_oprit IS NULL OR p_extern IS NULL THEN RAISE EXCEPTION 'setari_invalide'; END IF;
 -- OFF nu depinde de cotă sau de versiunea dintr-un ecran vechi.
 IF NOT p_oprit AND s.versiune IS DISTINCT FROM p_versiune THEN RAISE EXCEPTION 'versiune_veche'; END IF;
 -- Decizia de livrare: pornirea nu este expusă până la integrarea OAuth + SENT + probe.
 IF NOT p_oprit OR p_extern THEN RAISE EXCEPTION 'activare_amanata'; END IF;
 UPDATE public.red_mail_setari SET trimitere_oprita=true,extern_permis=false WHERE id=1;
 PERFORM public.fn_red_mail_f2_audit(NULL,NULL,'setari'); RETURN true;
END $fn$;
CREATE FUNCTION public.fn_red_mail_f2_optout(p_email text,p_activ boolean,p_motiv text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> optout; același mutex ca rezervarea și apel_incepe.
 PERFORM 1 FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 IF public.fn_red_mail_f2_email(p_email) IS NOT TRUE OR p_activ IS NULL THEN RAISE EXCEPTION 'cerere_invalida'; END IF;
 IF p_motiv IS NULL OR p_motiv !~ '[^[:space:]]' OR length(btrim(p_motiv)) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'motiv_invalid' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.red_mail_optout(email,activ,motiv,sursa,setat_de) VALUES(lower(p_email),p_activ,p_motiv,'cerere_om',auth.uid())
 ON CONFLICT(email) DO UPDATE SET activ=excluded.activ,motiv=excluded.motiv,setat_de=auth.uid(),setat_la=now();
 PERFORM public.fn_red_mail_f2_audit(NULL,NULL,'optout'); RETURN true;
END $fn$;

-- RLS fără scriere, inclusiv service_role fără privilegii DML. Funcțiile au numai JWT-ul omului.
DO $acl$
DECLARE t text; f regprocedure;
BEGIN
 FOREACH t IN ARRAY ARRAY['red_mail_loturi','red_mail_mesaje','red_mail_optout','red_mail_fisiere_inventar','red_mail_fisiere_inventar_antet','red_mail_jurnal_f2'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_sms_e_owner() IS TRUE)',t||'_sel',t);
  EXECUTE format('CREATE TRIGGER trg_red_mail_f2_fara_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_jurnal_imuabil()',t);
 END LOOP;
 -- Append-only: nu păstrează conținut, nu poate fi rescris prin PostgREST.
 CREATE TRIGGER trg_red_mail_f2_jurnal_imuabil BEFORE UPDATE OR DELETE ON public.red_mail_jurnal_f2 FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND
  (left(p.proname,15)='fn_red_mail_f2_' OR p.proname IN ('fn_red_mail_destinatari','fn_red_mail_lot_creeaza','fn_red_mail_lot_aproba','fn_red_mail_rezerva','fn_red_mail_apel_incepe','fn_red_mail_rezultat','fn_red_mail_lot_inchide','fn_red_mail_lot_goleste','fn_red_mail_lot_sterge_final')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
 END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.fn_red_mail_destinatari(uuid,uuid,uuid),public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text),
 public.fn_red_mail_lot_aproba(uuid,integer,text),public.fn_red_mail_rezerva(uuid),public.fn_red_mail_apel_incepe(uuid,uuid),
 public.fn_red_mail_rezultat(uuid,uuid,text,text,text),public.fn_red_mail_lot_inchide(uuid,integer),
 public.fn_red_mail_lot_goleste(uuid,integer,boolean),public.fn_red_mail_lot_sterge_final(uuid,integer,boolean),
 public.fn_red_mail_f2_setari(boolean,boolean,integer),public.fn_red_mail_f2_optout(text,boolean,text) TO authenticated;

DO $post$
DECLARE t text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_setari WHERE id=1 AND trimitere_oprita AND NOT extern_permis AND plafon_zi=200 AND plafon_luna=1000) THEN RAISE EXCEPTION 'F2: post comutatoare'; END IF;
 FOREACH t IN ARRAY ARRAY['red_mail_loturi','red_mail_mesaje','red_mail_optout','red_mail_fisiere_inventar','red_mail_fisiere_inventar_antet','red_mail_jurnal_f2'] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass)
    OR has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege('service_role','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege('anon','public.'||t,'SELECT') THEN RAISE EXCEPTION 'F2: post ACL/RLS %',t; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.red_mail_loturi) OR EXISTS(SELECT 1 FROM public.red_mail_mesaje) THEN RAISE EXCEPTION 'F2: post fara date'; END IF;
END $post$;
