# E9 B2 — implementare locală, integrare blocată

Stare: **NU este gata de integrare/deploy**. Codul independent și testele sunt
scrise; lipsește contractul autorizat de citire a contextului B1. Nu s-au
modificat fișierele B1/B3, schema, drepturi, date sau configurația producției.
Contractele au fost citite local prin `git show origin/izometrie/e9-b1:…` și
`git show origin/izometrie/e9-b3:…`; nicio altă operație Git.

## Fișiere

- `supabase/functions/izo-e3-ocr-local/index.ts`, `handler.ts`: entrypoint și
  operații închise, corpurile sunt cele plate trimise de `e3_client.py`.
- `contract.ts`, `rpc.ts`, `storage.ts`, `context.ts`: validări, apeluri B1,
  PDF-ul identificat exclusiv de calea B1, portul de context încă nelegat.
- `haiku.ts`: o singură implementare a fazelor plătite pentru ambele ramuri.
- `pdf.ts`, `pdfWorker.ts`: pdf-lib 1.17.1 în worker Deno separat, terminat la
  3 secunde; mono/multi/invalid/neverificabil. Nu există regex de numărat pagini.
- `_shared/izoOcrLocal.ts`: numai `IZO_OCR_LOCAL_SECRET`, antetul dedicat,
  verificare `fn_verifica_secret`, fără secret alternativ.
- `_shared/izoE3Poarta.ts`: extragere fidelă a porții existente;
  `ocr-packing-list/avizE3Handler.ts` o apelează, fără schimbarea fluxului Haiku.
- `ocr-packing-list/avizE3.ts`: funcții noi pentru schema brută, validarea ei
  strictă și structura finală; normalizatorul și handlerul vechi nu primesc
  noile restricții E9.
- `handler_test.ts`, `pdf_test.ts`, `fixtures/*.json`: teste și cele două
  payloaduri reale copiate din B3; `scripts/test-e9-b2-offline.mjs`: harness Node.

## Contracte HTTP

POST, corp JSON limitat în flux la 12 MiB. OPTIONS numai pentru CORS.

| Operație | Intrare, în plus față de `op` | Ieșire |
| --- | --- | --- |
| `cere` (JWT) | `pdf_base64,proiect_id,depozit_id,sablon` | `success,cerere_id,termen_local`; 409 pentru rutarea spre Haiku, 429 pentru cote, 422 pentru PDF invalid |
| `stare` (JWT) | `cerere_id` | numai proiecția sigură B1; 404 pentru alt creator |
| `fallback` (JWT) | `cerere_id` | aviz_e3 + sursa + cerere_id; 409 in_curs/deja_consumat |
| `preia` (secret) | `worker_id` | `cerere:null` sau `id,token,sablon,sha,termen_local`; fără cale |
| `link` (secret) | `cerere_id,token` | URL semnat 120s; respinge orice cale în body |
| `arbitreaza` (secret) | `cerere_id,token,rotatie_grade,celule` | arbitraj ok/invalid/plafon_depasit/deja_consumat; exact celulele cerute |
| `rezultat` (secret) | `cerere_id,token,obiect,eroare,sursa` | confirmare; exact o ramură nenulă; normalizare exclusiv server-side |
| `heartbeat` (secret) | `worker_id,stare,ora_server,modele,versiune` | confirmare |

JWT-ul este verificat prin clientul caller și `auth.getUser()`. Orice `p_user`
provine exclusiv de acolo. Profilul, accesul magazie și atribuirea gestionar
valabilă azi București se citesc doar cu caller JWT, înainte de RPC-urile B1.
Workerul ignoră Authorization; UI refuză prezența antetului secret.
`curata` nu este în lista închisă de 5 operații cerută în brief; nu este expus.

Fazele de cost urmează contractul B1 revizuit, care are prioritate față de
instrucțiunile de rezervare separată din design: `drept_platit` →
`rezerva_apel` (rezervă+leagă atomic) → count_tokens → `apel_faza(trimis)` →
un singur messages, timeout 30s → `raspuns` cu obiect validat/invalid →
`decontat`. Nu se cheamă separat `fn_ai_plafon_rezerva/deconteaza`.
Count indisponibil: `esuat_inainte`/0; timeout după trimitere: `esuat_dupa`/NULL.
ACK pierdut: fără retrimitere. Usage lipsă: răspunsul rămâne în faza `raspuns`,
cu cost estimat conservator 0,05 USD; recovery B1 îl decontează cu NULL.
Repetarea nu generează; arbitrajul repetat validează din nou setul exact.
PDF-ul și valorile OCR sunt numai date, fără alegerea modelului/costului/RPC-ului.

## Blocaj verificat în B1

