# Registru sarcini delegate — Claude (coordonator) · Codex/Jakarinos · Miloi (Gemini) · Copilot (dirijor)

Scop: reluare fără dependență de istoricul unui chat. Fiecare sarcină delegată are o linie aici; se actualizează la fiecare checkpoint.
Reguli: (1) sarcină delimitată: obiectiv, context, fișiere permise, restricții, criterii de acceptare; (2) implementări paralele doar pe branch separat, fără fișiere comune; (3) Claude verifică înainte de integrare; (4) la timeout NU se relansează până nu se verifică `git status` + ieșirea parțială; (5) consum notat pe fiecare rulare.

## Executanți
| Executant | Cum se apelează | Mod | Note |
|---|---|---|---|
| Jakarinos (Codex, gpt-6-astra high) | `C:\Users\Public\run_jak.cmd <spec> <log>` pe PC birou; `codex exec --sandbox workspace-write` | scrie cod | NU rulează git (Claude comite ca „Jakarinos-Codex”); JAK_GATA la final de log |
| Miloi (Gemini — agy 1.2.12, gemini-3.1-pro-high) | `C:\Users\offic\AppData\Local\agy\bin\agy.exe --model gemini-3.1-pro-high --mode plan --print-timeout <N>s --add-dir <repo> -p <prompt> --output-format json` | `plan` = analiză; `accept-edits` = editare (de validat înainte de prima folosire) | JSON: status/response/conversation_id/usage; reluare cu `--conversation <id>`; NU `--dangerously-skip-permissions` |
| Copilot (ChatGPT) | `node C:\Users\Public\cgpt.mjs send <fișier> <sec>` / `read n` | dirijor | primește rapoarte, decizii împreună |

## Sarcini
| ID | Executant | Branch | Obiectiv | Stare | Checkpoint / rezultat | Consum |
|---|---|---|---|---|---|---|
| JAK-V2-01 | Claude | claude/fix-jakv201-pachet-tranzitie | matrice tranziții pachet | PR #515 draft, CI verde | test pg-real verde local | — |
| JAK-V2-07 | Jakarinos | claude/fix-jakv207-rls-scriere | RLS scriere ofertare_* + DELETE licitație owner-only | cod pushat 3596296, NETESTAT | bug trigger service_role de corectat (Claude); apoi test pg + PR | — |
| GEM-000 | Miloi | — | test conexiune (plan) | OK 28.09 | „Gemini este conectat la Maestru.” 6 s | 13.6k tok |
| GEM-001 | Miloi | (citire) claude/fix-jakv207-rls-scriere | analiză independentă trigger fn_ofertare_licitatii_scriere vs service_role | GATA 28.09, verificat de Claude | CONFIRMĂ bug-ul (l.37-47 migrare; testul acoperă doar postgres, l.247-249/285). Fix propus `current_user='service_role'`; Claude adoptă varianta mai robustă `auth.uid() IS NULL OR rolbypassrls/rolsuper pe current_user`. git status curat = fără modificări | 26.2k tok, 39 s, conv 91734c1a |

## Reguli de lucru (Răzvan + Copilot, 28.09 seara)
- Claude = coordonator + integrator (SQL/BD live, migrări cu risc, semantică Ofertare, state machine/provenance/gate-uri, apply BD + deploy, review final). Țintă orientativă: Claude ~25% / Jakarinos ~45% / Miloi ~30%, după dificultate.
- Jakarinos = cod greu (backend, edge, RLS/RPC/triggere, tranziții, concurență, provenance, cross-layer, teste adversariale, harness).
- Miloi = taskuri independente verificabile (UI, Vitest/Deno, fixtures, inventare statice, parity UI↔SQL, documentație, refactor local). Fără RLS/securitate/state machine/depunere până nu are rezultate bune.
- Un task = un owner, un branch, fișiere permise, invariantă, teste obligatorii, DONE, reviewer. Nimeni pe main. Nu amestecăm findings independente în același PR.
- Review: Miloi → Jakarinos/Claude; Jakarinos → Claude; Claude SQL/RLS/stare/depunere → a doua opinie Jakarinos. SECURITY/RLS/PACKAGE/SUBMISSION/FALSE_GREEN/provenance critic → diff la Copilot pt GO/NO-GO. Autorul nu își închide singur fixul critic.
- Audit ≠ fix: finding documentat întâi. Excepție critică: finding → reproducere → GO Răzvan → fix → test negativ → review.
- Coadă permanentă 3–5 taskuri/executant; decizie neprevăzută → `BLOCKED_DECISION`, trece la următorul.
- Raport Copilot în batch: finding → owner → fix → teste → reviewer → incert. Critic: scenariu → rezultat greșit → diff → test → GO/NO-GO.
- Izolare fizică: pe PC-ul de birou fiecare executant are worktree propriu (`pontaj-pro-jak`, `pontaj-pro-miloi`), niciodată aceeași copie de lucru.

