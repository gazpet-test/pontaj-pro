# Redări teren (Lot 1 Transgaz) — README-ul modulului

Stare la 02.11.2026 dimineața (felia de noapte 01→02.11, branch `feat/redari-teren`). Brief: `BRIEF_2026-11-01.md` (Răzvan, prin Proiectul
Juridic). Contractul tehnic obligatoriu: `CONTRACT_SCHEMA.md`. Șabloanele și harta câmpurilor: `SABLOANE.md`. Migrarea și verificarea ei:
`MIGRARE_20261126a.md`. **Migrarea `20261126a` (r6) ESTE APLICATĂ pe producție** — 01.11.2026 23:4x, după regula #1877 (decizia 2A): Jakarinos
r6 GO (P1=0, P2=0), Copilot r6 GO cu observații (P1=0), DRY r1–r6 verzi pe prod, apply prin `scripts/livrare_migrare.sh` (versiune
`20261126120000`, sha256 `9fcc00c2…d955`, GATE 0e = 0). Sanity după aplicare: 14 tabele `red_*`, 22 funcții `fn_red_*`, 32 politici, bucket
`redari` privat, cele 3 RPC publice/`fn_red_nivel` sunt SECURITY DEFINER cu `search_path = public, pg_temp`. **Niciun drept acordat** (vezi §5).
Frontend-ul: **LIVRAT pe main** — PR #916 (squash `e9b8f3bb`, 02.11.2026 02:22) după Jakarinos r49/r50 **GO cu observații** (niciun P1
„accidental”) și Copilot FE r43/r44 **GO cu observații**; 209 teste `src/redari` verzi, build OK; Vercel deployează automat. Telemetria Sentry
(`src/redari/sentryScrub.js`, ~50 de runde): formularul public = DROP total; evenimentele din contextul modulului (URL `/redari`, `rpc/fn_red_*`,
breadcrumbs) păstrează doar câmpurile sigure (allow-list: message/transaction/exception + stack fără `vars`; fără extra/contexts/breadcrumbs/user/
corp/tags/release/sdk); INP oprit, `tracesSampler` 0 pe formular, `beforeSendSpan` golește; restul ERP-ului = euristici de apărare în adâncime.
**Model de amenințare**: scurgere accidentală (cod/SDK), nu adversar care deține deja identificatorul (fragmentare în texte libere = rezidual
asumat). **De confirmat de Răzvan**: (1) în text neparcurs hash ≡ identificator → evenimentul se pierde (cost global, rar); (2) rezidualul adversarial.
`Referrer-Policy: no-referrer` + noindex + no-store pe `/redari/raspuns/*` (vercel.json) + meta; `scripts/redari_sabloane_verifica.mjs` verifică și relațiile externe.

## 1. Scop

Gazpet convoacă ~1.360 de deținători de teren (2.728 parcele, 7 UAT-uri din Mehedinți) la constatarea readucerii terenului la starea
inițială, ține evidența fiecărei parcele și persoane, generează documentele precompletate din șabloanele Model_1..5 și urmărește starea
fiecărui rând (parcelă × deținător) până la PV semnat. Registrul e proba față de Transgaz și APM: istoric nemodificabil (jurnal append-only),
fără ștergere fizică, date personale izolate de restul (viewer-ul nu le vede nici în BD, nu doar în UI).

Deciziile lui Răzvan (01.11 seara): **2A** migrarea se aplică doar după GO Jakarinos + Copilot; **3A** drepturile prin `user_module_access`
(modul `redari`, niveluri `admin` / `editor` / `viewer`); **4A** DOCX cu jszip (fără librărie nouă); **5A** QR generat local cu `qrcode`
(singura dependență nouă); **6 manual** — răspunsul public NU trimite email/SMS și NU generează PV automat; operatorul face totul din Registru.

## 2. Arhitectură

