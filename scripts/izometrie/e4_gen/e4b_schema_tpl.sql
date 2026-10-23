CREATE ROLE izo_teren_editor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT izo_teren_editor TO postgres WITH INHERIT FALSE, SET TRUE;
GRANT USAGE ON SCHEMA public TO izo_teren_editor;
CREATE TABLE public.izo_fronturi (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
 tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
 profile_id uuid NOT NULL REFERENCES public.profiles(id), dispozitiv_id uuid NOT NULL,
 activ boolean NOT NULL DEFAULT true, expira_la timestamptz NOT NULL,
 predat_la timestamptz, eliberat_de uuid, eliberat_motiv text,
 server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq'));
CREATE UNIQUE INDEX ux_izo_front_activ ON public.izo_fronturi(tronson_id) WHERE activ;
CREATE TABLE public.izo_dispozitive (
 dispozitiv_id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id),
 ultimul_seq bigint NOT NULL DEFAULT 0 CHECK(ultimul_seq>=0),
 server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq'));
CREATE TABLE public.izo_preverificari (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, uid uuid NOT NULL UNIQUE,
 proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
 tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
 zi date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Bucharest')::date,
 autor_profile_id uuid NOT NULL REFERENCES public.profiles(id), dispozitiv_id uuid NOT NULL,
 stare text NOT NULL DEFAULT 'deschisa' CHECK(stare IN ('deschisa','trimisa','inchisa')),
 trimisa_la timestamptz, trimisa_op_id uuid, versiune integer NOT NULL DEFAULT 1 CHECK(versiune>0),
 server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq'));
CREATE UNIQUE INDEX ux_izo_sesiune_deschisa ON public.izo_preverificari(tronson_id,autor_profile_id) WHERE stare='deschisa';
CREATE TABLE public.izo_declaratii (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, uid uuid NOT NULL UNIQUE,
 preverificare_id bigint NOT NULL REFERENCES public.izo_preverificari(id),
 proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id), tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
 tip text NOT NULL CHECK(tip IN ('montaj','taiere','cuplare')),
 versiune integer NOT NULL CHECK(versiune>0), declarat_de uuid NOT NULL REFERENCES public.profiles(id),
 declarat_de_angajat bigint NOT NULL, dispozitiv_id uuid NOT NULL, ultimul_op_id uuid NOT NULL,
 stare text NOT NULL CHECK(stare IN ('ciorna','trimisa','in_verificare','conflict','blocata','revizie_ceruta','aprobata','respinsa','stearsa')),
 conflict_cod text CHECK(conflict_cod IN ('r1d','corectie_in_arbore')), stare_inainte_blocare text, blocata_motiv text,
 identificare text CHECK(identificare IN ('bucata','bucata_decl','nerezolvata')),
 bucata_id bigint REFERENCES public.magazie_bucati(id), bucata_decl_uid uuid,
 sursa_bucata_id bigint REFERENCES public.magazie_bucati(id), sursa_decl_uid uuid,
 depinde_de_uid uuid REFERENCES public.izo_declaratii(uid), depinde_de_versiune integer,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND NOT payload ? 'gps'),
 gps_prezent boolean NOT NULL DEFAULT false, data_montaj date NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), aprobat_de uuid, aprobat_de_angajat bigint,
 decis_la timestamptz, decizie_motiv text, eveniment_ids bigint[],
 server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq'),
 CHECK((stare='blocata')=(stare_inainte_blocare IS NOT NULL)),
 CHECK(stare<>'conflict' OR conflict_cod IS NOT NULL),
 CHECK(stare NOT IN ('ciorna','trimisa','in_verificare','revizie_ceruta','aprobata') OR conflict_cod IS NULL),
 CHECK(stare<>'blocata' OR conflict_cod IS NULL OR stare_inainte_blocare='conflict'),
 CHECK(tip<>'montaj' OR (identificare IS NOT NULL AND
   (identificare='nerezolvata' AND bucata_id IS NULL AND bucata_decl_uid IS NULL OR
    identificare='bucata' AND bucata_id IS NOT NULL AND bucata_decl_uid IS NULL OR
    identificare='bucata_decl' AND bucata_id IS NULL AND bucata_decl_uid IS NOT NULL))),
 CHECK(stare<>'in_verificare' OR identificare='nerezolvata'),
 CHECK(tip<>'montaj' OR stare NOT IN ('trimisa','aprobata') OR identificare<>'nerezolvata'),
 CHECK(tip<>'taiere' OR num_nonnulls(sursa_bucata_id,sursa_decl_uid)=1));
