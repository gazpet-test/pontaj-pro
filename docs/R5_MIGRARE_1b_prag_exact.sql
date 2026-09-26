-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- R5 — migrarea 1b (Copilot, runda de închidere R4/R5, 26.09.2026, condiția nr. 1 — „pragul”) — PROPUSĂ, NEAPLICATĂ.
-- Se aplică DOAR cu GO Razvan, prin apply_migration (nume propus: r5_1b_prag_exact). Rollback: docs/R5_MIGRARE_1b_prag_exact_ROLLBACK.sql.
--
-- Copilot: „aprobat 100 m, citire nouă 100,8 m → e ALTĂ cantitate. La bucăți / suprafețe / volume pragul «1 m» nici nu se aplică.
--  Comparație EXACTĂ a valorii canonice aprobate (excepție doar diferențe pur reprezentative: 100 vs 100,000). Pragurile absolute /
--  relative decid SEVERITATEA avertismentului, nu transferul aprobării asupra altei valori. Nu amesteci rolurile.”
--
-- PORNEȘTE EXACT de la definiția APLICATĂ în producție (migrarea r5_aprobare_istoric, 26.09.2026 09:08 UTC), citită cu
-- SELECT pg_get_functiondef('public.fn_trg_ofertare_cantitati_aprobare()'::regprocedure) — md5(prosrc) = df25b1ba4f392f10789f6f4e18e8eaaf.
-- Comparată cu docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql: LOGICA e identică (după scoaterea comentariilor și a rândurilor goale
-- md5 = 9df9c135e262cff143502dbfd46e98fb în ambele; funcțiile ajutătoare ofertare_cantitati_atribute / ofertare_fmt_ro /
-- ofertare_norm_text — identice octet cu octet). Diferențe doar de formă ale migrării aplicate față de fișier: (1) comentariile „--” și
-- rândurile goale au fost scoase (textul aplicat = fișierul fără ele, md5 c2839216336369f1fcbc0fb3c7825b38, 14.749 caractere);
-- (2) ultima instrucțiune a fișierului, COMMENT ON FUNCTION public.fn_trg_ofertare_cantitati_aprobare(), NU a fost aplicată — funcția
-- n-are comentariu în producție (obj_description = NULL). Rollback-ul 1b reface exact această stare (corp identic, fără comentariu).
--
-- Ce schimbă 1b (DOAR funcția trigger-ului; CREATE OR REPLACE păstrează OID-ul — trigger-ele trg_zz_… nu se recreează —, proprietarul
-- și drepturile; tabelul, CHECK-ul, istoricul, funcțiile ajutătoare, view-urile: neatinse; niciun rând de date nu se modifică la aplicare):
--   1) cifrele (cantitate, cifra din planșă efectivă): comparație EXACTĂ a valorii canonice, pe orice unitate — round(x, 6)
--      (6 zecimale: 100 = 100,000 = 100,0000001; 100 ≠ 100,8). Înainte: |Δ| ≥ 1 pe m / ml / fără unitate (v_tol), deci 100 → 100,8 m
--      lăsa rândul „validat” (istoric 'modificat_sub_prag'). Acum 100 → 100,8 m = invalidare („diferenta”, nota, istoric 'invalidat'
--      cu valoarea aprobată în aprobare_veche / valori_aprobate). Nicio conversie m ↔ ml (unitatea rămâne comparată normalizat — „m” →
--      „M” e doar formă, „m” → „ml” invalidează, ca înainte).
--   2) SEVERITATEA în notă (doar text, nu decide nimic): „s-a schimbat cantitatea (100 m → 100,8 m; diferență mică: +0,8 m, +0,8 %)”.
--      Mică = sub 1 % relativ ȘI, pe unitățile de lungime (m / ml / fără unitate; cifra din planșă e mereu lungime), sub 1 m absolut;
--      pe buc / mp / mc / kg / to … doar pragul relativ (niciun prag în metri). |Δ| exact (valorile canonice, max. 6 zecimale:
--      „+0,001 mc”), procentul rotunjit la 2 zecimale, jumătatea în sus, prin aritmetică întreagă pe milionimi (div) — identic cu
--      descrieDiferenta din src/ofertareCantitatiInvalidare.js; procent rotunjit la 0 => „sub 0,01 %”; față de 0 nu există procent
--      (=> mare); unitatea normalizată diferită (m → buc) => fără severitate
--      (schimbarea de unitate e numită separat). Pe cifra din planșă, dacă una din cifre lipsește și se compară efectiv cu cantitatea:
--      „…, efectiv 1.100 m → 1.100,3 m”.
--   3) cifrele din notă poartă unitatea lor: cantitatea — a rândului (aprobată / nouă, coalesce(nullif(um, ''), 'm')); cifra din
--      planșă — „m”. Pentru um = 'm' / NULL / '' textul e cel de azi (înainte „ m” era fix și pe buc: „10 m → 11 m”).
--   4) motivul 'modificat_sub_prag' rămâne (e în CHECK-ul tabelului și în view-ul propus) — din 1b înseamnă „doar formă”: texte cu
--      majuscule / spații, unitatea „m” → „M”, cifre egale canonic (ex. 100 → 100,000 nu e nici măcar scriere distinctă; zgomot de
--      virgulă mobilă sub 6 zecimale). Nicio cifră cu altă valoare nu mai ajunge acolo.
--   5) REPARAȚIA RUNDEI 1 (verificatorul BD, minorii „severitatea la limită”, „cifrele din notă”, „caractere astrale”, „nota pe drumul fără
--      aplicație”; setul comun src/ofertareCantitati1b.cazuri.js: 43 de cazuri, nota SQL = JS octet cu octet):
--      a) pragul de 1 % se compară pe valoarea EXACTĂ (|Δ| × 100 < |a|, aritmetică întreagă), iar procentul AFIȘAT e TRUNCHIAT la 2
--         zecimale (div pe pozitive): 0,999 % => „diferență mică … +0,99 %” (înainte „diferență mare … +1 %”, decis pe procentul rotunjit);
--      b) cifrele din notă (aprobarea veche, schimbarea, „efectiv”) EXACTE — valoarea canonică cu toate zecimalele semnificative, max. 6
--         (to_char pe round(x, 6)): „100 m → 100,000001 m”, „1,084 mc → 1,085 mc” (înainte „100 m → 100 m”, „1,08 mc → 1,09 mc”);
--      c) tăierea textelor la 60 de caractere rămâne pe caractere (left / length — puncte de cod); JS-ul a fost aliniat (Array.from), ca să
--         nu mai lase un surogat singur;
--      d) când SINGURA schimbare relevantă e cifra din planșă (observația unei citiri — cantitatea aprobată, unitatea, textele au rămas),
--         nota spune „aprobarea veche (…) e de reverificat: s-a schimbat cifra din planșă (…) — o citire nouă a planșei nu infirmă
--         aprobarea. Valoarea și aprobarea veche rămân în rând și în istoric; validarea se reface.” (Copilot: recitirea justifică
--         reverificarea, nu concluzia că aprobarea umană era greșită). Statusul tot „diferenta”; prefixul și terminatorul — neschimbate.
-- Roluri (neschimbat, acum strict): `cantitate` = valoarea aprobată / folosită în ofertă; `cantitate_plansa` = observația-candidat a
-- citirii. O observație diferită de cea aprobată scoate rândul pe „diferenta” („de reverificat”); valoarea aprobată rămâne în rând
-- (transferul / CAD nu scriu `cantitate` pe un rând validat), în notă (prefixul numește aprobarea veche) și în istoric.
--
-- Compatibilitate cu codul PUBLICAT (main: edge ofertare-plansa-citeste v25, UI, cad-parse): nicio coloană / semnătură / tabel nou;
-- codul publicat nu citește istoricul și nu parsează nota regulii. Efect vizibil: o cifră schimbată cu < 1 m pe un rând validat îl
-- scoate acum din „validat” (înainte rămânea) — exact condiția Copilot; mai strict, nu mai permisiv. Nota păstrează prefixul
-- „Rândul era VALIDAT — aprobarea veche” și terminatorul „validarea se reface.” (prefixInvalidare / view-ul le recunosc la fel).
-- Identitate: SECURITY DEFINER (proprietar postgres), ca înainte — scrie doar în ofertare_cantitati_istoric; nu citește conținut extern,
-- nu trimite nimic, nu atinge bani sau drepturi.
--
-- Testat local pe PGlite 0.5.8 (Postgres 18.3 WASM; producția e PostgreSQL 17.6) cu rândurile REALE copiate prin SELECT pe 26.09.2026
-- (lic. 3 — cele 4 validate 2, 3, 4, 9 — + lic. 95 + un eșantion de 22 de rânduri, câte unul pe fiecare unitate din BD: buc, mc, to,
-- kg, mp, l, %, ore, NULL, sute m / mc / mp, M CUB, BUCATA, TONE, M, MP …; copiile verificate md5 pe textul jsonb, rând cu rând):
-- scratchpad pglite/test_1b_prag_exact.mjs — vezi docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md §12.
--
-- PREVIEW (doar SELECT, înainte):
--   SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_trg_ofertare_cantitati_aprobare()'::regprocedure;  -- df25b1ba4f392f10789f6f4e18e8eaaf
--   SELECT id, licitatie_id, um, cantitate, cantitate_plansa, updated_at FROM public.ofertare_cantitati WHERE status = 'validat' ORDER BY id;
--   (26.09.2026: 2, 3, 4, 9 — toate lic. 3)
--   SELECT count(*), count(*) FILTER (WHERE motiv = 'modificat_sub_prag') FROM public.ofertare_cantitati_istoric;   -- 26.09.2026: 0, 0
-- SANITY (după):
--   SELECT md5(prosrc) <> 'df25b1ba4f392f10789f6f4e18e8eaaf', prosecdef, proconfig FROM pg_proc WHERE oid = 'public.fn_trg_ofertare_cantitati_aprobare()'::regprocedure;
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.ofertare_cantitati'::regclass AND NOT tgisinternal ORDER BY 1;  -- aceleași 3
--   SELECT has_function_privilege('authenticated', 'public.fn_trg_ofertare_cantitati_aprobare()', 'EXECUTE');   -- false
--   SELECT status, count(*) FROM public.ofertare_cantitati GROUP BY 1;   -- identic cu înainte (extras 1080 / validat 4 / diferenta 2 pe 26.09)
--   SELECT count(*) FROM public.ofertare_cantitati_istoric;   -- identic cu înainte (aplicarea nu scrie nimic)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_cantitati_aprobare()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  c_campuri constant text[] := ARRAY['licitatie_id','um','cantitate','cantitate_plansa','denumire','specificatii','obiect','categorie','tip_sursa','sursa','cod_articol'];
  c_etichete constant jsonb := '{"licitatie_id":"licitația","um":"unitatea de măsură","cantitate":"cantitatea","cantitate_plansa":"cifra din planșă","denumire":"denumirea","specificatii":"specificațiile","obiect":"obiectul (tronson / etapă)","categorie":"categoria","tip_sursa":"tipul sursei","sursa":"sursa","cod_articol":"codul articolului (poziția din listă)"}';
  c_prefix constant text := 'Rândul era VALIDAT — aprobarea veche';
  c_final constant text := 'validarea se reface.';
  v_old jsonb; v_new jsonb; v_ref jsonb; v_sursa_ref text; k text; a text; b text; r text; v_distinct boolean; v_rel boolean;
  na numeric; nb numeric; nr numeric; ea numeric; eb numeric; v_rel_c text[] := '{}'; v_sub_c text[] := '{}'; v_desc text[] := '{}'; v_der text[] := '{}';
  ta jsonb; tb jsonb; d text; v_motiv text; v_nota text; v_status_cerut text; v_aprob jsonb; v_nou jsonb := '{}';
  v_rol text; v_ref_cant numeric; v_ref_cp numeric; v_ref_um text; v_ref_upd timestamptz;
  -- 1b: severitatea din notă (pereche cu descrieDiferenta din JS) și unitățile afișate
  v_sev text; v_u_vechi text; v_u_nou text; v_dmu numeric; v_amu numeric; v_pct numeric; v_lung boolean; v_semn text;