### 2.1 Baza de date (`supabase/migrations/20261126a_redari_teren.sql`, totul nou, prefix `red_`)
| Obiect | Rol |
|---|---|
| `red_proiecte` | proiectul (LOT1-PRUNISOR-JUPA): contract, împuternicire, reprezentant TGZ/Gazpet, contact, `text_gdpr`, `text_declaratie` (DEFAULT-uri editabile cu textele confirmate de Juridic) |
| `red_uat` | cele 7 UAT-uri: `uat3` (PRU/GOD/HUS/CAZ/ILO/BAL/SIS), primărie, reprezentant nominalizat, zilele de sesiune 1..3 + program + sate, afișarea |
| `red_parcele` | parcela: `id_parcela` = `T{tronson}-{uat3}-{nnnn}`, `cheie_sursa` (identitatea din Excel-ul TGZ), `valoare_lei` doar prin funcții (privilegii pe coloană) |
| `red_detinatori` | persoana (fără contact): nume, `nume_normalizat`, calitate, cotă, decedat, sursa/versiunea listei TGZ |
| `red_detinatori_contact` | PII (adresă, telefon, email) — SELECT doar admin/editor |
| `red_detinatori_token` | tokenul formularului public (43 caractere, generat de trigger, imutabil, expiră la ultima zi de sesiune + 30 zile) — SELECT doar admin/editor, nimeni nu-l scrie |
| `red_convocari` | convocarea: canal, `nr_document` (C-0001), expediere, AR, retur, hash + calea fișierului în bucket, stare activ/anulat |
| `red_raspunsuri` + `red_raspunsuri_meta` | răspunsul (opțiune, zi, obiecții, declarație; `seq` = tie-break) + metadatele tehnice (IP, user-agent, payload), doar admin/editor |
| `red_procese_verbale` | PV A/B/C: numerotare, stare generat/trimis/semnat/anulat, fișiere generat/semnat — **doar schema**, fără UI |
| `red_jurnal` | append-only pe toate tabelele de business (fără token și fără contorul de rate limit); pe contact/meta doar numele câmpurilor schimbate |
| `red_numere` | numerotare fără refolosire (`C`, `PVA-HUS`, `PVB-HUS`, `PVC-T3`, `P-T3-HUS` pentru parcele) |
| `red_import_loturi` | lotul de import: versiune listă, contoare, stare in_curs/finalizat/esuat |
| `red_rate_limit` | contorul RPC-urilor publice (30/IP/10 min, 5/token/10 min) — fără acces authenticated/anon |

Vederi (`security_invoker`): `red_v_stare_parcela` (o linie per parcelă × deținător, cu STAREA din cele 12 — contract §3),
`red_v_centralizator_uat`, `red_v_tronson`, `red_v_parcele` (parcele fără `valoare_lei`; UI-ul citește de aici, nu din tabel).

Funcții (22, toate SECURITY DEFINER cu `search_path` fix): `fn_red_nivel()` (admin/editor/viewer/NULL; owner = admin),
`fn_red_numar_document`, `fn_red_rezerva_numere_parcele`, `fn_red_valoare_parcela` / `_seteaza`, `fn_red_adresa_cunoscuta`, RPC-urile publice
`fn_red_formular_public(token)` și `fn_red_raspuns_public(token, optiune, zi, obiectii, declaratie, user_agent)` (anon + authenticated),
trigger-ele de legături/imutabilitate (`fn_red_legaturi`: legături, `id_parcela`/`tronson`, `seq`, `uat3` cât există parcele pe UAT), validarea
răspunsurilor (`fn_red_raspunsuri_valideaza`, și la UPDATE-urile de conținut), jurnal, token, rate limit (curățare cel mult o dată la 10 min, în
loturi), `fn_red_storage_expr_bucket` (verificatorul politicilor străine de pe `storage.objects`, intern). `created_at` al răspunsurilor îl pune
trigger-ul; `authenticated` nu are privilegiu pe `seq` / `created_at`.

Bucket privat `redari` (pdf/docx/jpeg/png, 25 MB): politici doar SELECT + INSERT pentru admin/editor; fișierele sunt imutabile — o
regenerare = cale nouă `{nr_document}-v{n}.docx`. Căi: `{proiect_cod}/{uat3}/{id_parcela}/…`.

Fișiere însoțitoare: `supabase/revenire/20261126a_redari_teren_ROLLBACK.sql` (revenire armată), `supabase/tests/20261126a_redari_teren_dryrun.sql`
(DRY, TEST0–TEST9, rulează doar în tranzacția de probă), `supabase/tests/20261126a_redari_teren_schelet.sql` (PG17 local), `scripts/livrare_migrare.sh`.