CREATE TABLE public.izo_bucati_declarate (
 uid uuid PRIMARY KEY, declaratie_id bigint NOT NULL REFERENCES public.izo_declaratii(id),
 declaratie_versiune integer NOT NULL, parinte_bucata_id bigint REFERENCES public.magazie_bucati(id), parinte_decl_uid uuid,
 radacina_id bigint NOT NULL REFERENCES public.magazie_bucati(id),
 lungime_mm integer NOT NULL CHECK(lungime_mm>0), lungime_calculata boolean NOT NULL,
 capat_stanga text NOT NULL, capat_dreapta text NOT NULL, cod_bucata text NOT NULL,
 destinatie text NOT NULL CHECK(destinatie IN ('montaj','ramane_montat','depozit')),
 depozit_destinatie_id integer REFERENCES public.logistica_depozite(id),
 stare text NOT NULL DEFAULT 'declarata' CHECK(stare IN ('declarata','aprobata','anulata')),
 bucata_id bigint REFERENCES public.magazie_bucati(id),
 server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq'),
 CHECK(num_nonnulls(parinte_bucata_id,parinte_decl_uid)=1));
CREATE UNIQUE INDEX ux_izo_decl_cod ON public.izo_bucati_declarate(radacina_id,cod_bucata) WHERE stare='declarata';
CREATE TABLE public.izo_rezervari (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id), tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
 declaratie_id bigint NOT NULL REFERENCES public.izo_declaratii(id), declaratie_versiune integer NOT NULL,
 autor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
 bucata_id bigint REFERENCES public.magazie_bucati(id), bucata_decl_uid uuid REFERENCES public.izo_bucati_declarate(uid),
 din_depozit boolean NOT NULL, tip text NOT NULL DEFAULT 'fizic' CHECK(tip='fizic'),
 activa boolean NOT NULL DEFAULT true, creata_la timestamptz NOT NULL DEFAULT now(), eliberata_la timestamptz,
 expira_dupa timestamptz, motiv_eliberare text CHECK(motiv_eliberare IN ('versiune_noua','stearsa','respinsa','consumata','expirata','parinte_anulat','transferata')),
 eveniment_id bigint REFERENCES public.magazie_bucati_evenimente(id), transfer_din_id bigint REFERENCES public.izo_rezervari(id),
 server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq'),
 CHECK(num_nonnulls(bucata_id,bucata_decl_uid)=1),
 CHECK(activa=(eliberata_la IS NULL AND motiv_eliberare IS NULL)));
CREATE UNIQUE INDEX ux_izo_rez_bucata ON public.izo_rezervari(bucata_id) WHERE activa;
CREATE UNIQUE INDEX ux_izo_rez_decl ON public.izo_rezervari(bucata_decl_uid) WHERE activa;
CREATE UNIQUE INDEX ux_izo_rez_transfer ON public.izo_rezervari(transfer_din_id) WHERE transfer_din_id IS NOT NULL;
CREATE TABLE public.izo_operatii (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, autor_profile_id uuid NOT NULL REFERENCES public.profiles(id), op_id uuid NOT NULL,
 canal text NOT NULL CHECK(canal IN ('teren','aprobare','depozit','pachet')),
 proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id), tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
 dispozitiv_id uuid NOT NULL, seq bigint NOT NULL CHECK(seq>0), versiune_format integer NOT NULL,
 tip_op text NOT NULL, payload jsonb NOT NULL CHECK(NOT payload ? 'gps'), hash_cerere text NOT NULL CHECK(hash_cerere ~ '^[0-9a-f]{64}$'),
 rezultat text NOT NULL CHECK(rezultat IN ('acceptat','conflict','eroare','eroare_interna')), cod text,
 raspuns jsonb NOT NULL, ora_tableta timestamptz, ora_server timestamptz NOT NULL DEFAULT now(), offset_ceas_s numeric,
 server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq'),
 UNIQUE(autor_profile_id,op_id));
