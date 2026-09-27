# JAK_D4_r2 — reparațiile după review-ul Copilot pe PR #495 (NO-GO)

Pleci de la commitul df90db0 (branch `claude/d4-plansa-cli`). Aceleași limite ca în `docs/JAK_D4_plansa_cli.md` și `AGENTS.md`.
Fiecare reparație vine cu testul care reproduce scenariul Copilot și arată că acum e refuzat.

## 1. [MAJOR] O lipire veche poate fi servită pentru imagini noi
`plansa_cli_importa.ts` — `verificaRezultat`, `fetchDinCli`. Rezultatul CLI ține lipirile doar pe cheia `a+b`, fără hash-urile imaginilor.
Scenariu: rezultat vechi cu lipirea A+B și fără felia B individuală; manifest nou, cu B schimbat (alt hash). Adaptorul întoarce 200 cu textul A+B vechi.
**Reparație**: fiecare lipire poartă `sha256_a` + `sha256_b` (ordonate ca în pereche); adaptorul servește o lipire DOAR dacă ambele hash-uri
ale imaginilor din cerere coincid cu cele din rezultat. Nepotrivire → 422 (eroare reluabilă), niciodată text.
**Test**: exact scenariul de mai sus → 422.

## 2. [MAJOR] Un rezultat produs cu un prompt vechi trece ca fiind de versiunea curentă
`verificaRezultat`, `importaPlansa`. Se compară promptul din directorul de pregătire cu handlerul curent, nu promptul care a produs rezultatul.
**Reparație**: un identificator al pachetului de lectură, `pachet_id` = sha256 peste (doc_id, taiat_la, lista ordonată {eticheta, sha256},
perechile de lipire, sha256(INSTRUCTIUNI), sha256(INSTRUCTIUNI_LIPIRE)). Îl calculează pregătirea și îl scrie în manifest.
**Launcher-ul** (nu modelul) îl copiază din `/data/manifest.json` în fișierul rezultat, alături de sha-ul promptului efectiv trimis și de
modelul raportat de CLI (`claude --version` + modelul din jurnal). Importul cere: `pachet_id` din rezultat = `pachet_id` din manifest
= `pachet_id` recalculat acum din handlerul curent și din documentul din BD. Orice diferență → oprire, nimic scris.
**Test**: rezultat R1 (prompt P1) importat cu manifest nou (prompt P2), aceleași JPEG-uri → refuz.

## 3. [MAJOR, nedemonstrat] Sensul invers: o citire API „doar lipire” peste o citire `cli:opus`
Copilot nu l-a putut verifica. Scrie testul: există citire `cli:opus` pe tăiere → apel API cu `doar_lipire` → trebuie refuzat
(versiune incompatibilă) sau să nu scrie. Dacă testul pică, adaugă garda în handler, minimal, cu regula existentă `versiuneIncompatibila`.

## 4. Poarta de owner — o declarăm ce este, nu o prezentăm ca autentificare
`CERUT_DE` vine din mediu; cine are `service_role` pe gazdă poate declara alt UUID. Decizie: e un **script administrativ** rulat doar
pe NAS de owner. Nu construim autentificare nouă. Schimbă: numele variabilei în `OPERATOR_DECLARAT`, mesajele și README-ul
(„verificare administrativă, nu autentificare”). Jurnalul importului notează UUID-ul declarat și `pachet_id`.

## 5. Staging-ul pilotului poate fi șters de o a doua rulare
`run_pilot.sh`: `ST="$D/staging"` + `rm -rf "$ST"` la fiecare rulare.
**Reparație**: director unic per rulare (`$D/staging/<stamp>_<pid>`), șters doar de rularea care l-a creat (trap la ieșire), plus
un lock exclusiv (`flock` pe `$D/.pilot.lock`) cât rulează — a doua rulare iese cu mesaj clar, nu așteaptă și nu șterge nimic.
**Test**: test de fum pe fixture: două lansări simultane → a doua refuzată, staging-ul primei intact.

## La final
Actualizează `docs/JAK_D4_raport.md` (secțiunea „r2”): ce ai schimbat, testele noi, ce n-ai putut rula.
