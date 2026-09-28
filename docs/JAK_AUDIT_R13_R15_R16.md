# JAK — Audit Ofertare: R13, R15, R16 (cod local + teste)

Ramura: `jak/audit-r13-r15-r16` (din `origin/main`). Fără git push, fără producție, fără migrări.
Livrezi: diff + raport scurt în `docs/JAK_AUDIT_R13_R15_R16_raport.md` (ce ai schimbat, ce teste, ce n-ai putut face).
Sursa: auditul Copilot 17.09 (secțiunea D). Claude face în paralel R06/R07/R09 (SQL) — NU atinge `v_ofertare_pt_stare`, `fn_gate_depunere`, `src/OfertarePropunere.jsx`.

## R13 — proveniența graficului verifică existența, nu corespondența
Fișier: `src/ofertareControale.js` → `controlGraficSursa` (≈ linia 719), apelat din `src/ofertarePoarta.js:187`.
Azi: găsește un fișier din pachet după nume/rol și dă `ok` dacă există ORICE versiune înghețată de grafic.
Cerința: `ok` numai dacă fișierul din pachet e legat de o versiune CONCRETĂ înghețată (id/versiune/hash salvat pe fișier sau pe versiune — folosește ce există deja în `st.pachet_fisiere` / `grafic_versiuni`; citește codul). Fișier cu sursă declarată diferită de versiunea înghețată curentă → `block` cu motiv. Fără legătură identificabilă → `warn` („nu putem verifica corespondența"), NU `ok`.
Teste în `src/ofertareControale.test.js`: (a) fișier legat de versiunea înghețată curentă → ok; (b) sursă declarată ≠ versiune → block; (c) doar existența unei versiuni, fără legătură → warn (acesta e cazul reprodus de audit ca `ok` fals).

## R15 — pasajul „verificat” pe primele 80 de caractere + plafonul de 150
Fișier: `supabase/functions/ofertare-cerinte/core.ts` → `verificaPasaj` (≈ linia 121) și locul unde lista extrasă e tăiată la 150.
1. Un pasaj e `verificat=true` doar dacă TOT pasajul (normalizat) se găsește în text. Potrivirea doar a începutului → `verificat=false` + câmp/marcaj `pasaj_partial=true` (sau echivalentul existent), păstrând pagina găsită. Nu scoate potrivirea parțială — doar nu o mai numi „verificată”.
2. Când extracția atinge plafonul de 150 sau răspunsul AI e trunchiat, rezultatul trebuie să poarte explicit `trunchiat: true` / restanță, nu `ok` simplu. Caută cum raportează funcția succesul și adaugă semnalul fără să schimbi forma pentru apelanții existenți (câmp nou, opțional).
Teste Deno lângă core (există `core_test.ts` în alte funcții ca model): început autentic + final inventat → neverificat; pasaj integral → verificat; listă de 150 → marcaj trunchiat.

## R16 — organigrama transformă „necunoscut” în „fals”
Fișier: `supabase/functions/ofertare-organigrama-spec/index.ts` (normalizarea cu `!!j.obligatorie`, `!!lc.*`) + UI-ul care afișează „organigrama nu e cerută explicit” când valoarea e false (caută textul în `src/`).
Cerința: câmp omis de AI → `null` (necunoscut), nu `false`. Doar `false` explicit din răspuns rămâne false. UI: `null` → „nu s-a putut stabili — verifică documentația”, nu „nu e cerută”. Extrage normalizarea într-o funcție pură exportată (ex. `normalizeazaSpecOrganigrama`) și testeaz-o (omis → null, false → false, true → true).

## Validare obligatorie înainte de raport
- `npx vitest run` (tot) verde; `deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-cerinte supabase/functions/ofertare-organigrama-spec` verde (dacă nu există teste, cele noi).
- `npx vite build` OK.
- `git diff --stat` în raport.