CREATE INDEX ix_izo_operatii_autor_ora ON public.izo_operatii(autor_profile_id,ora_server);
CREATE TABLE public.izo_declaratii_versiuni (
 declaratie_id bigint NOT NULL REFERENCES public.izo_declaratii(id), versiune integer NOT NULL,
 payload jsonb NOT NULL CHECK(NOT payload ? 'gps'), hash_cerere text NOT NULL CHECK(hash_cerere ~ '^[0-9a-f]{64}$'),
 op_id uuid NOT NULL, la timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(declaratie_id,versiune));
CREATE TABLE public.izo_declaratii_gps (
 declaratie_id bigint NOT NULL REFERENCES public.izo_declaratii(id), versiune integer NOT NULL,
 lat numeric NOT NULL CHECK(lat BETWEEN -90 AND 90), lon numeric NOT NULL CHECK(lon BETWEEN -180 AND 180),
 precizie_m numeric NOT NULL CHECK(precizie_m>=0), la timestamptz NOT NULL, PRIMARY KEY(declaratie_id,versiune));
CREATE TABLE public.izo_sync_incercari (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
 tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id), autor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
 op_id uuid NOT NULL, dispozitiv_id uuid NOT NULL, tip_op text NOT NULL,
 payload jsonb NOT NULL CHECK(NOT payload ? 'gps'), prima_la timestamptz NOT NULL DEFAULT now(), UNIQUE(autor_profile_id,op_id));
CREATE TABLE public.izo_rata_apeluri (
 profile_id uuid NOT NULL, functie text NOT NULL, fereastra_de_la timestamptz NOT NULL, n integer NOT NULL, PRIMARY KEY(profile_id,functie));
CREATE TABLE public.izo_aprobari (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, cheie_operatie uuid NOT NULL UNIQUE,
 proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
 tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id),
 aprobator uuid NOT NULL REFERENCES public.profiles(id), aprobator_angajat bigint NOT NULL,
 randuri jsonb NOT NULL, decizii jsonb NOT NULL, hash_cerere text NOT NULL CHECK(hash_cerere ~ '^[0-9a-f]{64}$'),
 amprenta_preview text NOT NULL, eveniment_ids bigint[] NOT NULL, raspuns jsonb NOT NULL,
 creat_la timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.fn_izo_decl_ceas() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
