# ❓ Întreabă echipa — worker pe serverul AI

Decizie Răzvan 05.11.2026 („da 1-2-3-4”): spețe tehnice puse din ERP (`/intrebari`) → răspuns AI **informativ**, vizibil doar
autorului (și ownerului). Primul utilizator: Silviu Stănescu (Director Tehnic). Limită 5 întrebări/zi (owner 20), în BD.

## Piese
| Piesă | Unde |
|---|---|
| Tabel + RLS + bucket + RPC-uri | `supabase/migrations/20261105a_intrebari_tehnice.sql` (livrare: `scripts/livrare_migrare.sh`) |
| Canal worker ↔ ERP | edge `intrebari-tehnice-worker` (verify_jwt = false; poarta: Vault `INTREBARI_WORKER_SECRET`, antet `x-intrebari-secret`) |
| Worker | `intrebari_worker.py` + `cercetare.py` (acest folder), Task Scheduler „Intrebari tehnice worker (Gazpet)”, la 2 minute |
| Cercetare (06.11.2026) | `cercetare.py` (corpus, web oficial, validare); index: `scripts/intrebari/construieste_corpus.mjs` → `corpus_index.json` |
| Surse + `de_verificat` + reluare | `supabase/migrations/20261131e_intrebari_cercetare_surse.sql` (edge v2 o cere) |
| Ecran | `src/IntrebariTehnice.jsx` + `src/intrebariSurse.js`, cheia de modul `intrebari_tehnice` |

## Răspuns din cercetare (cerere Silviu + Răzvan, 06.11.2026)
1. **Corpus intern** — `scripts/intrebari/corpus.mjs` (`CORPUS`): cercetarea normativă din `docs/cercetare` (baza normativă,
   registrul cerințelor atomice cu locator, registrul surselor, practica CNSC, tipare de clarificări, surse lipsă). NU intră:
   `docs/juridic` (dosare cu date de proiect), brief-uri / rapoarte de lucru, SQL. Indexul se caută local, pe cuvinte-cheie
   (BM25 simplu, fără serviciu extern) → max 8 extrase `C1..C8` (≤ 1500 caractere fiecare, ≤ 14000 în total, max 3 pe fișier).
2. **Web oficial — speța NU intră în apelul cu căutare** (runda 2, review P1-a). Trei pași:
   - **a. propunere, fără unelte**: `MODEL_INTEROGARI` (Sonnet) primește titlul + speța curățate de mailuri / linkuri /
     telefoane / numere lungi (contextul de proiect, atașamentele și extrasele interne nu ajung nici aici) și propune max 5
     interogări scurte, ca JSON;
   - **b. filtru local strict** (`cercetare.filtreaza_interogari`): o interogare se aruncă ÎNTREAGĂ dacă are > 80 de caractere,
     mail / link / domeniu, caractere în afara literelor, cifrelor și punctuației simple, un cuvânt cu majusculă care nu e în
     `ACTE_INSTITUTII` (acte normative, instituții, standarde: ISCIR, ANRE, NTPEE, Legea, HG, SR EN …), sau o cifră care nu e
     număr de act / articol / standard (adică nu urmează după `art.`, `alin.`, `Legea`, `HG`, `nr.`, `SR EN`, `ISO`, `PT C` …).
     Limită declarată: un nume propriu scris cu literă mică nu poate fi recunoscut automat — de aceea pasul (a) nu vede
     contextul, iar pasul (c) nu vede speța deloc;
   - **c. căutarea**: un apel cu unealta `web_search` a API-ului, `allowed_domains` = `cercetare.DOMENII_OFICIALE` (listă fixă,
     identică în `src/intrebariSurse.js` și în edge; testul vitest le compară), care primește DOAR interogările filtrate.
     **Interogările efectiv trimise** (blocurile `server_tool_use`) se salvează pe întrebare în `interogari_web` și în jurnalul
     `intrebari_preluari` — ownerul le vede în ecran („🔎 Interogări trimise la căutarea web”). Fără interogări valide → nu se
     caută pe web, răspunsul vine doar din corpus.
   Sursele `W1..Wn` = citările + rezultatele, filtrate încă o dată pe domeniu (și în edge, și în UI); plafon total C + W ≤ 30
   ÎNAINTE de generare. **Rezultat web incomplet** (`max_tokens`, `pause_turn` epuizat, plafonul de căutări consumat,
   `web_search_tool_result_error`, propunerea de interogări tăiată) → NU se publică nimic: eroare „Cercetare incompletă: …”.
