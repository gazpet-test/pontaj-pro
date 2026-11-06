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
2. **Web oficial** — un apel separat cu unealta `web_search` a API-ului, `allowed_domains` = `cercetare.DOMENII_OFICIALE`
   (listă fixă, identică în `src/intrebariSurse.js` și în edge; testul vitest le compară). Acest apel primește DOAR titlul +
   speța, curățate de mailuri / linkuri / telefoane / numere lungi; contextul (proiect, localitate), atașamentele și extrasele
   interne NU ajung aici. Sursele `W1..Wn` = citările + rezultatele, filtrate încă o dată pe domeniu (și în edge, și în UI).
3. **Răspunsul** — fără unelte, doar din `<surse>`: prima linie = verdict (Da / Nu / Depinde de …), fiecare afirmație
   normativă cu marcaj `[C1]` / `[W2]`, „Nu am găsit sursa oficială pentru …” când lipsește temeiul. `cercetare.analizeaza`
   verifică; dacă pică → o singură reparare; ce rămâne fără sursă se scoate din text (`curata_raspuns`). Se salvează doar
   sursele citate (`surse`).
4. **Model**: `MODEL_NORMATIV` = `claude-opus-5-5` dacă întrebarea are cuvinte-cheie normative/juridice, altfel
   `MODEL_GENERAL` = `claude-sonnet-5-5` (constante în `cercetare.py`).
5. **Cost** pe întrebare: 2 apeluri (web + răspuns), 3 cu repararea; max 5 căutări web. Tokenii + `web_search_requests` se
   adună în `tokeni`. Un 429/529 după un pas plătit NU se reia automat (s-ar plăti iar) — eroare vizibilă.
6. **UI**: verdictul evidențiat, textul, apoi „Surse” (linkuri doar pe domeniile oficiale). „⚑ Răspuns neclar — trimite la
   verificare” (autorul) → stare `de_verificat`, fără alte efecte. „🔁 Reia cu cercetare” — DOAR ownerul (costă).

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
4. Pe server, din clona la zi pe `main`: copiezi `intrebari_worker.py` **și** `cercetare.py` în `C:\Users\Public\intrebari_worker\`,
   apoi `node scripts/intrebari/construieste_corpus.mjs C:\Users\Public\intrebari_worker\corpus_index.json` (iese cu 1 dacă un
   fișier din corpus lipsește). Fără index workerul nu preia nimic (`corpus_lipsa` în jurnal) — întrebările așteaptă în coadă.
   Indexul se reconstruiește la fiecare schimbare în `docs/cercetare`.
5. Întrebarea id 1 NU se reia automat: ownerul apasă „🔁 Reia cu cercetare” pe ea, după pașii 1–4.
6. `registru_automatizari` + rândul din `public.automatizari`: fișa nouă (web pe domenii oficiale, Opus) — CLAUDE.md pct. 7.

## Verificare după livrare (teste negative, într-o tranzacție cu ROLLBACK)
Simulat cu `SET LOCAL ROLE authenticated` + `request.jwt.claims` pentru un utilizator FĂRĂ cheia de modul și pentru autor:
- străinul: INSERT în `intrebari_tehnice` refuzat; SELECT pe întrebările altuia = 0 rânduri; SELECT pe `storage.objects` din bucket = 0;
- autorul: INSERT cu `stare='raspuns'` / `raspuns_md` → câmpurile sunt resetate de trigger; a 6-a întrebare în aceeași zi refuzată;
- `fn_intrebari_preia` / `_raspunde` / `_amana` refuzate pentru `authenticated` și `anon`.

## Funcționare și erori
- O rulare preia max 3 întrebări; lock `C:\Users\Public\intrebari_worker\worker.lock`.
- Jurnal: `C:\Users\Public\intrebari_worker\jurnal.jsonl` — doar id, stare, tokeni, durată, numărul de extrase / surse web /
  căutări / citate, `reparat`, `scoase` (fără conținut, fără interogări, fără secrete).
- API supraîncărcat / limită de rată → întrebarea rămâne „în lucru”, BD o redă după 30 min (max 3 încercări, apoi „eroare”).
  Fără bucle de reîncercare.
- Credit API terminat → „eroare” cu mesaj clar pentru utilizator.

## Ce NU face
Nu caută pe web în afara domeniilor oficiale fixe (decizia Silviu + Răzvan 06.11.2026 lărgește regula 27.10.2026 doar pentru
acest worker: apelul cu web nu primește atașamente, context de proiect sau extrase interne, iar ieșirea e limitată la
`allowed_domains`), nu deschide pagini în afara căutării, nu trimite mail, nu scrie în alte tabele, nu vede ERP-ul,
nu folosește Copilot / Jakarinos (ar expune contextul intern al echipei Paw).

## Teste
- `node node_modules/vitest/vitest.mjs run src/intrebariSurse.test.js src/intrebariUtil.test.js scripts/intrebari/corpus.test.mjs`
- `python -I -B -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"` (validarea are cazurile comune în `teste_validare.json`)
