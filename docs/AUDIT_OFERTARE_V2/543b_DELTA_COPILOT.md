# PR #543 — delta 543b pentru Copilot (01.10.2026): follow-up NO-GO activare worker/edge

context_version: 2026-10-01 · bază: head 1675678 (delta 543) · generated_at: 2026-10-01
Stare live: `20260930e_monitor_egress.sql` APLICATĂ (versiunea 20261001175000, sha256 `3a41d9f8…82fcc3`) — fișierul nu se mai modifică.

## Ce s-a cerut (NO-GO Copilot)
1. `egress_detector()`: notificarea eșuată nu are voie să anuleze blocarea + alerta (fail-open).
2. Cheia obiectului canonicalizată identic în logger (`left(p_obiect,1024)`) și în poartă (`b.obiect = p_obiect`) — o cheie > 1024 ocolea blocarea.

## Ce s-a livrat în PR (NEAPLICAT pe live)
- `supabase/migrations/20261002a_monitor_egress_fix.sql` — sha256 `9d68fbac5c9bcbcf59b6eb8fa90229cc90c5f15daca3d88cdb90b97c737c6131`
  - gardă de livrare start/final (`20261002a_monitor_egress_fix:<txid>`), fără BEGIN/COMMIT, validator runner: OK (19 instrucțiuni);
  - precondiții fail-closed pe md5(prosrc) LIVE (citite read-only pe dxczwkbciseqniprspcu, 01.10): detector `2db8766e…`, log `b376e5f0…`, poartă `db91e3dc…`, deblocare `8e59b353…` (sau varianta patch, la reaplicare) + cele 4 neschimbate (notifica_owner `e4165baf…`, este_owner `25c9b494…`, ciclu_start `2cc40273…`, statistici `dd67c392…`); helper absent sau exact cel din patch; 8/9 funcții egress_*; 4 tabele cu RLS;
  - **helper unic** `public.egress_cheie_obiect(text)`: SQL, IMMUTABLE, STRICT, SECURITY INVOKER, search_path fixat; EXECUTE doar service_role. Cheie ≤ 1024 → neschimbată; altfel `left(cheie,991) || '#' || md5(cheie)` (exact 1024, fără coliziuni pe prefix comun);
  - folosit de `egress_log_descarcare` (scriere), `egress_obiect_blocat` (poartă) și `egress_deblocheaza` (deblocare owner — altfel o cheie lungă nu s-ar mai fi putut debloca cu cheia întreagă);
  - `egress_detector()`: cele 3 apeluri `egress_notifica_owner` (obiect repetat, prag zilnic, cotă ciclu) în `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING … END`; blocarea și alerta rămân comise; rezultatul include `notificari_esuate`;
  - postcondiții: md5 exacte (helper `80cb4557…`, poartă `73cd68ed…`, log `ef4c8c01…`, deblocare `de5e29c4…`, detector `2cc00f0d…`), atribute (DEFINER + search_path pe cele 4, INVOKER+IMMUTABLE pe helper), ACL (nimic pt anon; helper/poartă/log/detector/notifica neexecutabile de authenticated), contractul helperului, 2 joburi cron active.
- `supabase/revenire/20261002a_monitor_egress_fix_ROLLBACK.sql` — sha256 `98f20fa1bcc7c65f6530ab8a72adf8af0c6f5f1634f3bae88dc690a11b6d7e30`; armare txid (`REDESCHIDE_EGRESS_FIX`), refuz la armare persistentă, pre = patch exact, post = amprentele live 20260930e, dezarmare.
- Harness: `scripts/test_monitor_egress_fix.sh` + `supabase/tests/monitor_egress_schelet.sql` + `supabase/tests/monitor_egress_fix.test.sql`.

## Rezultate (PG17 local, harness)
- Baza = 20260930e, amprentele identice cu live (8/8).
- Suita pe 20260930e (dovada găurilor): A ok; **B: notificarea eșuată anulează tot detectorul, obiectul NU e blocat**; **D: cheia de 1515 caractere e blocată trunchiat, dar poarta (cheia întreagă) = false**.
- Fără marcaj → refuz garda start; detector alterat → refuz Precondiție 0b.
- După 20261002a: A 21× log → detector → blocat=true → gate=true; B notificare forțată să eșueze (trigger care aruncă) → detectorul nu cade, `notificari_esuate ≥ 1`, blocarea + alerta există, gate=true; C deblocare owner → gate=false, non-owner 42501; D cheie 1515 → blocată, gate(cheia întreagă)=true, cheia-soră cu același prefix → false, deblocare cu cheia întreagă → false.
- Reaplicare idempotentă; rollback nearmat → refuz, armat → amprentele 20260930e; reaplicare după rollback → suita trece.
- Gate 0e (`scripts/control_0e.sql`) = 0 rânduri pe bază, după patch și după rollback.
- vitest 1082/1082 ✅ · `npx vite build` ✅.

## Corecții de metadata
- `543_DELTA_COPILOT.md`: commit-ul head corect era `1675678` (codul + migrarea = `8e1084e`). Corectat în doc.
- Comentariul din `20260930e` „Fără edge/worker cablat, poarta și jurnalul stau inerte” e depășit: workerul NAS (`worker/ofertare/egress.ts`, `citire_mare.ts`, `ingest.ts`) e cablat; edge-ul e amânat. Fișierul aplicat NU se modifică (sha-ul lui e în schema_migrations) — nota stă în 543, aici și în antetul 20261002a.

## Riscuri rămase
- Chei lungi istorice (scrise în forma `left(…,1024)` înainte de patch) nu se migrează; jurnalul live e gol (workerul nu e încă activ), deci nu există.
- `RAISE WARNING` ajunge doar în logul Postgres/cron; o notificare care eșuează sistematic se vede în `notificari_esuate` din `cron.job_run_details`, nu în UI.
- Workerul trimite cheia întreagă; canonicalizarea e exclusiv server-side (nu e nevoie de schimbare în worker).

## Cerere
GO/NO-GO pe `20261002a_monitor_egress_fix.sql` (sha256 `9d68fbac…6131`) și, după aplicare, pe activarea workerului NAS. Aplicarea: doar `scripts/livrare_migrare.sh`, cu acordul lui Răzvan.