3. **Răspunsul** — fără unelte, doar din `<surse>` (conținutul speței, al extraselor și al paginilor e neutralizat: `<`/`>` →
   `‹`/`›`, deci nu poate închide `<surse>` / `<speta>`): prima linie = verdict (Da / Nu / Depinde de … / Incert — de verificat),
   fiecare afirmație normativă cu marcaj `[C1]` / `[W2]`. `cercetare.analizeaza` (aceleași reguli în `src/intrebariSurse.js`,
   cazuri comune în `teste_validare.json`):
   - normativă = act / articol / standard / cifră cu unitate **sau obligație** („obligatoriu”, „trebuie”, „interzis”, „impune”,
     „conform” …);
   - excepția „Nu am găsit sursa oficială pentru …” scutește DOAR o linie care e exclusiv declarația de lipsă (fără `;`, fără
     altă propoziție, fără „dar/însă/iar”, fără articol / cifră / obligație) — „Proba se face la 99 bar; nu am găsit sursa
     oficială pentru alt detaliu.” NU e scutită;
   - o afirmație cu marcaj trece doar dacă măcar una dintre cifrele ei apare în titlul/extrasul sursei citate („Art. 999 impune
     99 bar [C1]” trece doar dacă C1 conține „999” sau „99”);
   dacă pică → o singură reparare; ce rămâne fără sursă se scoate (`curata_raspuns`); un verdict rămas fără nicio sursă citată
   (sau lipsă) devine **„Incert — de verificat”**, nu un „Depinde” generic. Sursele citate trec verificarea finală pe setul care
   se salvează (`verifica_surse_finale`: max 30, ID-uri unice dintre cele trimise, domenii / căi valide, < 80 KB) → `surse`.
4. **Model**: întrebările cu temei normativ / juridic (detectate după cuvinte-cheie: lege, normativ, articol, ISCIR, ANRE,
   autorizare, recepție, sudură, contract, achiziții …) merg **implicit pe Opus** — `MODEL_NORMATIV` = `claude-opus-5-5`, cel mai
   scump model, pentru pașii de căutare, răspuns și reparare; restul pe `MODEL_GENERAL` = `claude-sonnet-5-5`. Propunerea de
   interogări e mereu pe Sonnet. Constantele stau în `cercetare.py`; schimbarea modelului = PR.
5. **Cost — maxim de apeluri API pe o preluare, numărând și continuările**: 1 (interogări) + până la 4 la căutare (1 cerere +
   `MAX_PAUZE_WEB` = 3 continuări `pause_turn`) + 1 (răspuns) + 1 (reparare) = **max 7 apeluri**; în mod obișnuit 3–4.
   Căutările web: **max 5 pe întrebare în total** (`max_uses` scade la fiecare continuare; plafon consumat + încă `pause_turn` →
   „Cercetare incompletă”). Tokenii + `web_search_requests` + `apeluri` se adună în `tokeni` (și la erori). Un 429/529 după un
   pas plătit NU se reia automat (s-ar plăti iar) — eroare vizibilă.
   **Plafonul global de 40 de preluări pe zi** se numără din jurnalul durabil `intrebari_preluari` (un rând la fiecare preluare,
   cu costul ei), deci **include reluările**: „🔁 Reia cu cercetare” nu mai poate ocoli plafonul (review r1 P1-c). Amânările certe
   fără cost (429/529 la primul apel) nu se numără.
6. **UI**: verdictul evidențiat (galben dacă e „Incert”), textul, apoi „Surse” (linkuri doar pe domeniile oficiale); ownerul vede
   și interogările web trimise. „⚑ Răspuns neclar — trimite la verificare” (autorul) → stare `de_verificat`, fără alte efecte.
   „🔁 Reia cu cercetare” — DOAR ownerul (costă, intră în plafon). Rezultatul unei acțiuni rămâne legat de întrebarea pe care
   s-a apăsat (id + generație), nu apare sub altă întrebare deschisă între timp.

