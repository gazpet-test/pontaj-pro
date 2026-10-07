-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261019a — Mesaj vocal (text → voce, Google Cloud Text-to-Speech, vocea ro-RO-Chirp3-HD-Aoede), Răzvan 07.10.2026
--
-- Decizii Răzvan (07.10): Google Cloud TTS (nu Azure), vocea Aoede; la plafonul lunar dreptul de folosire se suspendă
--   până la resetare. Free tier Google Chirp 3 HD = 1.000.000 caractere/lună ⇒ plafonul NOSTRU = 950.000 (marjă pentru
--   diferențele de numărare), luna socotită ca la Google (America/Los_Angeles). Peste plafon, edge-ul refuză (429).
-- Ce creează:
--   A. tts_cota_lunara — contorul lunar (un rând pe lună); scris DOAR prin fn_tts_rezerva (+ rândul inițial din E).
--   B. tts_cache — MP3-urile deja generate (cheie = sha256(voce + text)): același text nu se plătește de două ori.
--   C. fn_tts_rezerva(p_caractere) — rezervare ATOMICĂ sub plafon, chemată de edge ÎNAINTEA FIECĂREI bucăți trimise la
--      Google (r2, J13-3); NULL = plafon atins. FĂRĂ restituire (r2, J13-1/J13-2/P12-1): ce a pornit spre Google rămâne
--      numărat, chiar dacă apelul eșuează. În ultimele 10 minute ale lunii (ora Google) rezervarea se numără în AMBELE
--      luni, ca o bucată trimisă la graniță să nu scape din luna nouă. SECURITY DEFINER, EXECUTE doar service_role.
--      fn_tts_poate() — poarta (r2, J13-4): owner SAU cheia de modul 'mesaj_vocal', pe auth.uid(); doar citire, chemată de
--      edge cu JWT-ul utilizatorului, ÎNAINTE de crearea clientului service_role. Executabilă de authenticated.
--   D. bucket privat tts-audio (audio/mpeg, 10 MB) + politică RESTRICTIVE pe storage.objects care îl închide pentru
--      orice rol supus RLS (r2, P12-2): nicio politică permisivă, existentă sau viitoare, nu-l poate deschide. Doar
--      service_role (BYPASSRLS) scrie/citește; utilizatorii primesc URL semnat de la edge.
--   F. app_modules: cheia 'mesaj_vocal' (r2) — doar o face ACORDABILĂ din administrare (FK din user_module_access);
--      nu dă drept nimănui. Acordarea rămâne la Răzvan (CLAUDE.md pct. 3).
--   E. Contorul lunii curente pornește de la 1.000 (r2, P12-4): acoperă cele 770 de caractere de test generate pe 07.10
--      direct cu cheia, în afara contorului. Cheia Google „Gazpet ERP TTS” e dedicată acestei funcții.
-- Drepturi: nimic nou în user_module_access. Poarta e în edge: owner SAU cheia de modul 'mesaj_vocal' (acordată doar de
--   Răzvan, CLAUDE.md pct. 3). Citirea contorului și a cache-ului din client: doar owner (RLS).
-- Fără date reale atinse. LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid),
--   fără BEGIN/COMMIT. Revenire: supabase/revenire/20261019a_tts_mesaj_vocal_ROLLBACK.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261019a_tts_mesaj_vocal:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261019a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF to_regclass('public.tts_cota_lunara') IS NOT NULL OR to_regclass('public.tts_cache') IS NOT NULL
     OR to_regprocedure('public.fn_tts_rezerva(integer)') IS NOT NULL OR to_regprocedure('public.fn_tts_poate()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'tts-audio')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'tts_audio_inchis')
     OR EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'mesaj_vocal')
     OR EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'mesaj_vocal') THEN
    RAISE EXCEPTION 'Precondiție 0b: obiectele mesajului vocal există deja — reaplicare';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'
        AND column_name IN ('id', 'is_owner')) <> 2
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access'
        AND column_name IN ('profile_id', 'module')) <> 2 THEN
    RAISE EXCEPTION 'Precondiție 0c: profiles(id, is_owner) / user_module_access(profile_id, module) lipsesc';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'app_modules'
        AND column_name IN ('key', 'name', 'icon', 'color', 'description', 'is_active', 'display_order', 'show_on_homepage')) <> 8 THEN
    RAISE EXCEPTION 'Precondiție 0e: app_modules nu are coloanele așteptate (key, name, icon, color, description, is_active, display_order, show_on_homepage)';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Precondiție 0d: anon/authenticated pot crea obiecte în public (funcțiile SECDEF ar fi expuse la umbrire)';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- A. Contorul lunar
-- ---------------------------------------------------------------------------
CREATE TABLE public.tts_cota_lunara (
  luna date PRIMARY KEY CHECK (luna = date_trunc('month', luna)::date),
  caractere bigint NOT NULL DEFAULT 0 CHECK (caractere >= 0 AND caractere <= 950000),
  actualizat_la timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tts_cota_lunara ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tts_cota_lunara FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tts_cota_lunara TO service_role;
GRANT SELECT ON public.tts_cota_lunara TO authenticated;
CREATE POLICY tts_cota_lunara_select_owner ON public.tts_cota_lunara FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true));

-- ---------------------------------------------------------------------------
-- B. Cache-ul de MP3
-- ---------------------------------------------------------------------------
CREATE TABLE public.tts_cache (
  cheie text PRIMARY KEY CHECK (cheie ~ '^[0-9a-f]{64}$'),
  voce text NOT NULL CHECK (voce ~ '^ro-RO-[A-Za-z0-9-]+$'),
  caractere integer NOT NULL CHECK (caractere > 0),
  cale text NOT NULL CHECK (cale = cheie || '.mp3'),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  folosiri integer NOT NULL DEFAULT 1 CHECK (folosiri >= 1),
  ultima_folosire timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tts_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tts_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tts_cache TO service_role;
GRANT SELECT ON public.tts_cache TO authenticated;
CREATE POLICY tts_cache_select_owner ON public.tts_cache FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true));