## Mini-backlog v1 (propus 28.09, înainte de start)
| ID | Owner | Branch | Scop | Fișiere/tabele permise | Invariantă | Teste obligatorii | DONE | Reviewer | Atinge DB/RLS/depunere? |
|---|---|---|---|---|---|---|---|---|---|
| V2-M01 | Miloi | — (mod plan, fără editare) | Parity UI↔server: fiecare rând al porții din `src/ofertarePoarta.js` + `ofertareControale.js` → ce impune serverul (trigger/RLS/view), tabel MATCH/UI_ONLY/SERVER_ONLY | citire: src/ofertare*.js, supabase/migrations/*pachet*, *gate* | nu modifică nimic | — (Claude verifică 5 rânduri aleatorii pe schema live) | tabel complet cu fișier:linie pe fiecare rând | Claude | NU |
| V2-M02 | Miloi | miloi/v2-m02-retete | Completează `scripts/audit-v2/fixture.json` → `retete.*` pt scenariile 03/04/05 cu selectori/texte REALE din UI (id-uri clonă deja puse) | scripts/audit-v2/fixture.json; citire src/Ofertare*.jsx | nu atinge scripts/audit-v2/*.js | `node scripts/audit-v2/test-retete.mjs` verde; fiecare selector citat cu fișier:linie | ≥ rețetele 03/04/05 configurate | Jakarinos | NU |
| V2-M03 | Miloi | miloi/v2-m03-teste-pachet | Teste de caracterizare Vitest pt `src/ofertarePachet.js` (`pachetDepasit`) + `controlPachetComplet` — documentează comportamentul ACTUAL (inclusiv golurile S09-10/JAK-V2-09), fără fix | src/ofertarePachet.test.js, src/ofertareControale.test.js (doar adăugare) | nu schimbă cod de producție | `npx vitest run src/ofertarePachet src/ofertareControale` verde | teste noi, fiecare legat de un ID de finding | Jakarinos | NU |
| JAK-V2-07b | Claude (în lucru) | claude/fix-jakv207-rls-scriere | Fix trigger service_role + caz test service_role; test pg local; PR draft | migrarea p + test | fără apply producție | test_jakv207_rls.mjs verde | PR + a doua opinie Jakarinos | Jakarinos → Copilot GO | DA (RLS) |
| V2-J01 | Jakarinos | jak/v2-j01-harness-p2 | Harness P2: auto-răspuns `Page.javascriptDialogOpening`, `caleSandbox` → `103/`, țintă CDP pe tab, SELECT refuzat ≠ abort total | scripts/audit-v2/*.mjs/js | nu scrie în BD real în afara clonei 103 (garda nr_anunt SANDBOX) | vitest scripts/audit-v2 verde + test gardă | scenariu 03 rulează pe 103 până la prima fază | Claude | NU (doar clonă, prin UI) |
| V2-J02 | Jakarinos | jak/v2-j02-gate-depusa | JAK-V2-03: `status='depusa'` cere pachet `depus` + ≥1 cerință (fn_gate_depunere) | migrare nouă + test pg | derogarea owner rămâne | test pg: depusa fără pachet refuzat; cu pachet depus trece | PR draft | Claude → Copilot GO | DA — NU pornește fără GO |
| V2-J03 | Jakarinos | jak/v2-j03-edge-rol | JAK-V2-05/06: poartă de rol în cod pe edge `ofertare-e0-autofill/-inventar-ai/-citire-test/-triere` + rutele api/* care folosesc service_role | supabase/functions/<cele 4>/index.ts, api/*.js | anon + user fără modul → 401/403 înainte de orice cost | test Deno/Node pe handler cu JWT fără modul | PR draft | Claude → Copilot GO | DA (securitate) — NU pornește fără GO |
| V2-J04 | Jakarinos | jak/v2-j04-bytes-depus | JAK-V2-02: la aprobat→depus serverul verifică existența obiectelor `depus_final`/`dovada_seap` în bucket (+ size) | migrare nouă + test pg | fără citire de conținut; doar storage.objects | test pg: manifest fictiv refuzat | PR draft | Claude → Copilot GO | DA — NU pornește fără GO |
