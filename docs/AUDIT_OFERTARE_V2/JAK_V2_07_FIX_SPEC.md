# JAK — Fix JAK-V2-07: poartă RLS pe scriere + DELETE licitație owner-only

Ramura: `claude/fix-jakv207-rls-scriere` din `origin/main`. Fără git (Claude preia diff-ul), fără producție, fără apply (migrarea rămâne fișier; Claude o testează pe Postgres local și o duce în PR). Raport la final: `docs/AUDIT_OFERTARE_V2/JAK_V2_07_raport.md`.

## Problema (confirmată static + adversarial pe schema live)
Pe ~40 de tabele `ofertare_*`/`grafic_*` politicile de scriere sunt `USING/WITH CHECK (auth.uid() IS NOT NULL)` — deci **orice utilizator autentificat, chiar fără modulul Ofertare**, poate `INSERT/UPDATE/DELETE` prin PostgREST. Cel mai grav: `ofertare_licitatii` are o singură politică `ofertare_licitatii_all FOR ALL USING (auth.uid() IS NOT NULL)` →
- `DELETE` pe o licitație cascadează (FK `ON DELETE CASCADE`) și șterge cerințe, acoperiri, pachetul **aprobat/depus** și manifestul — dovada „ce bytes s-au depus" dispare fără urmă (obiectele din Storage rămân orfane);
- oricine își poate seta `responsabil_id`/`status`/`decizie_go`/`termen_depunere`/`c_notice_id` (escaladare la drepturile de responsabil, pornire de citiri plătite).

`fn_are_acces_ofertare()` (LIVE, `SECURITY DEFINER`) = `auth.uid() IS NOT NULL AND (is_owner OR user_module_access.module='ofertare')`. E poarta corectă de rol pe care o folosesc deja tabelele „strong" (ofertare_cerinte, ofertare_acoperire, ofertare_pt_pachet etc.).

## Ce scrii: `supabase/migrations/20260928p_ofertare_rls_scriere_r_v2_07.sql` + `_ROLLBACK.sql`

