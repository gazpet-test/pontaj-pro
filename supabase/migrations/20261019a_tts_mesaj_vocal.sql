-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261019a — Mesaj vocal (text → voce, Google Cloud Text-to-Speech, vocea ro-RO-Chirp3-HD-Aoede), Răzvan 07.10.2026
--
-- Decizii Răzvan (07.10): Google Cloud TTS (nu Azure), vocea Aoede; la plafonul lunar dreptul de folosire se suspendă
--   până la resetare. Free tier Google Chirp 3 HD = 1.000.000 caractere/lună ⇒ plafonul NOSTRU = 950.000 (marjă pentru
--   diferențele de numărare), luna socotită ca la Google (America/Los_Angeles). Peste plafon, edge-ul refuză (429).
-- Ce creează:
--   A. tts_cota_lunara — contorul lunar (un rând pe lună); scris DOAR prin fn_tts_rezerva / fn_tts_restituie.
--   B. tts_cache — MP3-urile deja generate (cheie = sha256(voce + text)): același text nu se plătește de două ori.
--   C. fn_tts_rezerva(p_caractere) — rezervare ATOMICĂ sub plafon (UPDATE condiționat); NULL = plafon atins.
--      fn_tts_restituie(p_caractere) — dă înapoi rezervarea când Google eșuează după rezervare.
--      Ambele SECURITY DEFINER, EXECUTE doar service_role (edge-ul tts-google) ⇒ nu sunt expuse PostgREST (gate 0e neatins).
--   D. bucket privat tts-audio (audio/mpeg, 10 MB), FĂRĂ politici pe storage.objects: doar service_role scrie/citește;
--      utilizatorii primesc URL semnat de la edge.
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
     OR to_regprocedure('public.fn_tts_rezerva(integer)') IS NOT NULL OR to_regprocedure('public.fn_tts_restituie(integer)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'tts-audio') THEN
    RAISE EXCEPTION 'Precondiție 0b: obiectele mesajului vocal există deja — reaplicare';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'
        AND column_name IN ('id', 'is_owner')) <> 2 THEN
    RAISE EXCEPTION 'Precondiție 0c: profiles(id, is_owner) lipsește';
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
-- C. Rezervare / restituire (plafonul e o constantă AICI, nu un parametru: edge-ul nu-l poate ridica)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_tts_rezerva(p_caractere integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_luna date := date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date;   -- luna de facturare Google
  v_rest bigint;
BEGIN
  IF p_caractere IS NULL OR p_caractere < 1 OR p_caractere > 20000 THEN
    RAISE EXCEPTION 'fn_tts_rezerva: p_caractere în afara intervalului 1..20000 (%)', p_caractere;
  END IF;
  INSERT INTO public.tts_cota_lunara (luna) VALUES (v_luna) ON CONFLICT (luna) DO NOTHING;
  UPDATE public.tts_cota_lunara
     SET caractere = caractere + p_caractere, actualizat_la = now()
   WHERE luna = v_luna AND caractere + p_caractere <= 950000
  RETURNING 950000 - caractere INTO v_rest;
  RETURN v_rest;   -- NULL ⇒ plafon atins, nimic rezervat
END
$fn$;

CREATE FUNCTION public.fn_tts_restituie(p_caractere integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_luna date := date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date;
BEGIN
  IF p_caractere IS NULL OR p_caractere < 1 OR p_caractere > 20000 THEN
    RAISE EXCEPTION 'fn_tts_restituie: p_caractere în afara intervalului 1..20000 (%)', p_caractere;
  END IF;
  UPDATE public.tts_cota_lunara
     SET caractere = greatest(0, caractere - p_caractere), actualizat_la = now()
   WHERE luna = v_luna;
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_tts_rezerva(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tts_restituie(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tts_rezerva(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tts_restituie(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- D. Bucket privat pentru MP3 (fără politici pe storage.objects ⇒ doar service_role)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tts-audio', 'tts-audio', false, 10485760, ARRAY['audio/mpeg']);

DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tts_cota_lunara'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tts_cache'::regclass) THEN
    RAISE EXCEPTION 'Postcondiție: RLS dezactivat pe tabelele noi';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_tts_rezerva(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_tts_rezerva(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_tts_restituie(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_tts_restituie(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție: funcțiile de cotă sunt executabile de anon/authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.tts_cota_lunara', 'INSERT') OR has_table_privilege('authenticated', 'public.tts_cota_lunara', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.tts_cache', 'INSERT') OR has_table_privilege('authenticated', 'public.tts_cache', 'UPDATE') THEN
    RAISE EXCEPTION 'Postcondiție: authenticated poate scrie în tabelele mesajului vocal';
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'tts-audio') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Postcondiție: bucket-ul tts-audio nu e privat';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
               AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%tts-audio%') THEN
    RAISE EXCEPTION 'Postcondiție: există politici storage pe tts-audio (așteptat: niciuna)';
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
