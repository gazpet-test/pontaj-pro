-- Harness 20261215a_executie_raport_rezumat — DOAR pe clona schemei de producție (sau local, PGlite), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului (20261208a deja aplicată pe clonă):  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_raport_rezumat.sql
-- Local: node scripts/pglite/test_raport_rezumat_local.mjs (schema falsă + 20261027a + 20261201a + 20261208a, apoi acest fișier).
-- O singură tranzacție, ANULATĂ la final (ROLLBACK): migrare (marcajul de livrare) -> paritatea textului SQL cu tabelul de cazuri JS ->
-- salvări prin RPC ca șef de șantier (SET LOCAL ROLE + JWT în ambele surse) -> corectura omului, drepturi, refuzuri -> căile directe ->
-- revenire refuzată (nearmată / cu rezumate corectate) -> revenire armată -> re-aplicare.
-- NU presupune date reale: ia primul owner, primele 2 profiluri non-owner, primul proiect și primul șantier, le leagă DOAR în tranzacție
-- și scrie date FICTIVE (zilele 2001-01-02 / 03, activitățile „… test rezumat”, obiectul TRZ1).
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
-- baseline: politicile și drepturile tabelelor atinse ÎNAINTE de migrare (după ea trebuie să fie identice: migrarea nu dă niciun drept)
SELECT set_config('trez.pol0', (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('rapoarte_zilnice', 'raport_zilnic_salvari', 'raport_lucrari')), true),
       set_config('trez.acl0', (SELECT md5(string_agg(c.relname || '=' || coalesce(c.relacl::text, '') || '/' || c.relrowsecurity || c.relforcerowsecurity, ';' ORDER BY c.relname)) FROM pg_class c WHERE c.oid IN ('public.rapoarte_zilnice'::regclass, 'public.raport_zilnic_salvari'::regclass, 'public.raport_lucrari'::regclass)), true);
SELECT set_config('gazpet.livrare_migrare', '20261215a_executie_raport_rezumat:' || txid_current(), true);
\ir ../supabase/migrations/20261215a_executie_raport_rezumat.sql

-- ── unelte ──
-- identitatea: ambele surse JWT (auth.uid() citește întâi request.jwt.claim.sub), apoi rolul fără BYPASSRLS
CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
  IF auth.uid() IS DISTINCT FROM p_uid OR current_user IS DISTINCT FROM p_rol
     OR (p_rol IN ('authenticated', 'anon') AND (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 't_ca: identitatea nu s-a schimbat (% / %)', auth.uid(), current_user;
  END IF;
END $h$;
CREATE FUNCTION pg_temp.t_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 't_refuza: a trecut fără eroare: %', left(p_sql, 200); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_stare THEN RAISE NOTICE 't_refuza: așteptat %, primit % (%)', p_stare, SQLSTATE, left(SQLERRM, 200); END IF;
  RETURN SQLSTATE = p_stare;
END $h$;
-- scrierea trece: întoarce numărul de rânduri; orice eroare = -1
CREATE FUNCTION pg_temp.t_trece(p_sql text) RETURNS integer LANGUAGE plpgsql AS $h$
DECLARE n integer;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 't_trece: eroare % (%): %', SQLSTATE, left(SQLERRM, 200), left(p_sql, 200); RETURN -1;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('trez.' || p, true), ''); $h$;
-- rândul raportului de test (ca postgres, fără RLS)
CREATE FUNCTION pg_temp.t_r(p_id bigint) RETURNS public.rapoarte_zilnice LANGUAGE sql STABLE AS $h$ SELECT * FROM public.rapoarte_zilnice WHERE id = p_id; $h$;
-- salvarea prin RPC, ca apelantul curent
CREATE FUNCTION pg_temp.t_salv(p_zi date, p_antet jsonb, p_linii jsonb, p_ver integer, p_cheie uuid) RETURNS jsonb LANGUAGE sql AS $h$
  SELECT public.fn_raport_zilnic_salveaza(pg_temp.t_g('s1')::bigint, p_zi, p_antet, p_linii, NULL, p_ver, p_cheie);
$h$;
-- refuzul AȘTEPTAT al unui fișier rulat cu ON_ERROR_STOP 0: psql :ERROR = true, :SQLSTATE și mesajul exact (L25: testul pică dacă trece)
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_refuza(text, text), pg_temp.t_trece(text), pg_temp.t_g(text),
  pg_temp.t_salv(date, jsonb, jsonb, integer, uuid) TO authenticated, anon, service_role;

-- ── TB: migrarea nu schimbă politicile / drepturile tabelelor atinse ──
DO $t$
BEGIN
  IF (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s/%s', tablename, policyname, permissive, roles, cmd, coalesce(qual, ''), coalesce(with_check, '')), ';' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('rapoarte_zilnice', 'raport_zilnic_salvari', 'raport_lucrari')) IS DISTINCT FROM pg_temp.t_g('pol0')
     OR (SELECT md5(string_agg(c.relname || '=' || coalesce(c.relacl::text, '') || '/' || c.relrowsecurity || c.relforcerowsecurity, ';' ORDER BY c.relname)) FROM pg_class c WHERE c.oid IN ('public.rapoarte_zilnice'::regclass, 'public.raport_zilnic_salvari'::regclass, 'public.raport_lucrari'::regclass)) IS DISTINCT FROM pg_temp.t_g('acl0') THEN
    RAISE EXCEPTION 'TB FAIL: migrarea a schimbat politicile / drepturile';
  END IF;
  RAISE NOTICE 'TB OK';
END $t$;

-- ── T0: identități, drepturi rescrise în tranzacție, date fictive ──
DO $t$
DECLARE own uuid; ids uuid[]; p1 bigint; s1 bigint; a1 bigint; a2 bigint; u1 bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 2) x;
  SELECT id INTO p1 FROM public.executie_proiecte ORDER BY id LIMIT 1;
  SELECT id INTO s1 FROM public.sites ORDER BY id LIMIT 1;
  IF own IS NULL OR cardinality(ids) <> 2 OR p1 IS NULL OR s1 IS NULL THEN RAISE EXCEPTION 'T0 FAIL: lipsesc profiluri / proiect / șantier'; END IF;
  UPDATE public.sites SET proiect_id = p1 WHERE id = s1;
  DELETE FROM public.profile_sites WHERE profile_id = ANY (ids);
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids);
  INSERT INTO public.profile_sites (profile_id, site_id) VALUES (ids[1], s1);
  DELETE FROM public.rapoarte_zilnice WHERE site_id = s1 AND data IN (DATE '2001-01-02', DATE '2001-01-03');
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ) VALUES (p1, 'Sudură test rezumat', 'buc', 'cantitate', 1, true) RETURNING id INTO a1;
  INSERT INTO public.proiect_activitati (proiect_id, nume, um, tip_raportare, ordine, activ) VALUES (p1, 'Probă test rezumat', NULL, 'bifa', 2, true) RETURNING id INTO a2;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (p1, 'tronson', 'TRZ1', 'Tronson test rezumat', 1, true) RETURNING id INTO u1;
  PERFORM set_config('trez.own', own::text, true), set_config('trez.sef', ids[1]::text, true), set_config('trez.fara', ids[2]::text, true),
          set_config('trez.p1', p1::text, true), set_config('trez.s1', s1::text, true),
          set_config('trez.a1', a1::text, true), set_config('trez.a2', a2::text, true), set_config('trez.u1', u1::text, true);
  RAISE NOTICE 'T0 OK';