### 2.2 Roluri (3A)
Cheia de modul `redari` în `app_modules`; nivelul din `user_module_access.access_level`: `admin` (= redari_admin), `editor` (= redari_operator),
`viewer` (= redari_viewer). Owner = admin implicit. Viewer vede parcele, deținători, răspunsuri, vederi și jurnal, dar NU contactul, tokenul,
metadatele răspunsurilor, `valoare_lei` și nu scrie nimic. Migrarea NU acordă niciun drept — le dă Răzvan (vezi §5).

### 2.3 Frontend
| Fișier | Rol |
|---|---|
| `src/Redari.jsx` | ecranul `/redari` (`requireModule="redari"`): antet cu proiect + nivel, taburi Registru / Fișa parcelei / Import TGZ; Registrul cu filtre, STARE colorată și acțiunile pe rând; modalele Convocator, Expediat, AR/Retur, Răspuns telefonic; borderoul CSV |
| `src/redari/ui/FisaParcela.jsx` | fișa: date parcelă (`valoare_lei` doar admin), deținători + contact (admin/editor), cronologie unită (convocări, răspunsuri, PV, jurnal), fișiere cu link semnat 10 min, adăugare/editare deținător, soft delete cu motiv, reîncărcare convocator (versiune nouă) |
| `src/redari/ui/ImportTgz.jsx` | importul Excel TGZ: previzualizare, raport (dubluri, neidentificați, fără cheie, ambigue, erori), commit în loturi |
| `src/redari/ui/comune.jsx` | paletă G/S, proiecții explicite de coloane, `SABLON_CONVOCATOR`, `citesteTokenRaspuns`, `motivBlocareConvocator`, citiri paginate (`citestePaginat` în pagini de 1000, `citesteIn` în loturi de 100) folosite în Fișă și borderou |
| `src/redari/stare.js` | cele 12 stări și ierarhia (identică cu `red_v_stare_parcela`), ultimul răspuns cu `seq` ca tie-break, returul acoperit de AR ulterior |
| `src/redari/importTgz.js` | parsarea Excel-ului TGZ (antet rândul 3, `Nr.Crt.` x/y = coproprietari, neidentificat, `cheie_sursa`, județul din adresă; identități ambigue sau contradictorii sub același Nr.Crt. → necomise) și scrierea în loturi de 200 cu rezervare de numere prin RPC (oprire înainte de orice INSERT dacă s-ar depăși 9999), contoare după fiecare lot, reluare idempotentă |
| `src/redari/idParcela.js` | `uat3`, normalizare nume, formatul `id_parcela` |
| `src/redari/docx.js` | `completeazaDocx` (jszip, `{{camp}}`, QR ca imagine), `genereazaConvocator` / `verificaDateConvocator`, hash sha256, borderou CSV (anti formula-injection), `salveazaConvocator` / `reincarcaConvocator` (rând → upload `upsert:false` → update path+hash; versiunea nouă din listarea paginată a folderului) |
| `src/redari/sentryScrub.js` | tokenul din `/redari/raspuns/<token>` nu ajunge în Sentry (`beforeSend` / `beforeSendTransaction` în `src/main.jsx`): URL-uri, variante `%2F`, `p_token` în payload-uri codificate URL (decodare repetată), chei la orice adâncime; dacă scrub-ul însuși aruncă, evenimentul e eliminat, nu trimis brut |
| `src/RedariRaspunsPublic.jsx` | formularul public `/redari/raspuns/:token`, fără login, mobile-first, 4 opțiuni, fără date personale |
| `public/redari/sabloane/*.docx` | șabloanele reale Model_1..5 v5 cu placeholder-e (`convocator`, `pv_a`, `pv_b`, `adresa_uat`, `pv_c`); originalele în `docs/redari/referinta/` |
| `scripts/redari_sabloane_verifica.mjs` | verifică placeholder-ele șabloanelor (0 rupte între run-uri) |

`src/App.jsx` primește doar ruta lazy `/redari`, ruta publică `/redari/raspuns/:token` și intrarea în meniu (🌾 Redări teren). Teste vitest
(`npm test`): `stare`, `idParcela`, `importTgz`, `docx`, `sentryScrub` — 131 de teste, toate pe date fictive.

## 3. Cum se folosește (după aplicarea migrării și acordarea rolurilor)