`fn_ocr_local_stare` întoarce doar stare/ramură/rezultat/eroare/termene.
Nu oferă proiect, depozit, creator, rezervare sau răspunsul arbitrajului.
SELECT pe `ocr_local_cereri` este revocat inclusiv pentru service_role și
authenticated. `verifica_token` oferă doar cale/șablon/termen, iar
`drept_platit` consumă dreptul și tot nu întoarce depozitul sau apel_raspuns.

Prin urmare, pe contractele primite nu există o implementare completă pentru:

1. poarta pe proiectul și depozitul din rând, înainte de stare/fallback;
2. cost/model/plafon veridice la rezultatul local;
3. returnarea arbitrajului persistat la repetare.

`context.ts` exprimă portul necesar, fără să inventeze un RPC existent. Implicit
refuză cu `503 contract_context_lipsa`; `cere` refuză înainte de admitere, pentru
a nu crea cereri care n-ar putea fi închise. În teste există un adaptor explicit
în memorie; acest adaptor **nu este o integrare de producție**. `index.ts` nu
configurează portul și nu trebuie activat în această stare.

Completarea propusă, încă NEAUTORIZATĂ/neimplementată: o migrare B2 nouă și
rollback pentru un helper de citire minimă `context(id,user,token)`, executabil
numai de service_role, care filtrează creatorul ori tokenul curent și termenul,
refuză tombstone-urile și întoarce câmpurile din `ContextCerere`. Nu expune aceste
câmpuri UI-ului și nu schimbă granturile B1. Pentru JWT se verifică întâi
identitatea, se citește numai contextul creatorului, se aplică poarta caller pe
acel context, apoi se apelează RPC-urile cozii. **Acest lookup trebuie exceptat
explicit de la cerința literală „înainte de orice RPC”**, altfel cerința este
circulară. Contextul nu poate fi luat din body sau din service_role pentru
decizii de autorizare.

Este necesară confirmarea acestei completări: AGENTS.md interzice atingerea
„schema BD” fără cerere explicită, iar brief-ul spune să nu schimbăm contractele
B1. Întrebarea de clarificare a fost trimisă în timpul lucrului; nu există
aprobare implicită prin trecerea timpului.

## Verificări și limite

Executat local cu Node 24.20.0, fără instalări/rețea:

```powershell
& 'C:/Program Files/nodejs/node.exe' --test scripts/test-e9-b2-offline.mjs
```

Rezultat executat: **39 teste, 39 trecute, 0 eșecuri**. Harness-ul execută testele pure B2 și suitele originale `avizE3Handler_test.ts`
și `avizE3_test.ts` printr-un shim `Deno.test`. Acoperă și fișierele TS noi
lexical, fără typecheck. Fixture-urile reale B3 trec prin schema brută,
normalizare, prefill și `randNormalizat`: 1,343 → 1343 kg, 9.920 → 9920 kg,
metri → mm, zecimale și serii cu zero inițial. Testele cu clientul cozii simulat
acoperă secret, creator, drepturi expirate, token/cale, cote înainte de Storage,
PDF multi/invalid/neverificabil, cele două ramuri rezultat, JSON invalid/trunchiat,
exactitatea celulelor, rezervare atomică, timeout/count indisponibil, concurență,
fallback integral/repetare și ACK-uri pierdute. Sunt teste offline de protocol,
**nu demonstrează atomicitatea SQL sau comportamentul PostgREST real**.

Nu s-au executat Deno, pdf-lib în workerul real, PostgreSQL/PostgREST, Storage,
vitest sau deploy. `pdf_test.ts` pregătește probe reale pdf-lib pentru mono/multi,
object streams, text fals /Type /Page, criptare/trunchiere și worker timeout.
Fixture-ul real `imageToPdf` nu există aici și nu este înlocuit cu o pretenție
de validare. Runtime-ul Supabase trebuie verificat pentru suportul Worker și
includerea modulului `pdfWorker.ts` la împachetare; fără suport, verdictul este
neverificabil și UI poate continua pe Haiku, conform R3-5.

Termenele 49/51, 89/90/91, 119/121 și recuperarea costului după restart sunt
aplicate în RPC-urile B1; necesită harness-ul PG/PostgREST real la reviewer.
Testele offline nu le declară demonstrate. Plafonul din răspunsul persistat de
fallback este snapshot-ul citit înainte de decontare (ordinea impusă de R3-1);
afișarea unui snapshot după decontare cere un contract suplimentar de actualizare
sau citire a metadatelor fără rescrierea rezultatului persistat.

Bucketul privat, limitele sale, secretul Vault, verify_jwt=false, cronurile,
retenția/curățarea și înregistrările de automatizare nu au fost instalate sau
modificate; sunt pași de integrare pentru Claude după închiderea blocajului.
R3-7 aparține B4: codul B2 oferă semnalele 409/429 și fallback pe aceeași cerere;
nu a fost schimbat UI-ul și nu s-a introdus reintrare în citesteAI.