END $t$;

-- ── T1: paritatea SQL = JS: fn_raport_rezumat_text pe EXACT tabelul de cazuri din src/raportRezumat.cazuri.json ──
DO $t$
DECLARE c jsonb; v text; n integer := 0;
  -- CAZURI-START
  v_cazuri jsonb := $cazuri$[
  {
    "nume": "raport complet (două obiecte, bifă, utilaj defect fără nume, meteo cu alertă)",
    "intrare": {
      "santier": "Lot 9 Alfa – Beta",
      "proiect": "Contract 99/2026 Lot 9",
      "data": "2026-11-10",
      "meteo": {
        "temp": 8.3,
        "precip_mm": 2.4,
        "alerte": [
          "Cod galben ploi"
        ],
        "vreme": "Rain",
        "umiditate": 91
      },
      "personal": {
        "sudori": 4,
        "lacatusi": 3,
        "operatori": 2,
        "soferi": 1,
        "necalificati": 6,
        "tesa": 1,
        "altii": 0,
        "total": 17
      },
      "utilaje": [
        {
          "nume": "EXCAVATOR CAT 320",
          "cod": "EX-07",
          "stare": "functional",
          "motiv": null
        },
        {
          "nume": "BULDOEXCAVATOR JCB 3CX",
          "cod": "BX-02",
          "stare": "nefunctional",
          "motiv": "furtun hidraulic spart"
        },
        {
          "nume": "",
          "cod": "GEN-1",
          "stare": "nefunctional",
          "motiv": ""
        }
      ],
      "linii": [
        {
          "obiect_cod": "TR1",
          "obiect_nume": "Tronson 1",
          "activitate": "Săpătură șanț",
          "um": "mc",
          "cantitate": 35.5,
          "bifa": false
        },
        {
          "obiect_cod": "TR1",
          "obiect_nume": "Tronson 1",
          "activitate": "Sudură cap la cap",
          "um": "buc",
          "cantitate": 12,
          "bifa": false
        },
        {
          "obiect_cod": "TR2",
          "obiect_nume": "Tronson 2",
          "activitate": "Lansare conductă",
          "um": "m",
          "cantitate": 147.25,
          "bifa": false
        },
        {
          "obiect_cod": "TR2",
          "obiect_nume": "Tronson 2",
          "activitate": "Probă presiune",
          "um": null,
          "cantitate": 1,
          "bifa": true
        }
      ],
      "distributie": null,
      "lucrari": "S-a continuat pe TR1 și TR2.",
      "probleme": "Acces dificil după ploaie.",
      "masini": null,
      "poze": 6
    },
    "asteptat": "Lot 9 Alfa – Beta (proiect Contract 99/2026 Lot 9) · 10.11.2026 · 8,3 °C, precipitații 2,4 mm, alerte: Cod galben ploi\nOameni: 17 (sudori 4, lăcătuși 3, operatori utilaje 2, șoferi 1, necalificați 6, TESA 1) · Utilaje: 3 (nefuncționale: BULDOEXCAVATOR JCB 3CX – furtun hidraulic spart; GEN-1) · Poze: 6\nLucrări TR1 · Tronson 1: Săpătură șanț 35,5 mc; Sudură cap la cap 12 buc\nLucrări TR2 · Tronson 2: Lansare conductă 147,25 m; Probă presiune (efectuat)\nDetalii: S-a continuat pe TR1 și TR2.\nProbleme: Acces dificil după ploaie."
  },
  {
    "nume": "raport minim: doar șantierul și data (câmpurile lipsă nu apar deloc)",
    "intrare": {
      "santier": "Șantier test",
      "proiect": null,
      "data": "2026-11-11",
      "meteo": null,
      "personal": null,
      "utilaje": null,
      "linii": [],
      "distributie": null,
      "lucrari": null,
      "probleme": null,
      "masini": null,
      "poze": null
    },
    "asteptat": "Șantier test · 11.11.2026"
  },
  {
    "nume": "intrare goală",
    "intrare": {},
    "asteptat": "Raport zilnic"
  },
  {
    "nume": "cantități cu zecimale și unități diferite, fără obiect; zero oameni e o valoare, listele goale nu",
    "intrare": {
      "santier": "S",
      "data": "2026-11-09",
      "meteo": {
        "temp": -2.5,
        "precip_mm": 0,
        "alerte": []
      },
      "personal": {
        "sudori": 0,
        "total": 0
      },
      "utilaje": [],
      "linii": [
        {
          "obiect_cod": null,
          "obiect_nume": null,
          "activitate": "Izolație",
          "um": "mp",
          "cantitate": 0.125,
          "bifa": false
        },
        {
          "obiect_cod": null,
          "obiect_nume": null,
          "activitate": "Țeavă DN 500",
          "um": "100 M.",
          "cantitate": 1.50,
          "bifa": false
        },
        {
          "obiect_cod": null,
          "obiect_nume": null,
          "activitate": "Sudură",
          "um": "",
          "cantitate": 3,
          "bifa": false
        },
        {
          "obiect_cod": null,
          "obiect_nume": null,
          "activitate": "Beton",
          "um": "MC",
          "cantitate": 10000000,
          "bifa": false
        },
        {
          "obiect_cod": null,
          "obiect_nume": null,
          "activitate": "Geotextil",
          "um": "kg",
          "cantitate": null,
          "bifa": false
        }
      ],
      "poze": 0
    },
    "asteptat": "S · 09.11.2026 · -2,5 °C\nOameni: 0\nLucrări: Izolație 0,125 mp; Țeavă DN 500 1,5 100 M.; Sudură 3; Beton 10000000 MC; Geotextil (fără cantitate)"
  },
  {
    "nume": "obiect doar cu cod sau doar cu nume; liniile fără obiect după cele cu obiect rămân în ordinea primei apariții",
    "intrare": {
      "santier": "S",
      "data": "2026-11-09",
      "linii": [
        {
          "obiect_cod": "OB3",
          "obiect_nume": null,
          "activitate": "Sudură",
          "um": "buc",
          "cantitate": 2,
          "bifa": false
        },
        {
          "obiect_cod": null,
          "obiect_nume": "Stația de robinete",
          "activitate": "Vopsire",
          "um": "mp",
          "cantitate": 4.75,
          "bifa": false
        },
        {
          "obiect_cod": "OB3",
          "obiect_nume": null,
          "activitate": "Radiografii",
          "um": "buc",
          "cantitate": 2,
          "bifa": false
        },
        {
          "obiect_cod": null,
          "obiect_nume": null,
          "activitate": "Curățenie",
          "um": null,
          "cantitate": 1,
          "bifa": true
        }
      ]
    },
    "asteptat": "S · 09.11.2026\nLucrări OB3: Sudură 2 buc; Radiografii 2 buc\nLucrări Stația de robinete: Vopsire 4,75 mp\nLucrări: Curățenie (efectuat)"
  },
  {
    "nume": "text lung în observații: tăiere pe cuvinte la 240; cuvânt unic lung tăiat la limită; text de exact 240 rămâne întreg",
    "intrare": {
      "santier": "S",
      "data": "2026-11-09",
      "lucrari": "lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrareX",
      "probleme": "lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare",
      "masini": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    },
    "asteptat": "S · 09.11.2026\nLucrări: lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrareX\nProbleme: lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare lucrare… · Mașini: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…"
  },
  {
    "nume": "caractere speciale: diacritice, ghilimele românești, emoji, etichete HTML, rânduri noi și taburi în text; proiectul identic cu șantierul nu se repetă",
    "intrare": {
      "santier": "  Șantier „Bărăgan”  🚧 ",
      "proiect": "Șantier „Bărăgan” 🚧",
      "data": "2026-11-09",
      "utilaje": [
        "nu e obiect",
        {
          "nume": "Pompă\tdrenaj",
          "stare": "nefunctional",
          "motiv": "linia 1\nlinia 2\r\n  linia 3"
        }
      ],
      "lucrari": "<b>ș ț Ș Ț ă î â</b> &amp; \"citat\"\n\tdupă tab",
      "probleme": "   \n\t  "
    },
    "asteptat": "Șantier „Bărăgan” 🚧 · 09.11.2026\nUtilaje: 2 (nefuncționale: Pompă drenaj – linia 1 linia 2 linia 3)\nLucrări: <b>ș ț Ș Ț ă î â</b> &amp; \"citat\" după tab"
  },
  {
    "nume": "fără lucrări pe activități: textul liber devine „Lucrări:”; oameni doar pe categorii (fără total); distribuție gaze",
    "intrare": {
      "santier": "Distribuție Ploiești",
      "proiect": "Rețea str. Exemplu",
      "data": "2026-11-08",
      "personal": {
        "sudori": 2,
        "necalificati": 3,
        "categorie_noua": 5
      },
      "linii": [],
      "distributie": {
        "conducte": 3,
        "bransamente": 0
      },
      "lucrari": "Montaj conductă PE 110 pe str. Exemplu.",
      "masini": "Dacia: bec far stânga ars",
      "poze": 4
    },
    "asteptat": "Distribuție Ploiești (proiect Rețea str. Exemplu) · 08.11.2026\nOameni: sudori 2, necalificați 3 · Poze: 4\nDistribuție gaze (rânduri): conducte 3\nLucrări: Montaj conductă PE 110 pe str. Exemplu.\nMașini: Dacia: bec far stânga ars"
  },
  {
    "nume": "valori de alt tip nu se interpretează (text în loc de număr, dată invalidă, listă în loc de obiect)",
    "intrare": {
      "santier": "S",
      "data": "10.11.2026",
      "meteo": {
        "temp": "8",
        "precip_mm": "3",
        "alerte": "Cod galben"
      },
      "personal": {
        "total": "12",
        "sudori": "2"
      },
      "utilaje": {
        "nume": "nu e listă"
      },
      "linii": [
        {
          "activitate": "Sudură",
          "um": "buc",
          "cantitate": "4",
          "bifa": "true"
        }
      ],
      "poze": "3"
    },
    "asteptat": "S\nLucrări: Sudură (fără cantitate)"
  },
  {
    "nume": "cuvânt terminat exact la limită (următorul caracter e spațiu): rămâne întreg",
    "intrare": {
      "santier": "S",
      "data": "2026-11-09",
      "probleme": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx abcd efgh",
      "masini": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx abcd efgh"
    },
    "asteptat": "S · 09.11.2026\nProbleme: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx abcd… · Mașini: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx abcd…"
  }
]$cazuri$;
  -- CAZURI-END