1. **Proiectul LOT1**: la prima deschidere a `/redari`, un admin apasă „＋ Creează proiectul LOT1” → `red_proiecte` (cod `LOT1-PRUNISOR-JUPA`,
   beneficiar Transgaz, contact + reprezentant Gazpet) și cele 7 UAT-uri cu `uat3` și județul. Restul datelor proiectului (nr./dată contract,
   nr./dată împuternicire, reprezentant TGZ, telefon contact) și **zilele de sesiune + programul + satele pe UAT** nu au încă ecran (Setări /
   UAT sunt în faza următoare) — până atunci se completează de admin prin SQL, cu preview → confirmare. Fără ele convocatorul e blocat
   (`motivBlocareConvocator` spune exact ce lipsește).
2. **Import TGZ** (tabul „📥 Import TGZ”, admin/editor): se alege fișierul „Raport Informații Generale Terenuri” (xlsx, antet pe rândul 3), se
   scrie versiunea listei (ex. „TGZ 13.07.2026”), sursa (TGZ / ANEXA7 — parserul Anexa 7 nu există încă) și tronsonul per UAT. Previzualizarea
   arată parcele, deținători, dubluri, neidentificați și rândurile care NU se importă: **fără cheie** (fără poziție HG, cadastru și tarla —
   n-au identitate stabilă) și **ambigue** (aceeași identitate pe Nr.Crt. diferite sau identități contradictorii sub același Nr.Crt.) — pentru ele
   se completează poziția HG / nr. cadastral în Excel și se reimportă (Fișa poate adăuga deținători la o parcelă existentă, nu parcele noi). Commit-ul rezervă
   numerele de parcelă prin `fn_red_rezerva_numere_parcele`, scrie parcele → deținători → contact în loturi de 200, deschide/închide lotul în
   `red_import_loturi`; un reimport al aceluiași fișier cade pe parcelele existente (`cheie_sursa`) și completează ce lipsește.
3. **Registru** (tabul „📋 Registru”): o linie per parcelă × deținător din `red_v_stare_parcela`, filtre UAT / tronson / stare, căutare, STAREA
   colorată. Acțiuni pe rând (admin/editor): **Convocator** (rezervă `C-nnnn`, generează DOCX din `convocator.docx` cu link + QR unic, îl
   încarcă în bucket, descarcă), **Expediat** (dată + AWB), **AR primit / Retur** (motiv + dată), **Răspuns telefonic** (opțiune, zi, obiecții;
   metadatele în `red_raspunsuri_meta`; „particip” alege ziua doar dintre zilele UAT-ului). Deținătorii neidentificați sau fără adresă nu primesc
   convocator (convocarea lor e prin afișare la Primărie).
4. **Fișa parcelei** (din Registru): date, deținători (+ contact pentru admin/editor), cronologia, fișierele (link semnat 10 minute), „↻ Reîncarcă”
   pentru un convocator cu fișier lipsă sau de regenerat (versiune nouă `-v{n}`), adăugare/editare deținător, soft delete cu motiv.
5. **Borderou Poștă** (Registru, „📮 Borderou CSV”): CSV UTF-8 cu BOM, separator `;`, coloane `nr_document;nume;adresa;cod_postal;localitate;judet;id_parcela`,
   un rând per convocare poștală neexpediată cu fișier și adresă cunoscută; rândurile excluse sunt listate cu motivul.
6. **Formularul public** `/redari/raspuns/{token}` (din QR / link): afișează parcela, UAT-ul, zilele de sesiune, textul GDPR și 4 opțiuni —
   particip (+ ziua), nu particip fără obiecții (+ bifa declarației), nu particip cu obiecții (+ text), constatare pe teren (+ text). Salvează
   prin `fn_red_raspuns_public` (canal `online`); token invalid/expirat → același mesaj + contactul proiectului; al doilea răspuns pe același
   token e acceptat (istoricul rămâne, ultimul contează). Nu trimite nimic și nu generează PV (decizia 6).

## 4. Ce e făcut / Ce NU e făcut / Ce NU e testat

### 4.1 Făcut (felia minimă din brief §8, pașii 1–5)
- Migrarea `20261126a`: 14 tabele cu RLS + privilegii pe coloană, jurnal append-only, token în tabel separat, numerotare, legături coerente și
  imutabile, 4 vederi de stare, 2 RPC publice cu rate limit, bucket privat; revenire armată cu lock-uri; DRY TEST0–TEST9; harness PG17 local PASS.
- Import TGZ (parsare + previzualizare + commit în loturi + reluare), Registru + Fișa parcelei, convocatorul REAL (Model_1 v5, 36 placeholder-e)
  + borderou CSV, formularul public cu token, scrub Sentry pentru token.