## Identitate
- Claude prin **API** (cheia din Credential Manager `anthropic-claude-code` / `api`, workspace-ul cu plafon lunar), NU abonamentul:
  abonamentul nu devine backend ERP pentru alți utilizatori (vezi `worker/claude-cli/README.md`).
- Secretul workerului: `C:\Users\Gazpet-Ai\.secrete\intrebari_worker_secret.txt` (64 hex, același cu Vault). Nu se pune în repo, chat sau log.
- Modelul: constantele din `cercetare.py` (Opus la normativ/juridic, Sonnet în rest). Singura unealtă: `web_search` pe domeniile
  oficiale (server-side, la Anthropic) — trebuie activată pentru organizație/workspace în Console. Fără fișiere, fără BD.

## Instalare (o singură dată, pe Gazpet-Claude)
1. Migrarea, prin `livrare_migrare.sh` (după „da”).
2. Secretul: generat în BD (`vault.create_secret(encode(gen_random_bytes(32),'hex'), 'INTREBARI_WORKER_SECRET')`), apoi citit
   cu `psql -At … -o C:\Users\Gazpet-Ai\.secrete\intrebari_worker_secret.txt` — valoarea nu trece prin chat.
3. Deploy edge `intrebari-tehnice-worker` cu verify_jwt = false.
4. Copia scriptului din `main` în `C:\Users\Public\intrebari_worker\intrebari_worker.py` (nu rulează din clona de lucru, care își
   schimbă branch-ul), apoi Task Scheduler (fără .ps1/.cmd ad-hoc — Bitdefender):
   `schtasks /Create /TN "Intrebari tehnice worker (Gazpet)" /SC MINUTE /MO 2 /TR "\"C:\Program Files\Python313\pythonw.exe\" -B C:\Users\Public\intrebari_worker\intrebari_worker.py" /F`
5. Acces: rând în `user_module_access` (`intrebari_tehnice`, editor) — doar cu acordul lui Răzvan.

### Actualizarea „din cercetare” (20261131e) — ordinea contează
1. Migrarea `20261131e_intrebari_cercetare_surse.sql` prin `livrare_migrare.sh` (după „da”) — ÎNAINTE de merge-ul UI-ului
   (ecranul merge și fără ea, pe coloanele vechi, dar butoanele noi cer funcțiile) și înainte de edge.