BEGIN
  FOR c IN SELECT x FROM jsonb_array_elements(v_cazuri) x LOOP
    v := public.fn_raport_rezumat_text(c -> 'intrare');
    IF v IS DISTINCT FROM c ->> 'asteptat' THEN
      RAISE EXCEPTION 'T1 FAIL (%): SQL dă %, JS / așteptat %', c ->> 'nume', to_jsonb(v), c -> 'asteptat';
    END IF;
    n := n + 1;
  END LOOP;
  IF n < 8 THEN RAISE EXCEPTION 'T1 FAIL: doar % cazuri', n; END IF;
  IF public.fn_raport_rezumat_text(NULL) <> 'Raport zilnic' OR public.fn_raport_rezumat_text('[1]') <> 'Raport zilnic'
     OR public.fn_raport_rezumat_text('"text"') <> 'Raport zilnic' THEN
    RAISE EXCEPTION 'T1 FAIL: intrarea care nu e obiect';
  END IF;
  RAISE NOTICE 'T1 OK (% cazuri, identice cu JS)', n;
END $t$;

-- ── T2: salvarea prin RPC (ca șeful): rezumatul automat pe conținutul FINAL (liniile scrise după antet), versiunea neatinsă ──
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; z public.rapoarte_zilnice; a1 bigint := pg_temp.t_g('a1')::bigint; a2 bigint := pg_temp.t_g('a2')::bigint; u1 bigint := pg_temp.t_g('u1')::bigint;
BEGIN
  r := pg_temp.t_salv(DATE '2001-01-02', jsonb_build_object('personal_snapshot', jsonb_build_object('sudori', 2, 'total', 2), 'probleme', 'Test rezumat',
                                                            'utilaje_snapshot', '[]'::jsonb, 'poze', '[]'::jsonb),
                      jsonb_build_array(jsonb_build_object('activitate_id', a1, 'unitate_id', u1, 'cantitate', 12.5),
                                        jsonb_build_object('activitate_id', a2, 'unitate_id', NULL, 'cantitate', 1)),
                      0, '00000000-0000-4000-8000-0000000000a1');
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR (r ->> 'versiune')::int <> 1 THEN RAISE EXCEPTION 'T2 FAIL: salvarea %', r; END IF;
  PERFORM set_config('trez.r1', r ->> 'raport_id', true);
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  z := pg_temp.t_r((r ->> 'raport_id')::bigint);
  IF z.rezumat_sursa IS DISTINCT FROM 'automat' OR z.rezumat_de IS NOT NULL OR z.rezumat_la IS NULL
     OR z.rezumat_text IS DISTINCT FROM public.fn_raport_rezumat_text(public.fn_raport_rezumat_intrare(z))
     OR position('Lucrări TRZ1 · Tronson test rezumat: Sudură test rezumat 12,5 buc' IN z.rezumat_text) = 0
     OR position('Lucrări: Probă test rezumat (efectuat)' IN z.rezumat_text) = 0
     OR position('Oameni: 2 (sudori 2)' IN z.rezumat_text) = 0 OR position('Probleme: Test rezumat' IN z.rezumat_text) = 0 THEN
    RAISE EXCEPTION 'T2 FAIL: rezumatul după salvare %', to_jsonb(z.rezumat_text);
  END IF;
  -- versiunea = cea întoarsă de RPC (rezumatul refăcut după jurnal nu o mărește), jurnalul are aceeași versiune
  IF z.versiune_salvare <> 1 OR (SELECT versiune FROM public.raport_zilnic_salvari WHERE cheie = '00000000-0000-4000-8000-0000000000a1') <> 1 THEN
    RAISE EXCEPTION 'T2 FAIL: versiunea % după rezumat', z.versiune_salvare;
  END IF;
  PERFORM pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
  -- citirea din telefon întoarce rezumatul (to_jsonb pe rând)
  r := public.fn_raport_zilnic_citeste(pg_temp.t_g('s1')::bigint, DATE '2001-01-02');
  IF r -> 'raport' ->> 'rezumat_sursa' IS DISTINCT FROM 'automat' OR (r ->> 'versiune')::int <> 1 OR r -> 'raport' ->> 'rezumat_text' IS NULL THEN
    RAISE EXCEPTION 'T2 FAIL: citirea %', r -> 'raport';
  END IF;
  RAISE NOTICE 'T2 OK';