- Șabloanele Model_1..5 v5 cu placeholder-e în repo (verificate, 0 rupte) și harta completă a câmpurilor (`SABLOANE.md`).

### 4.1b Faza 2, felia 1 — UAT + Setări proiect (branch `feat/redari-faza2-uat`, 02.11.2026)
Deciziile lui Răzvan (02.11, chat): ordinea = UAT + Setări întâi; `link_afisare` scos din adresa UAT; refuzul la PV B = motiv pe PV (felia PV);
adresele UAT pe seria `AU-0001`.
- Migrarea `20261127a_redari_uat_setari`: `red_uat` + `reprezentant_uat_telefon`, `termen_confirmare`, `afisare_ora`, `afisare_reprezentant_gazpet`,
  `adresa_nr` (unic, `AU-nnnn`), `adresa_data`; `red_proiecte.apm_nume`; CHECK-uri: zilele de sesiune în ordine (zi2 cere zi1, strict crescător),
  termenul de confirmare < ziua 1, afișarea ordonată, formate (ora, telefon); cheia `AU` în `fn_red_numar_document`. Fără politici sau drepturi noi.
  Blocare optimistă: coloana `versiune` pe `red_proiecte` / `red_uat`, crescută de `trg_red_versiune` la fiecare UPDATE; ecranele salvează cu
  `.eq('versiune', citită)` și, dacă alt admin a schimbat aceleași câmpuri, le arată și cer confirmare (review Copilot f2 r2).
  Ordinea revenirilor: întâi 20261127a, apoi (dacă e cazul) 20261126a.
  Revenire: `supabase/revenire/20261127a_redari_uat_setari_ROLLBACK.sql`; DRY: `supabase/tests/20261127a_redari_uat_setari_dryrun.sql` (10 teste,
  identități reale owner / editor / viewer, date fictive, ROLLBACK).
- Ecrane: **🏛️ UAT-uri** (tabel + „gata de convocare?”, editare admin, cod UAT blocat după primele parcele, avertisment la schimbarea zilelor când
  există convocați) și **⚙️ Setări proiect** (contract, împuternicire, reprezentanți, contact, texte GDPR / declarație cu confirmare la schimbare).
  Editor și viewer văd în citire (RLS: scrie doar admin). Logica: `src/redari/setari.js` (+ teste), randare: `src/redari/ui/setariRender.test.jsx`.

### 4.2 NU e făcut (faza următoare, după brief §8 „apoi”)
- PV A / B / C (generare din `pv_a` / `pv_b` / `pv_c.docx`, numerotare PVA/PVB/PVC, stările trimis/semnat, upload scan semnat) — doar schema există.
- Adresă UAT + convocare de afișare + PV de afișare (`adresa_uat.docx`), ecranul UAT (primărie, reprezentant, zile, program).
- Sesiune (mod tabletă), Dashboard (centralizator pe UAT), Setări proiect (contract, împuternicire, texte, șabloane).
- Import Anexa 7 (Model_7, antet pe rândul 5, 30 de coloane) — `red_import_loturi.sursa = 'ANEXA7'` există, parserul nu.
- Export registru xlsx (Model_6) și centralizator „fără date personale” pentru TGZ.
- Email (Gmail API `redari@gazpet.ro`), SMS (SMSLink), FAN Courier — niciun canal automat; totul manual (decizia 6).
- Repetarea rândurilor în DOCX (`{{rand.*}}`, funcția `repetaRand` în `docx.js`) — azi rămân literal în `adresa_uat.docx`.
- Câmpurile fără sursă din `SABLOANE.md` §3 (bifele stării terenului, verificarea pe teren, reluarea convocării, `semnatar_apm`, numerotarea
  adresei UAT, `link_afisare`, prezența la sesiune, refuzul nemotivat, `id_parcela` pe documente etc.) — de decis cu Juridic/Răzvan.
- Importul REAL al listei TGZ și acordarea rolurilor (vezi §5).

### 4.3 NU e testat
- Nimic în browser pe date reale: UI-ul a fost validat prin build + teste unitare pe date fictive; fluxul cap-coadă (import → convocator →
  expediat → răspuns online → stare) nu a rulat pe producție.