### A. `ofertare_licitatii` — cazul special (nu doar înlocuire de poartă)
Înlocuiește politica unică `ofertare_licitatii_all` cu 4 politici + 1 trigger:
1. `ofertare_licitatii_select` FOR SELECT TO authenticated USING `(auth.uid() IS NOT NULL)` — **nu restrânge citirea** (dashboards, GraficLucrare, GBE citesc licitații din alte module).
2. `ofertare_licitatii_insert` FOR INSERT TO authenticated WITH CHECK `((SELECT fn_are_acces_ofertare()))`.
3. `ofertare_licitatii_update` FOR UPDATE TO authenticated USING/WITH CHECK `((SELECT fn_are_acces_ofertare()) OR EXISTS (SELECT 1 FROM user_module_access u WHERE u.profile_id=auth.uid() AND u.module='financiar'))` — modulul **financiar** trebuie să poată lega contractul (GbeEvidenta.jsx:213 scrie `contract_id`).
4. `ofertare_licitatii_delete` FOR DELETE TO authenticated USING `(EXISTS (SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.is_owner))` — **doar owner** poate șterge o licitație (cascada distruge manifestul).
5. Trigger `BEFORE UPDATE` `fn_ofertare_licitatii_scriere` (`SECURITY DEFINER SET search_path=public,pg_temp`, `REVOKE EXECUTE FROM PUBLIC`): dacă apelantul **nu** e owner/ofertare/`postgres` (adică ajunge aici doar prin poarta „financiar"), atunci **singurele** coloane care au voie să difere între OLD și NEW sunt `contract_id` și `updated_at`; orice altă schimbare → `RAISE EXCEPTION 'Modulul financiar poate modifica doar contract_id pe o licitație' USING ERRCODE='P0001'`. Verifică rolul cu:
   `v_ofertare boolean := (SELECT public.fn_are_acces_ofertare()); v_admin boolean := (session_user='postgres');`
   și lasă trecerea liberă când `v_ofertare OR v_admin`. Compară coloanele prin `to_jsonb(OLD) - 'contract_id' - 'updated_at'` vs `to_jsonb(NEW) - 'contract_id' - 'updated_at'` (dacă diferă → refuz).
   Trigger `BEFORE UPDATE` (toate coloanele), nume care sortează stabil.

### B. Poartă RLS pe scriere — tabele tender-scoped, clar din modulul Ofertare
Pentru fiecare tabel din lista de mai jos: `DROP POLICY` politicile de scriere existente (cele cu `auth.uid() IS NOT NULL`) și recreează-le identic ca formă, dar cu poarta `((SELECT public.fn_are_acces_ofertare()))` în USING (pentru UPDATE/DELETE/ALL) și în WITH CHECK (pentru INSERT/UPDATE/ALL). Păstrează exact `cmd`, `roles` (dacă e `{public}`, schimbă TO `authenticated` — anon oricum n-are ce căuta), numele politicii. **Nu atinge** politicile SELECT (rămân `auth.uid() IS NOT NULL`). Lista LIVE ți-o dau în Anexa 1 (numele exacte ale politicilor + cmd), ca să fie determinist.

Tabele (toate cascadează din licitație sau sunt strict date de ofertă, scriitori doar în `src/Ofertare*.jsx`/`src/Grafic*.jsx`):
`ofertare_cantitati, ofertare_clarificari, ofertare_clarificari_coada, ofertare_acoperire_coada, ofertare_acoperire_istoric, ofertare_acoperire_revizii, ofertare_extragere_coada, ofertare_ingest_coada, ofertare_inventar_ai, ofertare_triere, ofertare_verificari, ofertare_garantii, ofertare_mailuri, ofertare_nas_inventar, ofertare_participari, ofertare_pt_anexe_asteptate, ofertare_pt_declaratii, ofertare_pt_echipa, ofertare_pt_echipa_roluri, ofertare_pt_garantie, ofertare_pt_participanti, ofertare_solicitari_ac, ofertare_solicitari_ac_anexe, ofertare_solicitari_ac_puncte, grafic_activitati, grafic_parametri, grafic_versiuni`.

### C. NU atinge în acest PR (ambiguu cross-modul — necesită confirmare per tabel de la Răzvan)
`ofertare_rfq*, ofertare_oferte_furnizori, ofertare_oferte_deschidere, ofertare_calibrari, ofertare_calibrari_subcontractori, ofertare_brokeri, ofertare_preturi_materiale, ofertare_preturi_unitare, ofertare_normative, ofertare_norme_productivitate, ofertare_categorii_reguli, ofertare_experienta, ofertare_parteneri, ofertare_parteneri_documente`. Notează-le în raport ca „rămân de gated după confirmare de modul (RFQ↔achiziții, calibrări↔CTC, catalog partajat)".

## Cerințe tehnice
- Migrarea într-o singură tranzacție implicită; fiecare `DROP POLICY IF EXISTS` + `CREATE POLICY`. Idempotentă la re-rulare (folosește `IF EXISTS`).
- `_ROLLBACK.sql`: readuce exact politicile vechi (ALL/weak) și dă `DROP TRIGGER/FUNCTION` pe cele noi de la A.
- Fără `GRANT`/`REVOKE` pe tabele (granturile rămân; RLS face poarta). Excepție: `REVOKE EXECUTE ... FROM PUBLIC` pe funcția triggerului A.
- Test: scrie și `scripts/pg/test_jakv207_rls.mjs` (PostgreSQL 16 real, tiparul din `scripts/pg/test_jakv201_tranzitie.mjs` — SET ROLE authenticated + `request.jwt.claims`): (1) user **fără** modul → `DELETE ofertare_licitatii` = 0 rânduri / refuz; `UPDATE status` = 0 rânduri; (2) user cu modul **ofertare** → poate UPDATE; (3) user cu modul **financiar** → poate seta `contract_id`, dar `UPDATE status='depusa'` e refuzat de trigger; (4) owner → DELETE reușește; (5) un tabel tender-scoped (ex. ofertare_cantitati): user fără modul refuzat, cu modul permis. Rulează `node --check` pe .mjs.
- NU rula migrarea pe producție. NU rula vitest dacă `spawn EPERM` (spune-o în raport).

## Anexa 1 — politicile LIVE de înlocuit (nume exact · cmd · roles)
(ofertare_licitatii_all · ALL · authenticated) → înlocuit de A.
Pentru B, politicile weak curente, pe tabel:
- ofertare_cantitati: cant_all (ALL, authenticated)
- ofertare_clarificari: clar_all (ALL, authenticated)
- ofertare_clarificari_coada: ofertare_clarificari_coada_all (ALL, authenticated)
- ofertare_acoperire_coada: ofertare_acoperire_coada_all (ALL, authenticated)
- ofertare_acoperire_istoric: istoric_scrie (ALL, authenticated)
- ofertare_acoperire_revizii: revizii_scrie (ALL, authenticated)
- ofertare_extragere_coada: ofertare_extragere_coada_all (ALL, authenticated)
- ofertare_ingest_coada: ofertare_ingest_coada_all (ALL, authenticated)
- ofertare_inventar_ai: ofertare_inventar_ai_upd (UPDATE, authenticated)
- ofertare_triere: triere_mod (ALL, authenticated)
- ofertare_verificari: ofertare_verificari_auth (ALL, authenticated)
- ofertare_garantii: garantii_all (ALL, public → authenticated)
- ofertare_mailuri: mailuri_ins (INSERT, public → authenticated)
- ofertare_nas_inventar: nas_inv_ins/nas_inv_upd/nas_inv_del (INSERT/UPDATE/DELETE, authenticated)
- ofertare_participari: ofertare_participari_auth (ALL, authenticated)
- ofertare_pt_anexe_asteptate: pt_anexe_asteptate_rw (ALL, authenticated)
- ofertare_pt_declaratii: pt_declaratii_rw (ALL, authenticated)
- ofertare_pt_echipa: echipa_rw (ALL, authenticated)
- ofertare_pt_echipa_roluri: roluri_rw (ALL, authenticated)
- ofertare_pt_garantie: pt_garantie_auth (ALL, authenticated)
- ofertare_pt_participanti: pt_participanti_auth (ALL, authenticated)
- ofertare_solicitari_ac: solicitari_ac_rw (ALL, public → authenticated)
- ofertare_solicitari_ac_anexe: solicitari_ac_anexe_rw (ALL, public → authenticated)
- ofertare_solicitari_ac_puncte: solicitari_ac_puncte_rw (ALL, public → authenticated)
- grafic_activitati: grafic_act_ins/upd/del (INSERT/UPDATE/DELETE, authenticated)
- grafic_parametri: grafic_param_ins/upd/del (INSERT/UPDATE/DELETE, public → authenticated)
- grafic_versiuni: grafic_ver_ins (INSERT, public → authenticated)

Regula de recreare pentru B (exemplu ALL): `DROP POLICY IF EXISTS cant_all ON public.ofertare_cantitati; CREATE POLICY cant_all ON public.ofertare_cantitati FOR ALL TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));`
Pentru INSERT: doar WITH CHECK. Pentru UPDATE: USING + WITH CHECK. Pentru DELETE: doar USING.