END $t$;

-- ── T3: a doua salvare refăcută; reluarea aceleiași intenții = duplicat FĂRĂ conflict fals; versiunea veche = conflict (CAS-ul rămâne) ──
DO $t$
DECLARE r jsonb; a1 bigint := pg_temp.t_g('a1')::bigint; u1 bigint := pg_temp.t_g('u1')::bigint; l jsonb;
BEGIN
  l := jsonb_build_array(jsonb_build_object('activitate_id', a1, 'unitate_id', u1, 'cantitate', 7));
  r := pg_temp.t_salv(DATE '2001-01-02', '{"probleme": "Test rezumat 2"}'::jsonb, l, 1, '00000000-0000-4000-8000-0000000000a2');
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR (r ->> 'versiune')::int <> 2 THEN RAISE EXCEPTION 'T3 FAIL: salvarea 2 %', r; END IF;
  r := pg_temp.t_salv(DATE '2001-01-02', '{"probleme": "Test rezumat 2"}'::jsonb, l, 1, '00000000-0000-4000-8000-0000000000a2');
  IF r ->> 'duplicat' IS DISTINCT FROM 'true' OR (r ->> 'versiune')::int <> 2 OR (r ->> 'versiune_curenta')::int <> 2 THEN
    RAISE EXCEPTION 'T3 FAIL: reluarea (conflict fals din rezumat?) %', r;
  END IF;
  r := pg_temp.t_salv(DATE '2001-01-02', '{"probleme": "vechi"}'::jsonb, NULL, 1, '00000000-0000-4000-8000-0000000000a3');
  IF r ->> 'ok' IS DISTINCT FROM 'false' OR r ->> 'motiv' IS DISTINCT FROM 'conflict' THEN RAISE EXCEPTION 'T3 FAIL: CAS %', r; END IF;
  r := public.fn_raport_zilnic_citeste(pg_temp.t_g('s1')::bigint, DATE '2001-01-02');
  IF position('Sudură test rezumat 7 buc' IN r -> 'raport' ->> 'rezumat_text') = 0 OR position('12,5' IN r -> 'raport' ->> 'rezumat_text') > 0
     OR position('Probă test rezumat' IN r -> 'raport' ->> 'rezumat_text') > 0 OR position('Probleme: Test rezumat 2' IN r -> 'raport' ->> 'rezumat_text') = 0 THEN
    RAISE EXCEPTION 'T3 FAIL: rezumatul nu urmează ultima salvare %', to_jsonb(r -> 'raport' ->> 'rezumat_text');
  END IF;
  RAISE NOTICE 'T3 OK';
