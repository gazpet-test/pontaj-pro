# PR #1003 — runda 3

Același branch `codex/redari-pr2-stare-ui`, commit nou peste runda 2, fără merge/rebase/force. Numai fișiere: fără acces Supabase, aplicare de migrări, drepturi schimbate sau date reale.

**M** = `supabase/migrations/20261131d_redari_stare_utilizatori.sql`; **R** = `supabase/revenire/20261131d_redari_stare_utilizatori_ROLLBACK.sql`; **D** = `supabase/tests/20261131d_redari_stare_utilizatori_dryrun.sql`.

- **P2 L15 — triggere:** M/R:315 fixează inventarul complet: cinci triggere non-interne pe `profiles`, zero pe `user_module_access`. Include `prevent_role_escalation_trigger`, `trg_enforce_owner_only_salary_flags`, `trg_profiles_campuri_owner_only`, `trg_profiles_protectie_legatura`, `trg_protect_can_access_pontaj_brut`. M/R:400 refuză lipsă/extra, legare la altă funcție, dezactivare, alt eveniment/timing, `WHEN`, `UPDATE OF`, argumente, constraint/deferabilitate sau tabele de tranziție.
- **Funcții tranzitive:** M/R:325,417 — opt corpuri fixe, cu limbaj, owner, SECURITY DEFINER, volatilitate, search_path, ACL, tip rezultat și contract de argumente (inclusiv OUT `rol/sub` la `fn_identitate_claims`). Lanțul este închis: cele cinci funcții-trigger → `fn_identitate_privilegiata` / `fn_identitate_eticheta` → `fn_identitate_claims`; `auth.uid()` era deja amprentată. Surse: modelul 20261003d:96, SEC F2 20260930j, S-A extins 20260930a, protecția legăturii/identității din 20260929c; corpurile S-A și prevent_role sunt identice și cu captura E3 versionată. Nu se învață amprente din catalogul curent și nu se folosesc regex în verificator. M/R:430 păstrează și ancora rolurilor client fără SUPERUSER/BYPASSRLS, după modelul 20261003d.
- **DRY:** D:130 adaugă **14 mutanți**: dezactivare și corp modificat pentru fiecare dintre cele cinci triggere, corp modificat pentru cei trei callees și trigger suplimentar pe UMA. Fiecare cere mesajul exact, se anulează în subtranzacție, apoi D:164 verifică explicit baseline-ul după fiecare restaurare; se verifică și după eliminarea triggerului UMA fictiv.
- **Cale legitimă + integritate:** D:251 — editorul fictiv non-owner își poate modifica numele prin `profiles_update_own`; tentativa de autoatribuire `is_owner=true` trebuie refuzată exact cu `Doar owners pot schimba flag-ul is_owner`. Flagul rămâne false și nivelul rămâne editor. Claims și `SET LOCAL ROLE authenticated` sunt cele existente în harness; toate datele sunt fictive și tranzacția este anulată.
- Manifestele noi sunt temporare (`ON COMMIT DROP`); cleanup în R:743 și la rearmare M/R:23. Nicio funcție-trigger sau politică a aplicației nu este modificată. Vederile/JS din rundele anterioare rămân neschimbate.

Validări executate: **`npx vitest run`: 3.963 trecute, 22 sărite; 164 fișiere trecute / 3 sărite. `npx vite build`: reușit**, avertismente existente de bundle/importuri mixte. Parsare SQL și PL/pgSQL reușită în M/R/D; corpurile verificatorului din M/R sunt identice; amprentele celor opt funcții au fost recalculate din sursele versionate; `git diff --check` curat.

**Neexecutat:** DRY PostgreSQL (inclusiv cei 14 mutanți și UPDATE-urile de profil), verificarea catalogului/ACL/RLS/PostgREST, apply/rollback/re-apply și concurența. Condițiile operaționale rămân pentru clonă izolată cu schema și rolurile reale; nu se declară parsarea ca test SQL runtime. Orice diferență față de baseline necesită review, fără relaxare automată.

| Regulă | Dovadă în runda 3 |
|---|---|
| L01 | M/R:19 — lock-urile pe sursele de autorizare rămân înaintea verificărilor. |
| L02 | D:4 — mutanți, fixture și verificări în aceeași tranzacție anulată; subtranzacții pentru fiecare mutant. |
| L03 | n/a |
| L04 | n/a |
| L05 | n/a |
| L06 | Ordinea DDL și timeout-ul rămân identice în M/R; fără lock nou. Concurența neexecutată. |
| L07 | M/R:400 — sunt verificate barierele reale de integritate ale `is_owner`, nu doar politica own-update. |
| L08 | D:251 — identitate din `auth.uid`, non-owner verificat; implementările de identitate existente sunt doar amprentate. |
| L09 | n/a — fără cale sau drept de acces nou. |
| L10 | n/a |
| L11 | n/a |
| L12 | n/a |
| L13 | n/a — fără regex nou în producție; parser PostgreSQL pentru validarea fișierelor. |
| L14 | M/R:23, R:743 — manifestele temporare incluse în cleanup; tranzacția și ciclul DRY păstrate, neexecutate. |
| L15 | M/R:315,400,417 — cinci triggere, opt funcții și callees, metadate/ACL/argumente; D:130 — 14 mutanți cu refuz exact și restaurare. Runtime neexecutat. |
| L16 | n/a |
| L17 | n/a |
| L18 | Lipsă/extra/NULL sau metadate diferite produc refuz; `IS NOT DISTINCT FROM` pentru contractul OUT. |
| L19 | Corpul verificatorului M/R comparat identic local; aceleași baseline-uri fixe, fără copierea catalogului live. |
| L20 | D:164 — baseline legitim după fiecare restaurare; D:251 — nume editabil, autoescaladare refuzată. SQL pregătit, neexecutat. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a |
| L24 | n/a |
| L25 | D:130,251 — obiecte/identități reale ale harness-ului, mesaje exacte, non-owner authenticated; Vitest/build/parser rulate, SQL neexecutat. |