2. Deploy edge `intrebari-tehnice-worker` v2 (verify_jwt = false, ca înainte).
3. Web search activat în Console pentru workspace-ul cheii API (altfel apelul de cercetare dă 400 → eroare vizibilă).
4. Pe server, din clona la zi pe `main`: copiezi `intrebari_worker.py`, `cercetare.py` **și** `corpus_manifest.json` în
   `C:\Users\Public\intrebari_worker\`, apoi `node scripts/intrebari/construieste_corpus.mjs C:\Users\Public\intrebari_worker\corpus_index.json`
   (iese cu 1 dacă un fișier din corpus lipsește). La pornire workerul verifică `sha256(corpus_index.json)` = `index_sha256` din
   manifest; index lipsă / stricat / nepotrivit (sau cheia API lipsă) → **nu preia nimic** (`corpus_invalid` în jurnal) —
   întrebările așteaptă în coadă, nu se consumă. Indexul e determinist (fără dată, sha256 pe text cu LF), deci aceeași clonă dă
   același sha pe orice mașină.
   **La o schimbare într-un fișier din `CORPUS`** (`docs/cercetare/...`): în PR-ul respectiv se regenerează manifestul —
   `node scripts/intrebari/construieste_corpus.mjs <temp>.json --manifest worker/intrebari-tehnice/corpus_manifest.json` — iar
   pe server se recopiază manifestul și se reconstruiește indexul. Verificare fără scriere:
   `node scripts/intrebari/construieste_corpus.mjs --verifica worker/intrebari-tehnice/corpus_manifest.json`. Un `docs/cercetare`
   schimbat pe `main` fără manifest nou oprește workerul (fail closed) până la PR-ul cu manifestul.
5. Întrebarea id 1 NU se reia automat: ownerul apasă „🔁 Reia cu cercetare” pe ea, după pașii 1–4.
6. `registru_automatizari` + rândul din `public.automatizari`: fișa nouă (web pe domenii oficiale, Opus) — CLAUDE.md pct. 7.

## Verificare după livrare (teste negative, într-o tranzacție cu ROLLBACK)
Simulat cu `SET LOCAL ROLE authenticated` + `request.jwt.claims` pentru un utilizator FĂRĂ cheia de modul și pentru autor:
- străinul: INSERT în `intrebari_tehnice` refuzat; SELECT pe întrebările altuia = 0 rânduri; SELECT pe `storage.objects` din bucket = 0;
- autorul: INSERT cu `stare='raspuns'` / `raspuns_md` → câmpurile sunt resetate de trigger; a 6-a întrebare în aceeași zi refuzată;
- `fn_intrebari_preia` / `_raspunde` / `_amana` refuzate pentru `authenticated` și `anon`;
- (20261131e) `intrebari_preluari`: SELECT / INSERT refuzat pentru `authenticated` și `anon`; după N reluări ale aceleiași
  întrebări, `count(*)` pe ziua curentă crește cu N (plafonul de 40 nu se ocolește); `fn_intrebari_reia` nu golește `tokeni` / `preluat_la`.

## Funcționare și erori
- O rulare preia max 3 întrebări; lock `C:\Users\Public\intrebari_worker\worker.lock`.
- Jurnal local: `C:\Users\Public\intrebari_worker\jurnal.jsonl` — doar id, stare, tokeni, durată, numărul de extrase / surse web /
  interogări / căutări / citate, `reparat`, `scoase`, `incert`, motivul erorii (fără conținut, fără textul interogărilor, fără
  secrete). Textul interogărilor trimise stă DOAR în BD (`interogari_web`, `intrebari_preluari`), vizibil ownerului.
- Jurnalul de preluări din BD (`intrebari_preluari`, 20261131e): un rând la fiecare preluare (încercare, rezultat, tokeni,
  interogări). RLS fără politici, SELECT doar `service_role`; scris doar de funcțiile workerului; reluarea nu-l atinge.
- API supraîncărcat / limită de rată → întrebarea rămâne „în lucru”, BD o redă după 30 min (max 3 încercări, apoi „eroare”).
  Fără bucle de reîncercare.
- Credit API terminat → „eroare” cu mesaj clar pentru utilizator.

## Ce NU face
Nu caută pe web în afara domeniilor oficiale fixe (decizia Silviu + Răzvan 06.11.2026 lărgește regula 27.10.2026 doar pentru
acest worker: apelul cu web nu primește speța, atașamente, context de proiect sau extrase interne — doar interogările filtrate —
iar ieșirea e limitată la `allowed_domains`), nu deschide pagini în afara căutării, nu trimite mail, nu scrie în alte tabele
decât rândul întrebării și jurnalul ei de preluări, nu vede ERP-ul, nu folosește Copilot / Jakarinos (ar expune contextul intern
al echipei Paw).

## Teste
- `node node_modules/vitest/vitest.mjs run src/intrebariSurse.test.js src/intrebariUtil.test.js scripts/intrebari/corpus.test.mjs`
- `python -I -B -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"` (validarea are cazurile comune în `teste_validare.json`;
  `test_worker.py` rulează fluxul complet FĂRĂ rețea — `apel` / `edge` înlocuite: speța nu ajunge în apelul cu web_search,
  rezultat web incomplet nepublicat, plafonul de căutări pe întrebare, corpus invalid = nicio preluare)
- `node scripts/intrebari/construieste_corpus.mjs --verifica worker/intrebari-tehnice/corpus_manifest.json` (manifestul la zi)
- Revenirea BD: `supabase/revenire/20261131e_intrebari_cercetare_surse_ROLLBACK.sql` (vezi `supabase/revenire/README.md`).