END $t$;

-- ── T4: corectura omului: refuzurile (fără drept, gol, prea lung, sursă invalidă), apoi corectura validă (autorul / ora puse de server) ──
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$
DECLARE n integer;
BEGIN
  -- fără drept pe șantier: refuz (garda din BD, indiferent de RLS) sau 0 rânduri (RLS-ul de azi)
  BEGIN
    EXECUTE format($q$UPDATE public.rapoarte_zilnice SET rezumat_text = 'intrus', rezumat_sursa = 'editat' WHERE id = %s$q$, pg_temp.t_g('r1'));
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'T4a FAIL: un cont fără drept a corectat rezumatul'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'T4a OK';
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$
DECLARE z public.rapoarte_zilnice; r text := pg_temp.t_g('r1'); n integer;
BEGIN
  IF NOT pg_temp.t_refuza(format($q$UPDATE public.rapoarte_zilnice SET rezumat_text = E'  \n ', rezumat_sursa = 'editat' WHERE id = %s$q$, r), '22023')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.rapoarte_zilnice SET rezumat_text = NULL, rezumat_sursa = 'editat' WHERE id = %s$q$, r), '22023')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.rapoarte_zilnice SET rezumat_text = repeat('x', 4001), rezumat_sursa = 'editat' WHERE id = %s$q$, r), '22023')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.rapoarte_zilnice SET rezumat_text = 'a', rezumat_sursa = 'altceva' WHERE id = %s$q$, r), '22023')
     OR NOT pg_temp.t_refuza(format($q$UPDATE public.rapoarte_zilnice SET rezumat_sursa = NULL WHERE id = %s$q$, r), '22023') THEN
    RAISE EXCEPTION 'T4 FAIL: un text corectat invalid a trecut';
  END IF;
  -- exact 4000 de caractere trece; autorul / ora trimise de client sunt înlocuite (L08); CAS pe versiune ca în aplicație
  n := pg_temp.t_trece(format($q$UPDATE public.rapoarte_zilnice SET rezumat_text = repeat('y', 4000), rezumat_sursa = 'editat',
                                   rezumat_de = %L, rezumat_la = '2000-01-01' WHERE id = %s AND versiune_salvare = 2$q$, pg_temp.t_g('own'), r));
  IF n <> 1 THEN RAISE EXCEPTION 'T4 FAIL: corectura validă a atins % rânduri (RLS-ul de azi îi interzice șefului UPDATE pe rapoarte_zilnice?)', n; END IF;
  n := pg_temp.t_trece(format($q$UPDATE public.rapoarte_zilnice SET rezumat_text = 'Text corectat de om', rezumat_sursa = 'editat' WHERE id = %s AND versiune_salvare = 3$q$, r));
  IF n <> 1 THEN RAISE EXCEPTION 'T4 FAIL: a doua corectură (CAS pe versiunea 3) %', n; END IF;
  -- CAS: o corectură pe o versiune veche nu atinge nimic
  n := pg_temp.t_trece(format($q$UPDATE public.rapoarte_zilnice SET rezumat_text = 'vechi', rezumat_sursa = 'editat' WHERE id = %s AND versiune_salvare = 3$q$, r));
  IF n <> 0 THEN RAISE EXCEPTION 'T4 FAIL: corectura pe versiune veche a scris'; END IF;
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  z := pg_temp.t_r(r::bigint);
  IF z.rezumat_sursa <> 'editat' OR z.rezumat_text <> 'Text corectat de om' OR z.rezumat_de IS DISTINCT FROM pg_temp.t_g('sef')::uuid
     OR z.rezumat_la < now() - interval '1 hour' OR z.versiune_salvare <> 4 THEN
    RAISE EXCEPTION 'T4 FAIL: corectura % / % / % / v%', z.rezumat_sursa, z.rezumat_de, z.rezumat_la, z.versiune_salvare;
  END IF;
  PERFORM pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
  RAISE NOTICE 'T4 OK';
