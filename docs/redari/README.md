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

### 4.1b Faza 2, felia 1 — UAT + Setări proiect (PR #918, 02.11.2026)
Deciziile lui Răzvan (02.11, chat): ordinea = UAT + Setări întâi; `link_afisare` scos din adresa UAT; refuzul la PV B = motiv pe PV (felia PV);
adresele UAT pe seria `AU-0001`.
- Migrarea `20261127a_redari_uat_setari` (**APLICATĂ pe prod 02.11 ~08:15**, regula #1877: Jakarinos r4 GO, Copilot r4 GO cu observații, DRY de poartă verde): `red_uat` + `reprezentant_uat_telefon`, `termen_confirmare`, `afisare_ora`, `afisare_reprezentant_gazpet`,
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
- P3 Copilot r4 („UAT nou” editabil cât inserează) este reparat în felia 2, §4.1c.

### 4.1c Faza 2, felia 2 — adresă UAT + legătură Execuție (02.11.2026)
- **Migrarea 20261128a APLICATĂ pe prod 02.11 ~12:30** (regula #1877: Copilot r4 GO, Gemini r3 GO, DRY de poartă 7/7 pe commit fixat). Revenire: `supabase/revenire/20261128a_redari_legatura_executie_ROLLBACK.sql`.
- Numerotarea adresei UAT: `fn_red_adresa_uat_rezerva` rezervă numărul și îl scrie pe UAT atomic, înaintea generării; eșecul de upload lasă numărul pe UAT (reluare cu „Regenerează”, versiune nouă în bucket). Preluarea contractului din Execuție păstrează data din sufixul „nr/zz.ll.aaaa” când `data_contract` lipsește și semnalează nepotrivirea (review Copilot r1).
- Migrarea pregătită `20261128a_redari_legatura_executie`: două coloane nullable, FK către montaj, unicitate parțială,
  CHECK HTTPS/300, amprenta politicilor în pre/post; revenire armată cu lock înaintea gărzii de date; DRY owner/editor/viewer,
  proiecte fictive, montaj existent numai citit, SQLSTATE-uri exacte, CAS/versiune, ROLLBACK final. **Nu a fost rulată aici.**
- Model 4: `repetaRand`, verificări separate pentru adresă (împuternicire obligatorie), 43 de chei comparate cu șablonul real,
  zero parcele acceptat, active ordonate; `link_afisare` scos prin script, fără alte modificări de text.
- Modal UAT, admin: generează AU → upload versionat imutabil → UPDATE cu CAS → descărcare; regenerarea confirmată păstrează AU;
  descărcarea existentului folosește URL semnat și versiunea maximă. Conflictul lasă fișierul în bucket. Numărul rezervat poate rămâne consumat.
- Setări: legătură montaj și preluare contract doar în formular, cu salvare explicită; link GDPR opțional HTTPS.
  Execuție are butonul spre proiectul Redări vizibil prin RLS; `/redari?proiect=UUID` selectează proiectul o singură dată.
- P3 #918 închis: „UAT nou” blochează nume/cod/județ și ignoră tastarea cât inserează; acțiunile noi ignoră răspunsurile după unmount.
- Verificări și limitări: `RAPORT_20261128a.md`. Nu s-au verificat BD/PostgREST/RLS/Storage reale, concurența între sesiuni,
  aspectul în Word sau browserul pe conturi reale. Cererea către TGZ, PV, Sesiune, Dashboard, Anexa 7, xlsx, e-mail/SMS rămân în afara feliei.

### 4.1d Faza 2, felia 3a - cerere de imputernicire (02.11.2026)

Facut: cerere DOCX ca anexa la scrisoarea TGZ, exclusiv descarcare locala din Setari proiect pentru admin.
DRAFT Juridic, de validat de avocat. Numar optional (`___` daca lipseste), data Europe/Bucharest,
12 campuri, UAT-uri sortate romaneste. Lipsurile si modificarile nesalvate blocheaza generarea.
Generatorul verifica aceleasi lipsuri ca UI; garda ocupat precede primul await; tokenul si id-ul proiectului
opresc descarcarea/toasturile vechi. Nicio trimitere automata.

Fisiere atinse:
- `src/redari/docx.js`: constanta Antreprenor/lider, chei, validare si generare cu hash pe continut.
- `src/redari/docx.test.js`: fiecare camp lipsa/null/spatii, UAT lipsa, sablon real, text integral,
  chei, relatii externe, generare, numar optional si sortare fara mutarea listei.
- `src/redari/ui/SetariProiect.jsx`: sectiunea admin, numar optional, blocari, fetch si descarcare.
- `src/redari/ui/setariRender.test.jsx`: vizibilitate admin/editor/viewer, lipsuri, modificari nesalvate,
  dublu click si unmount in timpul fetch.
- `src/Redari.jsx`: exclusiv prop-ul `uats={uats}` la montarea SetariProiect.
- `public/redari/sabloane/cerere_imputernicire.docx`: sablon nou, A4, Times New Roman 12.
- `scripts/redari_sablon_cerere_imputernicire.mjs`: generare idempotenta din text, date ZIP fixe.
- `docs/redari/TEXT_CERERE_IMPUTERNICIRE.md`: copie identica a sursei Juridic.
- `docs/redari/SABLOANE.md` si acest README: mapare 2.6 si raportul feliei.

Verificari efectuate si limite:
- In acest worktree NU exista `node_modules`. Nu s-au instalat dependinte si nu s-au creat fisiere temporare.
- `node scripts/redari_sablon_cerere_imputernicire.mjs` si
  `node scripts/redari_sabloane_verifica.mjs`: exit 1, `ERR_MODULE_NOT_FOUND: Cannot find package 'jszip'`.
- DOCX-ul a fost totusi produs din XML-ul scriptului: executie in memorie cu un colector de intrari
  in loc de JSZip, apoi arhivare ZIP .NET. Scriptul salvat ramane cel cu node + jszip.
- Verificare alternativa XML .NET: toate partile XML valide, textul paragrafelor identic cu sursa,
  12 chei distincte, fiecare placeholder intreg intr-un singur run, zero relatii externe.
- Logica verificatorului existent a fost executata in memorie cu citire ZIP .NET in loc de JSZip,
  fara modificarea fisierului verificatorului: exit 0, toate cele 6 sabloane OK.
  Iesire relevanta: `cerere_imputernicire.docx - OK`; 16 paragrafe; 12 placeholder-e distincte,
  15 aparitii; 0 rupte intre run-uri; relatii externe: niciuna.
- Comanda ceruta: `npx vitest run src/redari/docx.test.js src/redari/setari.test.js` nu a pornit:
  PowerShell blocheaza npx.ps1. Incercarea prin npx.cmd, offline si --no-install, s-a oprit in npm
  cu `uv_os_homedir returned ENOMEM`, exit 1. **Niciun rezultat vitest PASS nu este declarat.**
- `setariRender.test.jsx` a fost extins, dar nu a fost rulat: brief-ul autorizeaza exclusiv cele doua
  fisiere vitest de mai sus. Claude trebuie sa ruleze si testele UI la verificare.
- Nu s-au verificat integrarea jszip reala, aspectul in Word/LibreOffice, descarcarea in browser,
  UI pe conturi reale sau build-ul Vite (il face Claude). Fara Git/commit/push, BD, deploy sau secrete.

Reguli L01-L25 (dovezile de test de mai jos sunt scrise, dar vitest NU a putut fi rulat):

| Regula | Respectare / dovada |
|---|---|
| L01 | `SetariProiect.jsx`, genereazaCererea: ocupat sincron inainte de primul await; test dublu click in setariRender.test.jsx. Fara UPDATE nou. |
| L02 | n/a |
| L03 | `SetariProiect.jsx`: token + proiectCurent verificate dupa fiecare await, inainte de descarcare/toast. |
| L04 | Scriptul rescrie acelasi sablon, date ZIP fixe; operatia UI doar descarca, fara bani/mail/cantitati. |
| L05 | n/a |
| L06 | n/a |
| L07 | n/a - generare locala din date deja accesibile, fara operatii server sau drepturi noi. |
| L08 | n/a |
| L09 | n/a |
| L10 | n/a - fara secrete sau loguri de date personale introduse. |
| L11 | n/a |
| L12 | Scriptul refuza structura sursa necunoscuta/numar diferit de 12 chei; testul compara fiecare paragraf cu textul sursa. Verificarea alternativa a trecut. |
| L13 | Scriptul separa pe delimitatoare ancorate, valideaza sectiunea finala si antetul; escapare XML explicita. |
| L14 | n/a |
| L15 | n/a |
| L16 | `docx.js`: reutilizeaza hashBlob pe continutul DOCX. Fara deduplicare sau unicitate BD noua. |
| L17 | `genereazaCerereImputernicire`: aziBucuresti si formatDataRo existente; teste de data explicita si regresii de fus orar existente in docx.test.js. |
| L18 | Lipsurile blocheaza si in generator; fetch verifica ok, eroarea produce toast; fara succes la eroare sau rezultat vechi. |
| L19 | verificaDateCerereImputernicire este apelata identic din UI si generator; nu exista reguli JS/SQL noi. |
| L20 | docx.test.js: fiecare camp null/gol/spatii, UAT lipsa si succes cu numar optional; setariRender.test.jsx: admin/editor/viewer si formular modificat. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a - foloseste lista uats deja citita in parinte, fara query nou. |
| L24 | SetariProiect.jsx: generatie + id proiect, reset la schimbarea proiectului, cleanup la unmount; test fetch rezolvat dupa unmount. |
| L25 | Asteptari explicite pe fixture-uri fictive si textul Juridic/sablonul real; verificari XML efective. Testele vitest sunt nerulate din motivele de mai sus. |

### 4.1e Faza 2, felia 3b - parser Anexa 7 (02.11.2026)
- Facut: parser separat, antet dupa continut, 30 de coloane, identitate prin helperul TGZ, gruparea coproprietarilor,
  note pentru contradictii, contacte pe coloane, calitati, decedat in preview, sursa/versiune si statistici compatibile.
  Selectorul Sursa alege parserul; importul primeste ANEXA7. TGZ are numai trei exporturi de helperi in plus, fara schimbari de logica.
- NU: schema/RPC/scriere modificate, actualizari pe persoane existente, import real, Git, instalari, deploy.
  Limita: scrieImport nu persista booleanul decedat; informatia se pastreaza textual in sursa_date (CONTRACT_SCHEMA sectiunea 7).
- NETESTAT: Vitest (node_modules lipseste), build (il face Claude), browser, PostgREST/BD si importul real.

Raport felia 3b (in acest fisier, fara raport suplimentar in afara listei permise):
- Fisiere atinse: `src/redari/importAnexa7.js`, `src/redari/importAnexa7.test.js` (noi), `src/redari/importTgz.js`
  (export cheie/text/numar), `src/redari/ui/ImportTgz.jsx` (selectie parser, eticheta/ajutor si judet UAT),
  `docs/redari/CONTRACT_SCHEMA.md`, `docs/redari/README.md`.
- Teste scrise: 8 cazuri Vitest; antet citit din Model 7 real, fixture fictiv cu 8 randuri, verificari pe numere, contacte,
  coproprietari/mostenitor/neidentificat, deduplicare, contradictii, cheie incompleta/completa, antet mutat sau invalid,
  tronson invalid, calitate necunoscuta si paritate cu CALITATI din UI.
- Iesirea Vitest: **nu a fost rulat**, dependentele lipsesc din worktree; nu s-a incercat instalarea.
  XML-ul randului 5 al XLSX a fost citit cu .NET ZipFile: toate cele 30 de antete corespund maparii.
  `node --check` pentru importAnexa7.js, importAnexa7.test.js si importTgz.js: exit 0, fara output.
  Node a fost apelat prin calea absoluta din Program Files (nu este in PATH). Date externe tratate exclusiv ca date.

Reguli L01-L25 (lectiile citite inaintea implementarii):

| Regula | Cum a fost respectata / n/a |
| --- | --- |
| L01 | n/a - fara scrieri sau lock-uri noi |
| L02 | n/a - scrieImport si RPC-urile nemodificate |
| L03 | n/a - fara cache sau rezultate derivate persistate |
| L04 | n/a - fara intentii de scriere noi |
| L05 | n/a - fara operatii de retea noi |
| L06 | n/a - fara lock-uri |
| L07 | n/a - fara modificari de acces/schema |
| L08 | n/a - fara autentificare/provenienta server modificata |
| L09 | n/a - fara DEFINER/edge/service_role |
| L10 | Fixture exclusiv fictiv in importAnexa7.test.js; fara secrete, erori de citire Excel generice |
| L11 | ANTETE si maparea din importAnexa7.js cer o coloana unica; Sat distinct prin pozitie; testul antetului mutat/ambiguu |
| L12 | Erori pe rand, dubluri raportate cu continut pastrat, fara_cheie separate, contradictii in observatii; testele de fixture si deduplicare |
| L13 | Coloana inexistenta/ambigua opreste parsarea; suprafata invalida/tronson invalid dau erori; teste pozitive si negative |
| L14 | n/a - fara migrari |
| L15 | n/a - fara schema |
| L16 | Cheia completa foloseste cheieSursa TGZ, deduplicarea parcela+nume ca scrierea existenta; test HG identic cu cadastru diferit; fara unicitate BD noua |
| L17 | Helper numeric TGZ exportat, nu duplicat; 12,5 / 12.25 / 7.25 si ambiguitatea 1.234 in teste; data actualizarii ramane nota, fara conversii de fus |
| L18 | Suprafata invalida nu devine zero/null tacit; antet invalid, nume gol, UAT necunoscut si tronson invalid raportate explicit in teste |
| L19 | cheieSursa, cheie, text, numar si normalizeazaNume reutilizate; lista calitatilor are test de paritate cu comune.jsx |
| L20 | Cale valida si exceptii in importAnexa7.test.js; test neidentificat=DA versus NU si calitate necunoscuta |
| L21 | n/a - fara AI |
| L22 | n/a - fara AI/costuri |
| L23 | n/a - fara citiri paginabile noi |
| L24 | n/a - parser sincron; ciclul async existent al UI nu a fost extins |
| L25 | Antet independent din XLSX real, expected explicite si date fictive; testele sunt scrise, NU declarate trecute; fara BD/RLS in aceasta felie |
### 4.1f Faza 2, felia 4a - schema PV A/B/C (02.11.2026)

Pregatit, NEAPLICAT: 20261129a_redari_pv_schema; 18 coloane, 6 CHECK-uri PV,
FK responsabil UAT, index unic pentru reluarea activa. Fara DML in migrare sau politici/RLS noi.
Vederea primeste cele 4 coloane ale comisiei la final, cu GRANT explicit pe coloanele parcelei;
valoare_lei ramane exclusa. Revenire armata cu lock inainte de verificarea datelor si GUC de forta.
Generarea PV si UI-ul raman pentru felia urmatoare.

Fisiere:
- supabase/migrations/20261129a_redari_pv_schema.sql
- supabase/revenire/20261129a_redari_pv_schema_ROLLBACK.sql
- supabase/tests/20261129a_redari_pv_schema_dryrun.sql
- src/redari/importTgz.js: numai obiectul INSERT din scrieImport, decedat si act_doveditor_cunoscut.
- src/redari/importAnexa7.js: mapare conditionala autorizata de brief, col.12 DA/NU/NULL;
  completeaza lipsa pe dublura; valorile nerecunoscute si contradictiile raman in note.
- src/redari/importScriere.test.js si src/redari/importAnexa7.test.js.
- docs/redari/CONTRACT_SCHEMA.md, SABLOANE.md sectiunea 3 si acest raport.

Teste SCRISE, NERULATE: DRY TEST0-5 (identitati reale, date fictive, SQLSTATE exact,
editor/viewer ca authenticated, vedere, reluare/anulare, FK si jurnal), mock INSERT pentru
true/false/lipsa decedat si true/false/NULL act; parser DA/NU/gol/valoare necunoscuta/dublura.
Verificare efectuata: citirea codului si control static ASCII/BOM pe fisierele noi.
Nu s-au rulat npm/npx/node/vitest, nu s-au instalat pachete. Claude ruleaza testele,
DRY si apply -> revenire -> re-apply pe Postgres real. Nicio validare BD/PostgREST,
RLS real, concurenta in doua sesiuni sau deploy efectuata. Fara Git/commit/push/secrete.

Lectii L01-L25 (referintele de mai jos sunt la cod/teste scrise, nu rezultate PASS):

| Regula | Respectare / n/a |
| --- | --- |
| L01 | Migrare/revenire: lock inainte de verificarea datelor; index UNIQUE pentru reluari concurente. |
| L02 | DDL si pre/post in tranzactia unica a runner-ului; scrieImport pastreaza fluxul existent, fara pasi noi. |
| L03 | n/a |
| L04 | n/a |
| L05 | n/a - nu se schimba tratarea retelei/importului existent. |
| L06 | Ordinea red_uat, red_parcele, red_detinatori, red_convocari, red_procese_verbale documentata identic in apply/revenire. |
| L07 | CHECK/FK/UNIQUE in BD; GRANT numai pe cele 4 coloane; DRY TEST2 editor/viewer si refuz valoare_lei. |
| L08 | Nu se adauga functii de autentificare; TEST0 foloseste identitati reale, JWT/SET LOCAL ROLE doar in harness pg_temp. |
| L09 | n/a - fara DEFINER/edge nou. |
| L10 | Date fictive in toate fixture-urile, fara acte de identitate sau secrete. |
| L11 | importAnexa7.js: col.12 identificata prin antet existent unic; numai token complet DA/NU. |
| L12 | Act necunoscut ramane NULL si in note; dublura pastreaza continutul in sursa_date. |
| L13 | Test parser DA/NU pozitiv si DA partial negativ; fara regex nou. |
| L14 | Preflight sub lock, pre/post, garda tranzactiei; revenire refuza date/istoric nou fara forta, fara CASCADE; ciclul real NERULAT. |
| L15 | Amprenta baseline a celor 15 politici in pre/post; vedere optiuni/owner/ACL comparate; nu se modifica functii/triggere. |
| L16 | red_convocari_reluare_uq pe detinator_id NOT NULL si predicatul exact al randurilor vii; DRY TEST3. |
| L17 | n/a - date explicite in fixture-uri, fara conversii numerice/temporale noi. |
| L18 | Coloane nullable fara default ascuns (exceptia reluare ceruta); act necunoscut NULL, false pastrat prin ??; garzi IS DISTINCT FROM. |
| L19 | Nu se introduce pereche JS/SQL de reguli; parserul foloseste normalizarea existenta. |
| L20 | DRY cai valide/invalide, anulare si convocari obisnuite multiple; teste import false/NULL si compatibilitate TGZ. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a - citirile existente paginabile nu se modifica. |
| L24 | n/a - fara flux UI nou. |
| L25 | Antet din XLSX real in testul parserului, asteptari explicite; DRY authenticated non-owner si FK/CHECK reale; executia delegata lui Claude, NERULATA aici. |

### 4.1g Faza 2, felia 4b - PV A per detinator (02.11.2026)

Pregatit, NEAPLICAT: migrare 20261129b_redari_pv_creare (versiune 20261129120100),
revenire armata, DRY, pv.js/pv.test.js, ModalPv.jsx; FisaParcela numai import, buton si montare.
SABLOANE 2.2 descrie cele 54 de chei, bifele Unicode prin escape JS si confirmarea propunerii.
RPC A/B: parcela FOR UPDATE, detinator FOR UPDATE pentru A, numar+INSERT atomic;
C refuzat cu mesajul felia 4e. Indexurile partiale red_pv_a_activ_uq/red_pv_b_activ_uq
impun unicitatea si pentru INSERT/UPDATE direct, nu numai prin RPC. Politicile raman intacte.
Revenirea elimina numai functia/indexurile si evidenta versiunii, pastrand toate PV-urile.

Formular cu drepturi admin/editor, viewer citire, CAS created_at + valorile vechi ale
cheilor modificate, NULL prin is(). PV si comisia parcelei au butoane separate de salvare
pentru a evita un succes aparent atomic intre doua randuri. Nesalvatele blocheaza generarea.
DOCX: cinci surse proaspete, confirmare la schimbare, upload imutabil versionat, reverificare
surse dupa upload si dupa CAS al caii, un mesaj final. Nicio tranzitie de stare sau trimitere.
Reconcilierea crearii dupa eroare citeste PV-ul existent; nu repeta automat RPC-ul.

Verificat efectiv: citire lectii/model/schema, extractie XML din pv_a.docx prin .NET
(54 chei distincte), compararea statica a multimii cu CHEI_PV_A, control ASCII/BOM pentru
fisierele noi. Fisierele existente isi pastreaza diacriticele; toate adaugarile sunt ASCII.
Teste SCRISE, NERULATE: pv.test.js (chei reale, 8 texte deviz, fiecare lipsa, generare reala,
bife, XML/newline, cale, coliziuni, eroare ambigua); DRY cu identitati reale owner/editor/viewer,
SET LOCAL ROLE authenticated/anon, fixture-uri fictive, numere, duplicate, FK, jurnal.
Nu s-au rulat npm/npx/node/vitest, DRY, build, Postgres, PostgREST, Storage sau browser.
Claude trebuie sa verifice apply -> revenire -> re-apply si concurenta in doua sesiuni.
Fara Git/commit/push, credentale, BD sau deploy. Nu s-au creat fisiere in afara listei.

Limite: citirile multiple din browser nu formeaza un snapshot tranzactional; verificarile
detecteaza modificari observabile, nu garanteaza absenta unei schimbari imediat dupa ultima
citire. Nu se pretinde atomicitate intre Storage si BD. Fisierul imutabil ramane in bucket
la conflict/eroare de legare; se reincarca starea inainte de reluare. Teste React noi nu au
fost adaugate: lista de fisiere permite numai pv.test.js; fluxul UI necesita review/browser.

| Regula | Respectare / dovada (testele sunt scrise, nu PASS) |
| --- | --- |
| L01 | fn_red_pv_creeaza: lock parcela inainte de duplicate; ModalPv cas(): created_at + valori vechi + select, zero randuri conflict. |
| L02 | Numar si INSERT in acelasi RPC; jurnal trigger existent; salvarea comisiei este actiune distincta, explicit etichetata. |
| L03 | ModalPv genereaza: surse proaspete, verificare dupa upload, CAS continut PV si cale, verificare finala; limita snapshot documentata. |
| L04 | n/a - brief cere refuz explicit la al doilea apel, fara cantitati/bani/mail; duplicatele sunt serialize sub lock. |
| L05 | ModalPv creeaza reciteste dupa eroare; salveazaPv nu reincearca 5xx; obiectele nu se sterg la eroare. |
| L06 | RPC: comentariu parcela -> detinator -> contor; migrare/revenire: lock red_procese_verbale. |
| L07 | RPC verifica nivel pe server; indexurile partiale acopera si scriere directa; RLS/triggerele existente nu se modifica. |
| L08 | RPC refuza auth.uid NULL si foloseste fn_red_nivel; GUC JWT numai in harness pg_temp existent ca model. |
| L09 | Modul redari verificat server-side prin fn_red_nivel (acces global pe modul); detinator/parcela/UAT/proiect corelate explicit. |
| L10 | Fara acte/secrete noi; act_identitate/act_doveditor goale; fixture fictiv. |
| L11 | n/a - devizul produce numai propuneri etichetate, nu dovezi automate. |
| L12 | CHEI_PV_A comparat cu cele 54 chei independente din DOCX; completeazaDocx strict refuza necunoscute. |
| L13 | Cale validata prin caleAdresaUat; teste segmente invalide; listarea reutilizeaza regex ancorat din docx.js. |
| L14 | Runner tranzactie unica + garda pre/post; indexurile valideaza datele sub lock; revenire pastreaza datele; ciclul real NERULAT. |
| L15 | Amprenta politici calculata in pre si comparata in post; secdef/search_path/ACL verificate; nu se pretinde audit tranzitiv nou. |
| L16 | Doua indexuri UNIQUE partiale pe cheia completa a PV activ; hashBlob pe continut; test hash si duplicate DRY. |
| L17 | Data SQL Europe/Bucharest; formatDataRo/formatNumarRo existente; fara conversie Date din YYYY-MM-DD. |
| L18 | Erori citire/listare separate de gol; NULL plan/foto nu devine NU; true explicit pentru bife; 0 randuri CAS = conflict. |
| L19 | calePv reutilizeaza validarea existenta; salveazaPv reutilizeaza versiuneMaximaInBucket; validator comun UI/generator. |
| L20 | pv.test.js cai valide/invalide, strict, NULL/false; DRY admin/editor succes si viewer/anon/FK/duplicat/C refuz. |
| L21 | n/a |
| L22 | n/a |
| L23 | Query PV filtrat pe cheia exacta cu maybeSingle (duplicatele dau eroare); Storage listat pana la pagina goala prin helper existent. |
| L24 | ModalPv generatie useRef + cleanup + key parcela/detinator/proiect; ocupat sincron inainte de await; updatere tolerante la null. |
| L25 | Sablon real si expected explicite; DRY rol authenticated/anon si CHECK/FK reale; runtime/concurenta/React neexecutate, declarate ca limite. |

### 4.2 NU e făcut (faza următoare, după brief §8 „apoi”)
- PV A / B / C (generare din `pv_a` / `pv_b` / `pv_c.docx`, numerotare PVA/PVB/PVC, stările trimis/semnat, upload scan semnat) — doar schema există.
- Evidența ulterioară a afișării și semnării PV de afișare; documentul Model 4 se generează în 4.1c.
- Sesiune (mod tabletă), Dashboard (centralizator pe UAT), configurarea șabloanelor.
- Validarea in browser si importul real Anexa 7 (parserul si selectia sursei sunt implementate in 4.1e).
- Export registru xlsx (Model_6) și centralizator „fără date personale” pentru TGZ.
- Email (Gmail API `redari@gazpet.ro`), SMS (SMSLink), FAN Courier — niciun canal automat; totul manual (decizia 6).
- Câmpurile fără sursă din `SABLOANE.md` §3 (bifele stării terenului, verificarea pe teren, reluarea convocării, `semnatar_apm`, numerotarea
  prezența la sesiune, refuzul nemotivat, `id_parcela` pe documente etc.) — de decis cu Juridic/Răzvan.
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

### 4.1h Faza 2, felia 4c - PV B si starile PV A/B

Pregatit, NEAPLICAT: 20261129c_redari_pv_stari.sql (20261129120200),
supabase/revenire/20261129c_redari_pv_stari_ROLLBACK.sql si
supabase/tests/20261129c_redari_pv_stari_dryrun.sql. Runner-ul asigura tranzactia unica.
Apply: gazpet.livrare_migrare = 20261129c_redari_pv_stari:<txid>.
Revenire: gazpet.revenire_20261129c = REDARI_PV_STARI_SCOASA:<txid>.
Revenirea elimina triggerul/functia si versiunea, pastrand datele si istoricul.

Fisiere: pv.js (constructor comun A/B, 77 chei B, validare si upload scan),
pv.test.js (sablon real, lipsuri, situatii, reluare, scan), ModalPv.jsx
(citire proaspata, motiv B, tranzitii CAS), FisaParcela.jsx (buton/montare B),
SABLOANE.md 2.3 (surse finale), CONTRACT_SCHEMA.md (tranzitii).

Admin/editor: trimitere cu data, scan PDF/JPEG/PNG <=25 MB, anulare cu motiv
si confirmare. Scan imutabil: {cod}/{uat3}/pv/{nrPv}_semnat_v{n}.{ext}.
Versiunea maxima include toate extensiile acceptate si fisierele orfane.
Semnat/anulat: formular read-only, exceptie remediat_la. Erori 23514 vizibile.

Raport L01-L25:

| Regula | Dovada / limita |
| --- | --- |
| L01 | ModalPv: salveaza/tranzitie/genereaza au CAS pe id, created_at, stare si valorile citite; select('*') + exact un rand. Crearea reutilizeaza RPC 4b. |
| L02 | Stare + scan path + data + bife intr-un UPDATE; upload anterior, fara stergere automata. |
| L03 | genereaza reciteste sursele inainte/dupa upload si dupa legare; token de generatie; CAS. Nu exista snapshot atomic peste tabele; modificarea surselor intre ultima citire si UPDATE ramane detectabila ulterior, nu exclusa. |
| L04 | n/a - fara bani/cantitati/mail; numerotare existenta in RPC 4b. |
| L05 | salveazaPv reincearca numai 409; scanurile orfane raman; legare neconfirmata cere reincarcare. |
| L06 | Trigger fara lock-uri pe alte tabele; ordinea RPC existenta nu se modifica. |
| L07 | Tranzitii/continut final in BEFORE UPDATE, inclusiv PATCH direct. Motiv/verificare teren si absenta A semnat la generarea B sunt validate in generator/UI; nu sunt o poarta atomica intre tabele in BD in aceasta felie. |
| L08 | Trigger INVOKER, fara identitate furnizata de client sau drepturi noi; GUC de armare numai in migrare/revenire. |
| L09 | n/a - fara DEFINER/edge nou; RLS si RPC existente pastrate. |
| L10 | n/a - fara secrete sau integrare noua. |
| L11 | n/a - fara extragere de dovezi. |
| L12 | Liste paginate pana la pagina goala, eroare la lista invalida; 77 chei comparate cu DOCX independent. |
| L13 | calePv valideaza segmentele prin helper existent; sufix scan ancorat; test pozitiv/negativ. |
| L14 | Runner tranzactie unica, lock preflight, postconditii; rollback armat elimina numai obiectele noi, fara pierdere de date. Apply/revenire/re-apply NERULATE. |
| L15 | Migrare: amprenta tuturor politicilor PV in pre/post, trigger tgfoid/tgenabled/tgtype, invoker/search_path. Fara schimbari RLS/ACL de tabel. |
| L16 | Indexurile de unicitate A/B din 4b sunt reutilizate; scanul nu introduce dedup semantic. |
| L17 | aziBucuresti existent pentru datele actiunilor; formatDataRo existent pentru DOCX. |
| L18 | Erorile citirilor/storage propagate, lipsa listei nu devine lista goala; trigger cu IS DISTINCT FROM si text nevid. |
| L19 | campuriComune/documentPv pentru A/B, ultimulRaspuns din stare.js, salveazaPv pentru DOCX si scan; bifele situatiei sunt motiv explicit, nu o copie a ierarhiei starii. |
| L20 | DRY include tranzitii legitime, lipsa datei/scanului/motivului, stari finale, remediere; pv.test.js include exceptii si succes. |
| L21 | n/a - fara AI. |
| L22 | n/a - fara apeluri platite. |
| L23 | ModalPv: citestePaginat keyset id pentru detinatori/convocari/raspunsuri/PV A semnate; storage pana la pagina goala, plafon explicit cu eroare. |
| L24 | ModalPv: generatie useRef, curent la aplicare si in bucle, reset la parcela/detinator/proiect/tip; ocupat/setLucru inainte de await. |
| L25 | pv.test.js compara cheile cu XML DOCX real, asteptari explicite; DRY fixture owner, actiuni authenticated editor non-owner. NERULATE. |

Verificat aici numai static: citirea XML-ului real pv_b.docx cu .NET, 77 chei;
inspectia schemei/grant-urilor/politicilor existente si controlul fisierelor UTF-8 fara BOM.
Nu s-au rulat npm/npx/vitest/node, DRY, build, Postgres, API real sau browser.
Claude trebuie sa ruleze regresiile A, testele B/scan, DRY, apply/revenire/re-apply,
build si fluxul PostgREST/Storage real. Nu exista rezultat runtime confirmat.
Nu s-au rulat Git, commit, push, acces la credentiale, BD sau deploy.

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

### 4.1i Faza 2, felia 4d - receptie pe tronson / PV C

Livrare locala, fara aplicare in BD. Tab nou Tronsoane / PV C: agregate paginate din
red_v_tronson, creare numai admin si fara parcele neacoperite; PV C existent se deschide.
ModalPv refoloseste CAS, scan verificat, recitire dupa upload si tranzitiile 4c.
Campuri C: data_pv, locul, alte_observatii; DOCX fara date de detinatori.

Fisiere: supabase/migrations/20261129d_redari_pv_c.sql,
supabase/revenire/20261129d_redari_pv_c_ROLLBACK.sql,
supabase/tests/20261129d_redari_pv_c_dryrun.sql; src/redari/pv.js, pv.test.js,
ui/ModalPv.jsx, ui/TronsoaneEcran.jsx; src/Redari.jsx (import, tab, montare);
SABLOANE.md 2.5 si CONTRACT_SCHEMA.md.

Raport L01-L25 (referintele sunt sectiuni/functii, teste scrise, NU rezultate executate):

| Regula | Aplicare / dovada |
|---|---|
| L01 | fn_red_pv_c_creeaza: advisory inainte de verificari; ModalPv: CAS existent |
| L02 | Numar + INSERT RETURNING in acelasi RPC |
| L03 | ModalPv.genereaza: surse recitite inainte/dupa upload si dupa CAS |
| L04 | n/a - nu exista cantitati mutate, bani sau mail; unicitatea intentiei C este proiect/tronson activ |
| L05 | TronsoaneEcran.deschide reciteste dupa RPC inclusiv la eroare; fara retry automat; upload-urile nu se sterg |
| L06 | Ordinea lock-urilor comentata in RPC; nu ia lock pe copii |
| L07 | red_pv_c_garda: admin pe scrieri C, INSERT direct refuzat; triggerul 4c pastrat |
| L08 | auth.uid() + fn_red_nivel(), fara identitate primita de client |
| L09 | Scope proiect prin red_uat, parcela din acelasi proiect; modul redari prin fn_red_nivel |
| L10 | n/a |
| L11 | CHEI_PV_C citite din DOCX real; test independent pe sablon |
| L12 | Keyset pana la pagina goala; erori afisate, nu liste goale de succes |
| L13 | n/a - fara parser/regex nou de productie |
| L14 | Runner obligatoriu o tranzactie; pre/post; revenire cu lock si refuz daca exista C |
| L15 | Pre/post: politici red_pv, proacl vechi, secdef/search_path/ACL nou; nu este audit tranzitiv complet |
| L16 | Unicitate scope proiect/tronson sub advisory; INSERT direct blocat; fara index UNIQUE cross-table |
| L17 | Europe/Bucharest in RPC; helper formatNumarRo existent |
| L18 | Erorile de citire sunt aruncate; mp invalid refuzat; NULL mp explicit zero |
| L19 | Clasificarea tip_pv vine din red_v_tronson; totaluriPvC comun generatorului |
| L20 | DRY: succes si refuzuri; pv.test.js: null, false, coproprietari, obiectii |
| L21 | n/a |
| L22 | n/a |
| L23 | TronsoaneEcran si ModalPv C: keyset pana la gol, IN in loturi de 100 |
| L24 | Generatie/useRef, invalidare la unmount/proiect; reload explicit dupa actiuni |
| L25 | Teste scrise cu sablon independent si roluri reale ca in DRY 4b; nu au fost executate |

Verificat local: citirea celor 23 de placeholder-e din ZIP/XML cu .NET; inspectie statica.
NU au fost rulate npm/npx/node/vitest, DRY SQL, build, PostgREST, Storage, concurenta cu doua sesiuni,
sau apply -> revenire -> reapply. Nu exista node_modules. Claude trebuie sa execute aceste verificari,
inclusiv regresiile 4b (asteptarea veche 'felia 4e' trebuie adaptata de harness) si 4c.
DRY cere identitati owner/editor/viewer existente si contor PVC-T5 nefolosit; nu modifica drepturi.
Testele se ruleaza numai in tranzactia de proba a migrarii, fara commit.
Limitele de concurenta si acces Storage viewer sunt descrise in CONTRACT_SCHEMA.md.
### 4.1j Faza 2, felia 5 - Sesiune tableta si Dashboard

Sesiune: select UAT si zi (implicit azi / urmatoarea / ultima), cautare fara
majuscule/diacritice, doar nesemnate, rezumat pe intreaga lista UAT, carduri
intr-o coloana, controale de minimum 44px si font 16px. Viewer citeste;
admin/editor pot marca Prezent si deschide PV A. Prezenta este pe detinator,
nu pe ziua selectata: azi inseamna ziua inregistrarii, ziua selectata este
zi_sesiune_aleasa. Fara zile configurate, Prezent este indisponibil.
ModalPv primeste dinSesiune: bifa Semnat la sesiune initial activa si sediu
propus numai in formular cand constatare_mod lipseste; operatorul salveaza.

Dashboard este primul tab; Registrul ramane ecranul initial existent.
Tronsoane / PV C este dupa Fisa parcelei. Dashboard este doar citire pentru
toate rolurile: UAT + TOTAL (perechi parcela/detinator), apoi tronsoane
(parcele). Totalul UAT nu aduna total_uat repetat; procentul TOTAL este
ponderat. Inchise = PV_A_SEMNAT + PV_B_CONSTATARE, conform vederii existente.
UAT-urile fara perechi nu sunt returnate de vedere si nu pot fi inventate
din acea sursa; sursa goala produce TOTAL zero. Testul acopera si UAT zero.

Surse: red_uat, red_v_stare_parcela, red_raspunsuri,
red_v_centralizator_uat, red_v_tronson; clientul Supabase existent, RLS existent.
Citiri keyset cu range(0,499) pana la pagina goala; prezente in loturi de 100
ID-uri. Centralizator: cursor compus (uat_id,stare); tronsoane: parcela_id;
sesiune: detinator_id; raspunsuri/UAT: id. Paginile scurte nu opresc citirea.
Diferenta fata de brief: schema din 20261126a, linia 213, declara data
TIMESTAMPTZ, nu DATE. Prezentele se citesc pe [miezul noptii local, urmatorul
miez local), Europe/Bucharest, fara offset fix; teste DST 23/25 ore.
Payload-ul randPrezenta pastreaza data: azi cerut de brief.

Nu exista trimiteri mail/SMS, migrari, modificari de schema/RPC/politici sau
biblioteci noi. INSERT-ul de prezenta este o singura scriere; recitire chiar
la eroare, fara retry automat. Daca recitirea esueaza, lista se invalideaza
si actiunile cer reincarcare. Nu exista unicitate noua: doi operatori pot
inregistra simultan raspunsuri de prezenta; UI previne dublul click local,
nu garanteaza unicitate globala. Nu este un snapshot tranzactional intre
pagini sau intre cele doua vederi ale Dashboard-ului.

Fisiere: src/redari/sesiune.js, sesiune.test.js,
src/redari/ui/SesiuneEcran.jsx, DashboardEcran.jsx,
ModalPv.jsx (doar comportamentul dinSesiune), src/Redari.jsx (taburi/montare),
docs/redari/README.md (aceasta sectiune si raport).

Raport L01-L25 (referinte la functii/teste; testele sunt SCRISE, NERULATE):

| Regula | Aplicare / dovada |
|---|---|
| L01 | SesiuneEcran.ListaSesiune.prezent: ocupat ref + setLucru inainte de await. Fara UPDATE nou; fara lock/garantie globala pentru prezenta. |
| L02 | prezent: un singur INSERT; recitirea nu este o a doua scriere de business. |
| L03 | SesiuneEcran si DashboardEcran: generatie curenta inainte de aplicarea rezultatelor; fara cache/derivat persistent nou. |
| L04 | n/a - fara bani, cantitati sau trimiteri. |
| L05 | prezent: recitire inclusiv la eroare/timeout, fara INSERT repetat; rezultat necunoscut afisat, reincarcare obligatorie daca reconcilierea esueaza. |
| L06 | n/a - fara lock/RPC nou. |
| L07 | SesiuneEcran: poateScrie admin/editor in randare si handler; query-uri prin clientul autentificat existent, vederi invoker/RLS existente, fara drepturi noi. Verificare RLS runtime nerulata. |
| L08 | randPrezenta nu trimite autor/created_by; identitatea ramane DEFAULT auth.uid() existent. |
| L09 | SesiuneEcran.citeste: proiect_id + uat_id; ID-urile de prezenta provin numai din vederea filtrata; Dashboard filtreaza ambele vederi pe proiect_id. |
| L10 | n/a - fara secrete, date de contact sau autentificare noua; erorile triggerului raman vizibile conform brief. |
| L11 | n/a - fara extragere de dovezi. |
| L12 | Ambele pagini: citire pana la gol, refuz lista invalida, invalidare afisaj la esec; nu se afiseaza partial ca succes. |
| L13 | sesiune.js normal: eliminare numai semne combinante Unicode; sesiune.test.js cazuri pozitive/negative de cautare. Fara parser extern. |
| L14 | n/a - fara migrari. |
| L15 | n/a - fara schema/politici/RPC modificate. |
| L16 | n/a - fara dedup/cheie noua; prezenta nu primeste garantie de unicitate globala. |
| L17 | aziBucuresti si formatDataRo existente; intervalZiBucuresti foloseste fusul IANA; teste explicite iarna, trecere vara si iarna. |
| L18 | pagini verifica error si Array.isArray inainte de gol; agregaCentralizator refuza numar invalid; eroarea vizibila nu devine zero rezultate. |
| L19 | sesiune.js pentru filtre/rezumat/agregari; etichete STARI/TagStare existente; tip_pv deja clasificat de red_v_tronson, fara recalculare in UI. |
| L20 | sesiune.test.js: zile lipsa/goluri, inainte/in/dupa interval, cautare cu si fara diacritice, semnat vs generat vs lipsa PV, impartire la zero, numar invalid. |
| L21 | n/a - fara AI. |
| L22 | n/a - fara apeluri platite. |
| L23 | SesiuneEcran.pagini si DashboardEcran.pagini: cursor unic simplu/compus, range 500 pana la gol, garda progres; loturi IN de 100. Filtrarea locala este ceruta explicit de brief. |
| L24 | Ambele ecrane: generatie useRef invalidata la cleanup; bucle oprite; ListaSesiune key proiect/UAT; reload explicit dupa actiune/PV; timer zi Bucuresti cu cleanup. |
| L25 | sesiune.test.js: asteptari literale independente, fixture-uri sintetice, total ponderat 2/4=50%, zero si DST. Fara pretentie de verificare RLS/PostgREST/concurenta executata. |

Verificat aici numai static: coloane si semantica vederilor din migrarile
existente, legarea taburilor/props, ASCII pentru fisierele noi si UTF-8 fara
BOM. Nu s-au rulat npm/npx/node/vitest, build, browser, PostgREST sau teste
RLS. Claude trebuie sa ruleze sesiune.test.js, regresiile existente, build
si fluxul real editor/viewer, paginare peste 500/1000, cursor compus, schimbare
UAT/proiect in timpul cererii, eroare trigger si reconciliere timeout.
Skill-ul Supabase nu a putut fi citit: acces refuzat de mediul local.
Nu s-au rulat Git/commit/push, acces la credentiale, BD sau deploy.