BEGIN
  BEGIN v_rol := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', session_user::text);
  EXCEPTION WHEN others THEN v_rol := session_user::text; END;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'validat' THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, valori_vechi, aprobare_veche, autor, rol)
      VALUES (OLD.id, OLD.licitatie_id, 'sters', OLD.status, to_jsonb(OLD),
              jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota),
              auth.uid(), v_rol);
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IS DISTINCT FROM 'validat' THEN
    -- validarea explicită (✓) și orice rând nevalidat: NEATINSE (ca înainte). VALIDAREA se înregistrează — rândul aprobat
    -- (valori_noi = rândul întreg) e referința cu care se compară scrierile următoare; schimbarea de unitate din / în „m”
    -- (normalizat) pe un rând nevalidat = 'unitate_schimbata' (semnal, fără modificare).
    IF NEW.status IS DISTINCT FROM 'validat'
       AND public.ofertare_norm_text(OLD.um) <> public.ofertare_norm_text(NEW.um)
       AND 'm' IN (public.ofertare_norm_text(OLD.um), public.ofertare_norm_text(NEW.um)) THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou, campuri,
                                                     valori_vechi, valori_noi, aprobare_veche, autor, rol)
      VALUES (OLD.id, NEW.licitatie_id, 'unitate_schimbata', OLD.status, NEW.status, NEW.status, ARRAY['um'], to_jsonb(OLD),
              jsonb_build_object('um', NEW.um),
              jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota),
              auth.uid(), v_rol);
    END IF;
    IF NEW.status = 'validat' THEN
      INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou,
                                                     valori_vechi, valori_noi, aprobare_veche, autor, rol)
      VALUES (OLD.id, NEW.licitatie_id, 'validat', OLD.status, NEW.status, NEW.status, to_jsonb(OLD), to_jsonb(NEW),
              jsonb_build_object('status', OLD.status, 'ultima_scriere', OLD.updated_at, 'cantitate', OLD.cantitate,
                                 'cantitate_plansa', OLD.cantitate_plansa, 'um', OLD.um, 'nota', OLD.diferenta_nota),
              auth.uid(), v_rol);
    END IF;
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  -- valoarea APROBATĂ (aceeași regulă ca referinteDinIstoric din JS)
  SELECT h.valori_noi INTO v_ref FROM public.ofertare_cantitati_istoric h
   WHERE h.cantitate_id = OLD.id AND h.motiv = 'validat' AND h.valori_noi IS NOT NULL ORDER BY h.id DESC LIMIT 1;
  v_sursa_ref := 'validare';
  IF v_ref IS NULL THEN
    SELECT h.valori_vechi INTO v_ref FROM public.ofertare_cantitati_istoric h
     WHERE h.cantitate_id = OLD.id AND h.motiv NOT IN ('validat', 'unitate_schimbata') ORDER BY h.id LIMIT 1;
    v_sursa_ref := 'prima_scriere_inregistrata';
  END IF;
  IF v_ref IS NULL THEN v_ref := v_old; v_sursa_ref := 'randul_curent'; END IF;
  v_ref_cant := (v_ref ->> 'cantitate')::numeric; v_ref_cp := (v_ref ->> 'cantitate_plansa')::numeric;
  v_ref_um := v_ref ->> 'um'; v_ref_upd := (v_ref ->> 'updated_at')::timestamptz;

  -- 1b: fără v_tol (toleranța de 1 m) — cifrele se compară EXACT, pe valoarea canonică round(x, 6)
  FOREACH k IN ARRAY c_campuri LOOP
    a := v_old ->> k; b := v_new ->> k; r := v_ref ->> k; v_sev := NULL;
    IF k IN ('cantitate', 'cantitate_plansa', 'licitatie_id') THEN
      na := a::numeric; nb := b::numeric; nr := r::numeric;
      v_distinct := na IS DISTINCT FROM nb;   -- numeric: 100 = 100.000 (doar forma) => nicio scriere distinctă
      IF NOT v_distinct THEN CONTINUE; END IF;
      IF k = 'licitatie_id' THEN v_rel := nr IS DISTINCT FROM nb;
      ELSE
        IF k = 'cantitate' THEN ea := nr; eb := nb;
        ELSE   -- cifra din planșă EFECTIVĂ (ca referintaCitire / cifraSchimbata), față de cea aprobată
          ea := coalesce(v_ref_cp, v_ref_cant); eb := coalesce(NEW.cantitate_plansa, NEW.cantitate);
        END IF;
        v_rel := round(ea, 6) IS DISTINCT FROM round(eb, 6);   -- 1b: exact (apariția / dispariția cifrei = schimbare)
        IF k = 'cantitate_plansa' THEN v_rel := v_rel AND round(nr, 6) IS DISTINCT FROM round(nb, 6); END IF;
        -- unitățile afișate: cantitatea în unitatea rândului (aprobată / nouă); cifra din planșă e o lungime
        v_u_vechi := CASE WHEN k = 'cantitate' THEN coalesce(nullif(v_ref_um, ''), 'm') ELSE 'm' END;
        v_u_nou := CASE WHEN k = 'cantitate' THEN coalesce(nullif(NEW.um, ''), 'm') ELSE 'm' END;
        -- severitatea (doar text): pe cifrele efective, ambele prezente, aceeași unitate normalizată
        IF v_rel AND ea IS NOT NULL AND eb IS NOT NULL
           AND (k = 'cantitate_plansa' OR public.ofertare_norm_text(v_ref_um) = public.ofertare_norm_text(NEW.um)) THEN
          v_lung := k = 'cantitate_plansa' OR public.ofertare_norm_text(NEW.um) IN ('', 'm', 'ml');
          v_dmu := (round(eb, 6) - round(ea, 6)) * 1000000;   -- Δ în milionimi (întreg exact)
          v_amu := abs(round(ea, 6)) * 1000000;
          v_semn := CASE WHEN v_dmu > 0 THEN '+' ELSE '-' END;
          -- reparația rundei 1: procentul AFIȘAT e TRUNCHIAT (div pe pozitive = floor), pragul se compară pe valoarea exactă (mai jos)
          v_pct := CASE WHEN v_amu = 0 THEN NULL ELSE div(abs(v_dmu) * 10000, v_amu) END;   -- sutimi de procent, trunchiat
          -- |Δ| exact, cu toate zecimalele semnificative (max. 6): „+0,8”, „+0,001”, „-1.110” (ca fmtMilionimi din JS)
          v_sev := 'diferență ' || CASE WHEN v_amu > 0 AND abs(v_dmu) * 100 < v_amu AND (NOT v_lung OR abs(v_dmu) < 1000000) THEN 'mică' ELSE 'mare' END || ': ' || v_semn ||
                   rtrim(rtrim(translate(to_char(abs(v_dmu) / 1000000, 'FM999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ',') || ' ' || v_u_nou ||
                   CASE WHEN v_pct IS NULL THEN '' WHEN v_pct = 0 THEN ', sub 0,01 %' ELSE ', ' || v_semn || public.ofertare_fmt_ro(v_pct / 100) || ' %' END ||
                   CASE WHEN k = 'cantitate_plansa' AND (nr IS NULL OR nb IS NULL)
                        THEN ', efectiv ' || coalesce(rtrim(rtrim(translate(to_char(round(ea, 6), 'FM999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || ' m → ' || coalesce(rtrim(rtrim(translate(to_char(round(eb, 6), 'FM999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || ' m' ELSE '' END;
        END IF;
      END IF;
    ELSIF k = 'um' THEN   -- unitatea NORMALIZATĂ (ca normUm din JS și filtrele de rețea ale view-ului / v6)
      v_distinct := coalesce(a, '') <> coalesce(b, '');
      IF NOT v_distinct THEN CONTINUE; END IF;
      v_rel := public.ofertare_norm_text(r) <> public.ofertare_norm_text(b);
    ELSE
      v_distinct := coalesce(a, '') <> coalesce(b, '');
      IF NOT v_distinct THEN CONTINUE; END IF;
      v_rel := public.ofertare_norm_text(r) <> public.ofertare_norm_text(b);
    END IF;
    v_nou := v_nou || jsonb_build_object(k, v_new -> k);
    IF v_rel THEN
      v_rel_c := v_rel_c || k;
      v_desc := v_desc || format('%s (%s → %s%s)', c_etichete ->> k,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN coalesce(rtrim(rtrim(translate(to_char(round(r::numeric, 6), 'FM999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || CASE WHEN r IS NULL THEN '' ELSE ' ' || v_u_vechi END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(r, '—')
             ELSE '„' || CASE WHEN length(coalesce(r, '—')) > 60 THEN left(coalesce(r, '—'), 59) || '…' ELSE coalesce(r, '—') END || '”' END,
        CASE WHEN k IN ('cantitate', 'cantitate_plansa') THEN coalesce(rtrim(rtrim(translate(to_char(round(b::numeric, 6), 'FM999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || CASE WHEN b IS NULL THEN '' ELSE ' ' || v_u_nou END
             WHEN k = 'licitatie_id' THEN '#' || coalesce(b, '—')
             ELSE '„' || CASE WHEN length(coalesce(b, '—')) > 60 THEN left(coalesce(b, '—'), 59) || '…' ELSE coalesce(b, '—') END || '”' END,
        CASE WHEN v_sev IS NULL THEN '' ELSE '; ' || v_sev END);
    ELSE
      v_sub_c := v_sub_c || k;
    END IF;
  END LOOP;

  IF 'denumire' = ANY (v_rel_c) OR 'specificatii' = ANY (v_rel_c) THEN
    ta := public.ofertare_cantitati_atribute(coalesce(v_ref ->> 'denumire', '') || ' ' || coalesce(v_ref ->> 'specificatii', ''));
    tb := public.ofertare_cantitati_atribute(coalesce(NEW.denumire, '') || ' ' || coalesce(NEW.specificatii, ''));
    FOREACH d IN ARRAY ARRAY['dn', 'material', 'sdr'] LOOP
      IF (ta ->> d) IS DISTINCT FROM (tb ->> d) THEN
        v_der := v_der || format('%s %s → %s', CASE d WHEN 'dn' THEN 'Dn' WHEN 'material' THEN 'materialul' ELSE 'SDR' END,
                                 coalesce(ta ->> d, '—'), coalesce(tb ->> d, '—'));
      END IF;
    END LOOP;
  END IF;

  v_status_cerut := NEW.status;
  IF array_length(v_rel_c, 1) > 0 THEN
    v_motiv := 'invalidat';
    IF NEW.status = 'validat' THEN
      v_nota := coalesce(NEW.diferenta_nota, '');
      -- orice prefix de invalidare anterior (al regulii sau „Rândul era VALIDAT cu … —” al transferului) se taie: fără prefixe adunate
      IF v_nota LIKE 'Rândul era VALIDAT%' AND strpos(v_nota, c_final) > 0 THEN
        v_nota := ltrim(substr(v_nota, strpos(v_nota, c_final) + length(c_final)));
      END IF;
      -- reparația rundei 1: cifrele aprobate EXACT (max. 6 zecimale); SINGURA schimbare relevantă = cifra din planșă (observația unei
      -- citiri) => „e de reverificat … o citire nouă a planșei nu infirmă aprobarea” (pereche cu notaInvalidare / doarObservatiePlansa)
      v_nota := format(CASE WHEN v_rel_c = ARRAY['cantitate_plansa'] AND cardinality(v_der) = 0
                  THEN '%s (cantitate %s%s%s%s) e de reverificat: s-a schimbat %s — o citire nouă a planșei nu infirmă aprobarea. Valoarea și aprobarea veche rămân în rând și în istoric; %s '
                  ELSE '%s (cantitate %s%s%s%s) nu mai e valabilă: s-a schimbat %s. Valoarea și aprobarea veche rămân în istoric; %s ' END,
                  c_prefix, coalesce(rtrim(rtrim(translate(to_char(round(v_ref_cant, 6), 'FM999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—'), CASE WHEN v_ref_cant IS NULL THEN '' ELSE ' ' || coalesce(nullif(v_ref_um, ''), 'm') END,
                  CASE WHEN v_ref_cp IS NULL THEN '' ELSE ', cifra din planșă ' || coalesce(rtrim(rtrim(translate(to_char(round(v_ref_cp, 6), 'FM999,999,999,999,999,990.000000'), ',.', '.,'), '0'), ','), '—') || ' m' END,
                  CASE WHEN v_ref_upd IS NULL THEN '' ELSE ', ultima scriere ' || to_char(v_ref_upd AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') END,
                  array_to_string(v_der || v_desc, '; '), c_final) || v_nota;
      NEW.status := 'diferenta';
      NEW.diferenta_nota := v_nota;
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'validat' THEN
    v_motiv := 'redeschis';
  ELSIF array_length(v_sub_c, 1) > 0 THEN
    v_motiv := 'modificat_sub_prag';   -- 1b: doar formă (texte, „m” → „M”, cifre egale canonic) — validarea rămâne
  ELSE
    RETURN NEW;   -- nimic din aprobare atins (doar notă, ordine, updated_at, extras_de_ai)
  END IF;

  v_aprob := jsonb_build_object('status', OLD.status, 'ultima_scriere', v_ref -> 'updated_at', 'cantitate', v_ref -> 'cantitate',
                                'cantitate_plansa', v_ref -> 'cantitate_plansa', 'um', v_ref -> 'um', 'nota', v_ref -> 'diferenta_nota',
                                'referinta', v_sursa_ref, 'valori_aprobate', CASE WHEN v_sursa_ref = 'randul_curent' THEN NULL ELSE v_ref END);
  INSERT INTO public.ofertare_cantitati_istoric (cantitate_id, licitatie_id, motiv, status_vechi, status_cerut, status_nou, campuri,
                                                 campuri_sub_prag, valori_vechi, valori_noi, aprobare_veche, nota, autor, rol)
  VALUES (OLD.id, OLD.licitatie_id, v_motiv, OLD.status, v_status_cerut, NEW.status, v_rel_c, v_sub_c, v_old, v_nou, v_aprob,
          CASE WHEN v_motiv = 'invalidat' AND v_status_cerut = 'validat' THEN v_nota END, auth.uid(), v_rol);
  RETURN NEW;
END;
$fn$;
-- drepturile nu se schimbă la CREATE OR REPLACE; REVOKE-ul (idempotent) doar confirmă starea din producție
REVOKE EXECUTE ON FUNCTION public.fn_trg_ofertare_cantitati_aprobare() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.fn_trg_ofertare_cantitati_aprobare() IS 'R5 (Copilot 26.09.2026, condiția 1; runda 5–6; 1b — prag exact): rând VALIDAT + schimbare relevantă FAȚĂ DE VALOAREA APROBATĂ (cifre: comparație EXACTĂ a valorii canonice round(x, 6), orice unitate, fără prag; um normalizat; denumire/Dn/material/SDR, specificații, obiect/tronson, categorie, sursă, cod articol) => status diferenta + nota „aprobarea veche nu mai e valabilă” cu severitatea diferenței (mică: < 1 % și, pe lungimi, < 1 m — doar text); valoarea și aprobarea veche în ofertare_cantitati_istoric; fiecare validare înregistrată (referința); rând nevalidat cu unitatea schimbată din / în m => istoric unitate_schimbata. Pereche cu aplicaRegulaAprobare (src/ofertareCantitatiInvalidare.js).';