END $t$;

-- ── T5: salvarea prin RPC și scrierea directă a antetului NU suprascriu textul corectat ──
DO $t$
DECLARE r jsonb; z public.rapoarte_zilnice; a1 bigint := pg_temp.t_g('a1')::bigint; u1 bigint := pg_temp.t_g('u1')::bigint;
BEGIN
  r := pg_temp.t_salv(DATE '2001-01-02', '{"probleme": "Test rezumat 3"}'::jsonb,
                      jsonb_build_array(jsonb_build_object('activitate_id', a1, 'unitate_id', u1, 'cantitate', 9)), 4, '00000000-0000-4000-8000-0000000000a4');
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR (r ->> 'versiune')::int <> 5 THEN RAISE EXCEPTION 'T5 FAIL: salvarea %', r; END IF;
  IF pg_temp.t_trece(format($q$UPDATE public.rapoarte_zilnice SET probleme = 'Direct' WHERE id = %s$q$, pg_temp.t_g('r1'))) <> 1 THEN
    RAISE EXCEPTION 'T5 FAIL: scrierea directă a antetului';
  END IF;
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  z := pg_temp.t_r(pg_temp.t_g('r1')::bigint);
  IF z.rezumat_sursa <> 'editat' OR z.rezumat_text <> 'Text corectat de om' OR z.versiune_salvare <> 6 OR z.probleme <> 'Direct' THEN
    RAISE EXCEPTION 'T5 FAIL: textul corectat a fost atins (% / %) sau versiunea % nu a crescut', z.rezumat_sursa, z.rezumat_text, z.versiune_salvare;
  END IF;
  PERFORM pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
  RAISE NOTICE 'T5 OK';