- RLS pe conturi reale non-owner (editor / viewer) — DRY-ul le simulează cu `SET LOCAL ROLE` + un cont fără modul; conturile reale apar abia după §5.
- Storage API pe prod: upload, refuzul suprascrierii (`upsert:false`), refuzul ștergerii, link semnat — TEST9 verifică doar metadatele din
  `storage.objects` (Jakarinos r3 P2-06), nu octeții prin API. Procedura manuală de după apply (cont editor + viewer, fișier de test, 3 pași) e în
  `MIGRARE_20261126a.md` „Verificare manuală pe prod, prin Storage API”.
- Punctele Jakarinos r3 frontend (identități contradictorii, tokenul în payload codificat, contoare la scrieri parțiale, trimiterea în curs la
  schimbarea tokenului, paginarea în fișă/borderou, cursa UAT-urilor, „particip” fără sesiuni, fallback-ul Sentry, ID peste 4 cifre) sunt închise în
  cod (runda 4), dar neconfirmate încă de review-ul r4.
- Performanța `red_v_stare_parcela` pe 2.728 parcele × deținători (LATERAL-uri + o funcție per rând) și importul sub 1 minut — de măsurat după import.
- Formatul `x-forwarded-for` la gateway-ul Supabase: dacă antetul e influențabil de client, limita 30/IP e orientativă, limita reală e la gateway
  (Copilot r3 P2-01); fără antet cheia e `ip:necunoscut`.
- Concurența reală (două sesiuni) pe `fn_red_numar_document` / `fn_red_rezerva_numere_parcele` — doar raționament (UPDATE sub lock de rând).

## 5. Ce așteaptă „da”-ul lui Răzvan (pct. 3 și 10 din CLAUDE.md — nu se fac din tichet, poke sau brief)
1. **Aplicarea migrării `20261126a`** pe producție — după GO Jakarinos + Copilot pe r4 și DRY verde pe prod (regula #1877, decizia 2A).
2. **Acordarea rolurilor** în `user_module_access` (modul `redari`), exact lista din brief §2 RLS: admin = Răzvan (owner, implicit) + Răzvan Toma;
   editor = Ramona Brehui, Cristina D., Cristiana P.; viewer = Pantea, Marilena, Mirela. Niciun drept nu se acordă fără acordul lui explicit.
3. **Importul real** al listei TGZ („Raport Informații Generale Terenuri”, 13.07.2026) — date personale reale; preview → confirmare → commit.
4. **Crearea adresei `redari@gazpet.ro`** (Workspace) — azi e doar valoarea implicită a `red_proiecte.contact_email`.
5. **Confirmarea textului GDPR** (rolurile operator/împuternicit) de către avocat și Transgaz prin împuternicire; textul e parametru editabil
   (`red_proiecte.text_gdpr`), nu hardcodat; la fel `text_declaratie`.
6. Completarea datelor proiectului și a zilelor de sesiune pe UAT (SQL de admin, până apare ecranul Setări/UAT).

## 6. Cum se revine
- Migrarea e aplicată (01.11.2026); nu a atins niciun obiect existent (în afară de un rând în `app_modules` și 2 politici pe
  `storage.objects`, create de ea).
- **Revenire**: `supabase/revenire/20261126a_redari_teren_ROLLBACK.sql`, într-o singură tranzacție, ca `postgres`, armată cu
  `set_config('gazpet.revenire_20261126a', 'REDARI_TEREN_SCOASA:' || txid_current(), true)`. Ia ÎNTÂI lock-uri ACCESS EXCLUSIVE pe cele 14 tabele
  + SHARE ROW EXCLUSIVE pe `user_module_access` (fereastră de mentenanță; `lock_timeout` 5 s → dacă pică, nu face nimic). **Refuză** dacă: nu e
  armată; armarea e persistentă; migrarea nu e aplicată; bucket-ul `redari` are obiecte (se golește prin API întâi, cu decizia lui Răzvan);
  există DATE în oricare tabel de business sau în jurnal, ori drepturi `redari` în `user_module_access` — fără al doilea GUC
  `gazpet.revenire_20261126a_forta = 'DA'` (care PIERDE datele și scoate drepturile în cascadă; doar cu decizia explicită a lui Răzvan).
- Fișierele din bucket nu se șterg de nimeni prin politici; o convocare greșită = `stare = 'anulat'` + motiv, numărul rămâne consumat.
- Frontend: `revert` al commit-urilor de pe branch / PR; ruta `/redari` e lazy și cere modulul, deci fără drepturi acordate nimeni nu o vede.