-- ---------------------------------------------------------------------------
-- C. Rezervare per bucată (plafonul e o constantă AICI, nu un parametru: edge-ul nu-l poate ridica) + poarta
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_tts_rezerva(p_caractere integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_acum timestamp := now() AT TIME ZONE 'America/Los_Angeles';               -- ora de facturare Google
  v_luna date := date_trunc('month', v_acum)::date;
  v_urm date := date_trunc('month', v_acum + interval '10 minutes')::date;    -- ≠ v_luna doar în ultimele 10 minute
  v_rest bigint;
BEGIN
  IF p_caractere IS NULL OR p_caractere < 1 OR p_caractere > 20000 THEN
    RAISE EXCEPTION 'fn_tts_rezerva: p_caractere în afara intervalului 1..20000 (%)', p_caractere;
  END IF;
  INSERT INTO public.tts_cota_lunara (luna) VALUES (v_luna) ON CONFLICT (luna) DO NOTHING;
  IF v_urm <> v_luna THEN INSERT INTO public.tts_cota_lunara (luna) VALUES (v_urm) ON CONFLICT (luna) DO NOTHING; END IF;
  BEGIN
    UPDATE public.tts_cota_lunara
       SET caractere = caractere + p_caractere, actualizat_la = now()
     WHERE luna = v_luna AND caractere + p_caractere <= 950000
    RETURNING 950000 - caractere INTO v_rest;
    IF v_rest IS NULL THEN RETURN NULL; END IF;
    IF v_urm <> v_luna THEN
      -- graniță: aceeași bucată se numără și în luna care începe (o bucată trimisă după miezul nopții nu scapă)
      UPDATE public.tts_cota_lunara
         SET caractere = caractere + p_caractere, actualizat_la = now()
       WHERE luna = v_urm AND caractere + p_caractere <= 950000;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'tts_plafon_luna_urmatoare'; END IF;
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'tts_plafon_luna_urmatoare' THEN RETURN NULL; END IF;   -- prima rezervare se anulează (subtranzacție)
    RAISE;
  END;
  RETURN v_rest;   -- NULL ⇒ plafon atins, nimic rezervat
END
$fn$;

CREATE FUNCTION public.fn_tts_poate()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true)
    OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'mesaj_vocal'))
$fn$;

REVOKE ALL ON FUNCTION public.fn_tts_rezerva(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tts_rezerva(integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tts_poate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tts_poate() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D. Bucket privat pentru MP3 + închiderea lui pentru orice rol supus RLS (RESTRICTIVE se combină cu AND)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tts-audio', 'tts-audio', false, 10485760, ARRAY['audio/mpeg']);
CREATE POLICY tts_audio_inchis ON storage.objects AS RESTRICTIVE FOR ALL TO public
  USING (bucket_id IS DISTINCT FROM 'tts-audio') WITH CHECK (bucket_id IS DISTINCT FROM 'tts-audio');

-- ---------------------------------------------------------------------------
-- E. Consumul de test de dinainte (770 caractere, 07.10) — rotunjit în sus la 1.000
-- ---------------------------------------------------------------------------
INSERT INTO public.tts_cota_lunara (luna, caractere)
VALUES (date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date, 1000);

-- ---------------------------------------------------------------------------
-- F. Cheia de modul (acordabilă; nimeni n-o primește aici)
-- ---------------------------------------------------------------------------
INSERT INTO public.app_modules (key, name, icon, color, description, is_active, display_order, show_on_homepage)
VALUES ('mesaj_vocal', 'Mesaj vocal', '🎙', '#A371F7', 'Text → voce (Aoede) · trimis pe WhatsApp', true, 32, true);

DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tts_cota_lunara'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tts_cache'::regclass) THEN
    RAISE EXCEPTION 'Postcondiție: RLS dezactivat pe tabelele noi';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_tts_rezerva(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_tts_rezerva(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_tts_poate()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_tts_poate()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție: drepturi EXECUTE greșite pe fn_tts_rezerva / fn_tts_poate';
  END IF;
  IF has_table_privilege('authenticated', 'public.tts_cota_lunara', 'INSERT') OR has_table_privilege('authenticated', 'public.tts_cota_lunara', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.tts_cache', 'INSERT') OR has_table_privilege('authenticated', 'public.tts_cache', 'UPDATE') THEN
    RAISE EXCEPTION 'Postcondiție: authenticated poate scrie în tabelele mesajului vocal';
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'tts-audio') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Postcondiție: bucket-ul tts-audio nu e privat';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'tts_audio_inchis' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL' AND roles = '{public}') <> 1 THEN
    RAISE EXCEPTION 'Postcondiție: politica RESTRICTIVE tts_audio_inchis lipsește sau nu e cea așteptată';
  END IF;
  IF (SELECT count(*) FROM public.app_modules WHERE key = 'mesaj_vocal') <> 1
     OR EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'mesaj_vocal') THEN
    RAISE EXCEPTION 'Postcondiție: cheia mesaj_vocal lipsește din app_modules sau a fost deja acordată cuiva';
  END IF;
  IF (SELECT caractere FROM public.tts_cota_lunara WHERE luna = date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date) IS DISTINCT FROM 1000 THEN
    RAISE EXCEPTION 'Postcondiție: contorul lunii curente nu pornește de la 1.000';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261019a_tts_mesaj_vocal:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261019a: garda de livrare (final)';
  END IF;
END
$livrare_final$;