BEGIN
 IF OLD.stare IN ('aprobata','respinsa','stearsa') THEN RAISE EXCEPTION 'declaratie_finala' USING ERRCODE='42501'; END IF;
 IF (to_jsonb(OLD)-ARRAY['versiune','ultimul_op_id','stare','conflict_cod','stare_inainte_blocare','blocata_motiv',
   'identificare','bucata_id','bucata_decl_uid','sursa_bucata_id','sursa_decl_uid','depinde_de_uid','depinde_de_versiune',
   'payload','gps_prezent','data_montaj','server_ver','updated_at','aprobat_de','aprobat_de_angajat','decis_la','decizie_motiv','eveniment_ids'])
  IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['versiune','ultimul_op_id','stare','conflict_cod','stare_inainte_blocare','blocata_motiv',
   'identificare','bucata_id','bucata_decl_uid','sursa_bucata_id','sursa_decl_uid','depinde_de_uid','depinde_de_versiune',
   'payload','gps_prezent','data_montaj','server_ver','updated_at','aprobat_de','aprobat_de_angajat','decis_la','decizie_motiv','eveniment_ids']) THEN
  RAISE EXCEPTION 'identitate_imuabila' USING ERRCODE='42501'; END IF;
 IF NOT (CASE OLD.stare
  WHEN 'ciorna' THEN NEW.stare IN ('ciorna','conflict','stearsa','trimisa','in_verificare','blocata','respinsa')
  WHEN 'conflict' THEN NEW.stare IN ('ciorna','conflict','stearsa','trimisa','in_verificare','blocata','respinsa')
  WHEN 'blocata' THEN NEW.stare IN ('ciorna','conflict','stearsa','trimisa','in_verificare','blocata','respinsa','revizie_ceruta')
  WHEN 'trimisa' THEN NEW.stare IN ('aprobata','revizie_ceruta','respinsa','blocata')
  WHEN 'in_verificare' THEN NEW.stare IN ('trimisa','conflict','revizie_ceruta','respinsa','blocata')
  WHEN 'revizie_ceruta' THEN NEW.stare IN ('trimisa','conflict','in_verificare','respinsa','blocata')
  ELSE false END) THEN RAISE EXCEPTION 'tranzitie_nepermisa' USING ERRCODE='42501'; END IF;
 NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 RETURN NEW;
END $f$;
CREATE FUNCTION public.fn_izo_teren_imuabil() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
BEGIN RAISE EXCEPTION 'E4b jurnal/stergere imuabila' USING ERRCODE='42501'; END $f$;

CREATE TABLE public.izo_suduri (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
 tronson_id bigint NOT NULL REFERENCES public.executie_tronsoane(id), nr integer NOT NULL CHECK(nr>0), sufix text NOT NULL DEFAULT '',
 tip_sudura text NOT NULL CHECK(tip_sudura IN ('linie','cuplare','reparatie')),
 stare text NOT NULL DEFAULT 'declarata' CHECK(stare IN ('declarata','aprobata','anulata')),
 declaratie_id bigint NOT NULL REFERENCES public.izo_declaratii(id), executant text,poanson text,data_sudura date NOT NULL,
 tranzitie_perete boolean NOT NULL DEFAULT false,tranzitie_confirmata_de uuid REFERENCES public.profiles(id),
 tranzitie_confirmata_la timestamptz,tranzitie_confirmata_motiv text,
 server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq'));
CREATE UNIQUE INDEX ux_izo_sudura_cod ON public.izo_suduri(proiect_id,tronson_id,nr,sufix) WHERE stare<>'anulata';
CREATE UNIQUE INDEX ux_izo_sudura_decl ON public.izo_suduri(declaratie_id) WHERE stare<>'anulata';
CREATE TABLE public.izo_suduri_capete (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,sudura_id bigint NOT NULL REFERENCES public.izo_suduri(id),
 parte text NOT NULL CHECK(parte IN ('amonte','aval')),bucata_id bigint REFERENCES public.magazie_bucati(id),
 bucata_decl_uid uuid REFERENCES public.izo_bucati_declarate(uid),capat_litera text NOT NULL,
 activ boolean NOT NULL DEFAULT true,de_la_eveniment_id bigint REFERENCES public.magazie_bucati_evenimente(id),
 server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq'),CHECK(num_nonnulls(bucata_id,bucata_decl_uid)=1));
CREATE UNIQUE INDEX ux_izo_capat_parte ON public.izo_suduri_capete(sudura_id,parte) WHERE activ;
CREATE UNIQUE INDEX ux_izo_capat_bucata ON public.izo_suduri_capete(bucata_id,capat_litera) WHERE activ;
CREATE UNIQUE INDEX ux_izo_capat_decl ON public.izo_suduri_capete(bucata_decl_uid,capat_litera) WHERE activ;