END $t$;

-- ── T6: „Revino la automat”: fără drept = refuz; cu drept = textul îl scrie serverul (cel trimis de client e ignorat), versiunea rămâne ──
SELECT pg_temp.t_ca(pg_temp.t_g('fara')::uuid, 'authenticated');
DO $t$
DECLARE n integer;
BEGIN
  BEGIN
    EXECUTE format($q$UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat' WHERE id = %s$q$, pg_temp.t_g('r1'));
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'T6a FAIL: un cont fără drept a șters corectura'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'T6a OK';
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$
DECLARE z public.rapoarte_zilnice;
BEGIN
  IF pg_temp.t_trece(format($q$UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat', rezumat_text = 'fals', rezumat_de = %L
                                 WHERE id = %s AND versiune_salvare = 6$q$, pg_temp.t_g('own'), pg_temp.t_g('r1'))) <> 1 THEN
    RAISE EXCEPTION 'T6 FAIL: revenirea la automat';
  END IF;
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  z := pg_temp.t_r(pg_temp.t_g('r1')::bigint);
  IF z.rezumat_sursa <> 'automat' OR z.rezumat_text = 'fals' OR z.rezumat_de IS NOT NULL OR z.versiune_salvare <> 6
     OR z.rezumat_text IS DISTINCT FROM public.fn_raport_rezumat_text(public.fn_raport_rezumat_intrare(z))
     OR position('Sudură test rezumat 9 buc' IN z.rezumat_text) = 0 OR position('Probleme: Direct' IN z.rezumat_text) = 0 THEN
    RAISE EXCEPTION 'T6 FAIL: % / % / v%', z.rezumat_sursa, to_jsonb(z.rezumat_text), z.versiune_salvare;
  END IF;
  PERFORM pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
  RAISE NOTICE 'T6 OK';
END $t$;

-- ── T7: căile directe (telefonul vechi, alte module): antetul scris direct reface rezumatul automat (versiunea crește: e o scriere a
--    raportului); un text „automat” trimis de client e înlocuit, fără să mărească versiunea; autorul trimis de client e șters ──
DO $t$
DECLARE z public.rapoarte_zilnice; r text := pg_temp.t_g('r1');
BEGIN
  IF pg_temp.t_trece(format($q$UPDATE public.rapoarte_zilnice SET probleme = 'Al doilea' WHERE id = %s$q$, r)) <> 1
     OR pg_temp.t_trece(format($q$UPDATE public.rapoarte_zilnice SET rezumat_text = 'fals2' WHERE id = %s$q$, r)) <> 1
     OR pg_temp.t_trece(format($q$UPDATE public.rapoarte_zilnice SET rezumat_de = %L, rezumat_la = '2000-01-01' WHERE id = %s$q$, pg_temp.t_g('own'), r)) <> 1 THEN
    RAISE EXCEPTION 'T7 FAIL: scrierile directe';
  END IF;
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  z := pg_temp.t_r(r::bigint);
  IF z.rezumat_sursa <> 'automat' OR z.rezumat_text = 'fals2' OR position('Probleme: Al doilea' IN z.rezumat_text) = 0
     OR z.rezumat_de IS NOT NULL OR z.rezumat_la < now() - interval '1 hour' OR z.versiune_salvare <> 7 THEN
    RAISE EXCEPTION 'T7 FAIL: % / % / % / v%', z.rezumat_sursa, to_jsonb(z.rezumat_text), z.rezumat_de, z.versiune_salvare;
  END IF;
  -- raport nou scris direct (fără RPC), cu un rezumat „editat” falsificat: devine automat
  INSERT INTO public.rapoarte_zilnice (site_id, data, probleme, created_by, updated_at, rezumat_text, rezumat_sursa, rezumat_de, rezumat_la)
  VALUES (pg_temp.t_g('s1')::bigint, DATE '2001-01-03', 'Nou direct', pg_temp.t_g('sef')::uuid, now(), 'forjat', 'editat', pg_temp.t_g('own')::uuid, '2000-01-01')
  RETURNING * INTO z;
  IF z.rezumat_sursa <> 'automat' OR z.rezumat_text = 'forjat' OR z.rezumat_de IS NOT NULL OR position('Probleme: Nou direct' IN z.rezumat_text) = 0
     OR z.versiune_salvare <> 1 THEN
    RAISE EXCEPTION 'T7 FAIL: inserarea directă % / %', z.rezumat_sursa, to_jsonb(z.rezumat_text);
  END IF;
  RAISE NOTICE 'T7 OK';
END $t$;

-- ── T8: funcțiile nu sunt apelabile din API; jurnalul nu e scriibil de clienți ──
SELECT pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
DO $t$
BEGIN
  IF NOT pg_temp.t_refuza($q$SELECT public.fn_raport_rezumat_text('{}'::jsonb)$q$, '42501')
     OR NOT pg_temp.t_refuza(format($q$SELECT public.fn_raport_rezumat_intrare(z) FROM public.rapoarte_zilnice z WHERE z.id = %s$q$, pg_temp.t_g('r1')), '42501')
     OR NOT pg_temp.t_refuza($q$SELECT public.fn_raport_rezumat_taie('abc', 1)$q$, '42501')
     OR NOT pg_temp.t_refuza(format($q$INSERT INTO public.raport_zilnic_salvari (cheie, raport_id, versiune, amprenta, profile_id)
                                     VALUES (gen_random_uuid(), %s, 99, md5('x'), auth.uid())$q$, pg_temp.t_g('r1')), '42501') THEN
    RAISE EXCEPTION 'T8 FAIL: funcții / jurnal accesibile clientului';
  END IF;
  RAISE NOTICE 'T8 OK';
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');

-- ── T9: revenirea — nearmată = refuz; armată cu un rezumat corectat = refuz; armată fără = scoate tot; re-aplicare ──
UPDATE public.rapoarte_zilnice SET rezumat_text = 'Corectat pentru T9', rezumat_sursa = 'editat' WHERE id = pg_temp.t_g('r1')::bigint;
SAVEPOINT t9a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261215a_executie_raport_rezumat_ROLLBACK.sql
\set t9a_eroare :ERROR
\set t9a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t9a;
SELECT pg_temp.t_eroare('T9a', :'t9a_eroare', :'t9a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t9b;
SELECT set_config('gazpet.revenire_20261215a', 'SCOATE_REZUMAT_RAPORT:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261215a_executie_raport_rezumat_ROLLBACK.sql
\set t9b_eroare :ERROR
\set t9b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t9b;
SELECT pg_temp.t_eroare('T9b', :'t9b_eroare', :'t9b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'rezumate corectate de om');
-- fără corecturi: revenirea armată scoate tot; RPC-ul de salvare merge ca înainte de migrare
UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat' WHERE rezumat_sursa = 'editat' AND site_id = pg_temp.t_g('s1')::bigint AND data = DATE '2001-01-02';
SELECT set_config('gazpet.revenire_20261215a', 'SCOATE_REZUMAT_RAPORT:' || txid_current(), true);
\ir ../supabase/revenire/20261215a_executie_raport_rezumat_ROLLBACK.sql
DO $t$
DECLARE r jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice' AND column_name LIKE 'rezumat\_%')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn\_raport\_rezumat\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_raport_zilnic_zz_rezumat', 'trg_raport_zilnic_salvari_rezumat'))
     OR current_setting('gazpet.revenire_20261215a', true) <> '' THEN
    RAISE EXCEPTION 'T9 FAIL: revenirea a lăsat obiecte sau armarea';
  END IF;
  PERFORM pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
  r := public.fn_raport_zilnic_citeste(pg_temp.t_g('s1')::bigint, DATE '2001-01-02');
  r := pg_temp.t_salv(DATE '2001-01-02', '{"probleme": "după revenire"}'::jsonb, NULL, (r ->> 'versiune')::int, '00000000-0000-4000-8000-0000000000a5');
  IF r ->> 'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T9 FAIL: salvarea după revenire %', r; END IF;
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  RAISE NOTICE 'T9 OK (revenire)';
END $t$;
SELECT set_config('gazpet.livrare_migrare', '20261215a_executie_raport_rezumat:' || txid_current(), true);
\ir ../supabase/migrations/20261215a_executie_raport_rezumat.sql
DO $t$
DECLARE r jsonb; z public.rapoarte_zilnice;
BEGIN
  PERFORM pg_temp.t_ca(pg_temp.t_g('sef')::uuid, 'authenticated');
  r := public.fn_raport_zilnic_citeste(pg_temp.t_g('s1')::bigint, DATE '2001-01-02');
  IF r -> 'raport' ->> 'rezumat_sursa' IS NOT NULL THEN RAISE EXCEPTION 'T9 FAIL: re-aplicarea a scris rezumate'; END IF;
  r := pg_temp.t_salv(DATE '2001-01-02', '{"probleme": "după re-aplicare"}'::jsonb, NULL, (r ->> 'versiune')::int, '00000000-0000-4000-8000-0000000000a6');
  PERFORM pg_temp.t_ca(NULL, 'postgres');
  z := pg_temp.t_r((r ->> 'raport_id')::bigint);
  IF r ->> 'ok' IS DISTINCT FROM 'true' OR z.rezumat_sursa <> 'automat' OR position('Probleme: după re-aplicare' IN z.rezumat_text) = 0
     OR z.versiune_salvare <> (r ->> 'versiune')::int THEN
    RAISE EXCEPTION 'T9 FAIL: după re-aplicare % / %', r, to_jsonb(z.rezumat_text);
  END IF;
  RAISE NOTICE 'T9 OK (re-aplicare)';
END $t$;
ROLLBACK;
