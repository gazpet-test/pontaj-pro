# FAN Courier în Redări — Testul 1: lista de pași pentru dimineața activării

Document operațional, de parcurs **pas cu pas de coordonator împreună cu proprietarul**, cu bifă pe fiecare rând și un **jurnal al testului**
(un fișier text ținut de coordonator, în afara repo-ului: ora, pasul, ce s-a văzut, ce s-a decis). Proiectarea întreagă: `FANCOURIER_INTEGRARE.md`
(§10 lista de activare, §11 Testul 1). Nimic de aici nu se improvizează: la orice abatere se oprește (§9 de mai jos) și se notează.

**Ce aduce PR-ul de activare (acest PR), în cod:** `TRANSPORT_REAL_ACTIV = true` + garda **`DOAR_PROIECTE_TEST = true`** în
`supabase/functions/_shared/redariFanHandler.mjs`: funcția edge `redari-fan-awb` ajunge la curier DOAR pe un lot al unui proiect al cărui cod
începe cu `TEST-` (aceeași convenție ca SMS-urile Redări) ȘI marcat **TEST** de owner (`red_fan_loturi.test`, imuabil după prima aprobare —
trigger în BD). Orice alt lot primește **423 `transport_real_doar_test`** înainte de secrete și de orice apel; ecranul arată același motiv pe
fiecare buton. Cu `TRANSPORT_REAL_ACTIV = false` comportamentul e exact cel de dinainte (423 `transport_real_oprit`, fără nicio citire în plus).
Plafoanele (UN plic la pasul 4a, apoi 3 la 4b) NU sunt cod nou: sunt setarea existentă `red_fan_setari.limita_lot` (§4 de mai jos).

**Precondiții deja îndeplinite (17.11.2026):** migrarea `20261212a_redari_fan_awb` aplicată pe mediul real (146 de obiecte, tabelele goale);
review-ul PR #1118: fără probleme de cod restante; decizia proprietarului: Testul 1 pe **contul de TEST** al curierului.

**Ce NU face nimeni în această zi:** lot real; proiect real; mai mult de un plic pe lot înainte de confirmarea de la pasul 5; comanda curierului
prin API (se face manual în selfAWB); Testul 2.

---

## 1. Secretele funcției edge și contul curierului (proprietarul; coordonatorul verifică DOAR existența)

Supabase → Edge Functions → Secrets. Doar **numele** de mai jos; valorile le pune proprietarul, nu se scriu nicăieri (nici în jurnal, nici în chat):

| Secret | Ce e | Verificare fără expediere |
|---|---|---|
| `FAN_SELFAWB_USERNAME` | utilizatorul contului de **TEST** indicat de FAN | proprietarul se loghează cu el în selfAWB și confirmă că e contul de TEST (nu contul firmei) |
| `FAN_SELFAWB_PASSWORD` | parola aceluiași cont | idem (login reușit în selfAWB) |
| `FAN_CLIENT_ID` | ID-ul punctului de lucru (clientId) **al contului de TEST** | în selfAWB, la punctul de lucru al contului de test; un clientId al contului real = expedieri reale |

Verificarea **din ERP, fără expediere** (după §2 și §3): pe lotul de TEST marcat, owner-ul apasă **„Lista de evenimente FAN”** (acțiunea
`evenimente`): face `POST /login` + `GET /reports/awb-events` (fără cost). Rezultate:
- mesaj cu „Coduri lipsă la FAN: …; coduri FAN neclasificate: …” → secretele sunt bune și contul răspunde; se notează în jurnal lista
  (diferențele intră în `EVENIMENTE_FAN` printr-un PR mic, ÎNAINTE de prima urmărire reală — doc §10 pasul 4);
- `transport_neconfigurat` (503) → lipsește un secret (numele de mai sus, exact);
- `autentificare_fan_neconfirmata` (503) → utilizator / parolă greșite sau FAN indisponibil; nu se reîncearcă în buclă (se verifică în selfAWB);
- `transport_real_doar_test` (423) → lotul nu e pe un proiect `TEST-` sau nu e marcat TEST (§3).

**Întrebarea deschisă 3 (doc §8), de lămurit cu FAN ÎNAINTE de pasul 5:** se facturează AWB-urile create cu contul de test? Răspunsul (în scris) în
jurnal. Dacă răspunsul arată un cost: se oprește și decide proprietarul (regula din doc §11: contul nu se schimbă de aici).

## 2. Publicarea funcției edge (coordonatorul, după merge-ul acestui PR în `main`)

1. GitHub → Actions → **„Deploy edge function (manual)”** → `slug` = `redari-fan-awb` → Run workflow (de pe `main`).
   Funcția NU e în lista `NO_JWT` a workflow-ului → se publică cu `verify_jwt = true` (poarta platformei + poarta owner din cod). Apelul din
   ecran (`supabase.functions.invoke`) merge așa, ca la `sms-trimite` și `polita-citeste`.
2. Versiunea: pasul „Rezumat repo vs producție” din workflow și Supabase → Edge Functions → `redari-fan-awb` → **versiunea** (prima publicare = 1).
   Se notează în jurnal: data, ora, versiunea, commit-ul de pe `main`.
3. Verificare rapidă că e forma ACTIVATĂ: în Supabase → Edge Functions → `redari-fan-awb` → Code, `redariFanHandler.mjs` conține
   `TRANSPORT_REAL_ACTIV = true` și `DOAR_PROIECTE_TEST = true`.

## 3. Probele 401 / 403 / 423 (coordonatorul, de pe server, cu `curl`; nimic nu ajunge la curier)

`<URL>` = adresa proiectului Supabase, `<ANON>` = cheia publică (anon). JWT-urile se iau din sesiunea contului respectiv (browser → DevTools →
Application → Local Storage → cheia `sb-…-auth-token` → `access_token`; expiră în ~1 oră) și **nu se scriu nicăieri** (nici în jurnal).

Loturile folosite la probe: **L_NEMARCAT** = un lot de plicuire de pe `TEST-RAZVAN` care NU e marcat TEST (nu are rând în `red_fan_loturi`);
**L_REAL** = un lot de pe un proiect real (funcția doar îl citește; nimic scris, nimic trimis). Pentru 423 ajunge L_NEMARCAT; L_REAL
dovedește garda pe proiect.

```bash
corp='{"actiune":"evenimente","lot_id":"<uuid L_NEMARCAT>"}'
# 1) fără JWT → 401 (de la platformă, verify_jwt, sau din cod: {"cod":"neautentificat"})
curl -s -o /dev/null -w '%{http_code}\n' -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H 'Content-Type: application/json' -d "$corp"
# 1b) cheia anon ca JWT → 401 {"cod":"neautentificat"} (trece de platformă, nu are utilizator)
curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <ANON>" -H 'Content-Type: application/json' -d "$corp"
# 2) JWT al unui cont NE-owner (contul de test „Claude”) → 403 {"cod":"non_owner"}
curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT ne-owner>" -H 'Content-Type: application/json' -d "$corp"
# 3) JWT owner, lot NEMARCAT pe TEST-RAZVAN → 423 {"cod":"transport_real_doar_test","motiv":"transport doar pe loturi marcate TEST …"}
curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT owner>" -H 'Content-Type: application/json' -d "$corp"
# 3b) JWT owner, lot al unui proiect REAL → 423 {"cod":"transport_real_doar_test","motiv":"transport doar pe proiecte de TEST …"}
corp2='{"actiune":"evenimente","lot_id":"<uuid L_REAL>"}'
curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT owner>" -H 'Content-Type: application/json' -d "$corp2"
# 4) acțiune necunoscută, JWT owner → 400 {"cod":"cerere_invalida"}
curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT owner>" -H 'Content-Type: application/json' -d '{"actiune":"trimite","lot_id":"<uuid L_NEMARCAT>"}'
```

Apoi Supabase → Edge Functions → Logs: cele 6 apeluri, **niciun apel către `api.fancourier.ro`** (nu există `POST /login` în jurnal; garda
răspunde înaintea secretelor). Rezultatele se trec în jurnal. Un rezultat diferit = oprire (§9).

## 4. Plafonul lotului pilot: UN plic (setare existentă, nu cod)

`red_fan_setari.limita_lot` (implicit 20, pus de migrare) limitează plicurile **aprobate** pe lot (`fn_red_fan_aproba`: deja aprobate / trimise + cele
de acum ≤ plafon). Pentru Testul 1: **1** până la confirmarea asocierii (pasul 5), apoi **3** pentru lotul de la pasul 7, apoi înapoi la **20** după Testul 2.

**Cine și cum (preferat):** proprietarul (owner), din ecran: ✉️ Poștă → lotul → „📦 AWB FAN” → caseta „Plafonul lotului pilot” → `1` →
„Schimbă plafonul” (RPC `fn_red_fan_setari_seteaza`, cere owner; scrie `actualizat_de` = owner). Plafonul e global (toate loturile).

**Previzualizare (coordonatorul, doar citire; nu pune valori):**
```sql
SELECT limita_lot, actualizat_de, actualizat_la FROM public.red_fan_setari;          -- așteptat înainte: 20 | NULL | NULL
SELECT id, cod FROM public.red_proiecte WHERE cod LIKE 'TEST-%';                      -- proiectul de test există și codul începe cu TEST-
```
**Aplicare de rezervă (DOAR dacă ecranul nu poate; coordonatorul, cu „da”-ul proprietarului, ca `postgres`; RPC-ul cere JWT de owner, deci
prin psql e scrierea directă, cu autorul explicit):**
```sql
UPDATE public.red_fan_setari SET limita_lot = 1, actualizat_de = '<uuid owner>', actualizat_la = now() WHERE id RETURNING limita_lot, actualizat_la;
```
Verificare după: `SELECT limita_lot FROM public.red_fan_setari;` → `1`. Aceleași instrucțiuni cu `3` la pasul 7 și `20` la final.

## 5. Lotul de test cu UN plic, pe `TEST-RAZVAN` (date ale firmei, fără date personale ale terților)

În ERP, pe proiectul `TEST-RAZVAN` (codul trebuie să înceapă cu `TEST-`, altfel garda refuză):
1. Un deținător de test (nume fictiv, ex. „TEST GAZPET PLIC UNU”), cu contactul = **datele firmei**: telefon = telefonul firmei (obligatoriu la FAN),
   strada + nr. = adresa sediului, localitate = Ploiești, județ = Prahova, cod poștal = al sediului. Nicio adresă / telefon al unei persoane.
2. O convocare poștală activă pentru el, cu documentele generate, apoi plicuirea → un **lot de plicuire nou (PP-xxxx) cu EXACT un plic**, activ,
   fără AWB, fără dată de expediere, cu opisul atașat (doc §11, „Înainte”, (c)).
3. ✉️ Poștă → lotul → **„📦 AWB FAN”**: previzualizarea arată „1 din 1 plicuri au toate datele cerute de FAN” și „referința pe etichetă: PL-…”.
   Dacă lipsește ceva (telefon, județ, stradă) se completează pe contact, nu se forțează.
4. Banner-ul de sus: „Activare de TEST (Testul 1): transport doar pe loturi marcate TEST …” (lotul încă nemarcat).

Ce pleacă la curier pentru acest plic (doc §2): numele deținătorului de test, telefonul și adresa firmei, numărul plicului (`content` /
`observation`), centrul de cost = `TEST-RAZVAN`, plic 1 kg, 32×24×1 cm, opțiunea B (oPOD), plătește expeditorul.

## 6. Pasul 4a (BLOCANT): propunere → marcaj TEST → aprobare → apelul real → asocierea răspuns ↔ plic

Toate cu proprietarul de față; fiecare rând în jurnal, cu ora.

| # | Cine | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|
| 1 | admin / editor Redări (sau owner-ul) | „1. Propune 1 plicuri” | „Propuse: 1; erori: 0.”; rândul FAN „propus” |
| 2 | owner | „2a. Marchează TEST” → confirmare | „Lot marcat: TEST.”; titlul „LOT DE TEST · PP-xxxx”; banner-ul devine roșu: „TRANSPORT REAL PORNIT pe acest lot de TEST …” |
| 3 | owner | (verificarea din §1, fără cost) „Lista de evenimente FAN” | mesajul cu codurile; în jurnal: lista și diferențele |
| 4 | owner | „2c. Aprobă” → confirmare („Aprobi 1 AWB-uri FAN … Fiecare AWB generat costă”) | „Aprobate: 1.”; cu plafonul 1 un lot mai mare ar fi refuzat („peste plafonul lotului pilot (1)”) |
| 5 | owner | **„3. Generează AWB”** → confirmare („Se plătesc.”) — **primul apel real `POST /intern-awb`, o expediere** | mesaj: „Generate: 1; respinse: 0; necunoscute: 0; rămase: 0.” + eventual „Asociate pe poziție (de verificat în selfAWB): 1.” |
| 6 | owner | selfAWB (contul de TEST) → AWB-urile zilei | **un singur AWB nou**, cu numărul plicului (PL-…) la observații / conținut, destinatarul și adresa firmei, tariful |
| 7 | coordonator | ERP: rândul FAN al plicului | stare „AWB generat”, AWB-ul = cel din selfAWB, tariful = cel din selfAWB (sau gol = „necunoscut”, de notat) |

**Ce se citește din răspuns și cum se confirmă asocierea (doc §8 deschisă 11, §10 pasul 4a):**
- ERP-ul nu afișează și nu păstrează corpul brut al răspunsului FAN (regula „textele FAN nu intră în evidență”). Ce spune mesajul:
  - **„Asociate pe poziție (de verificat în selfAWB): 1”** = elementul din răspuns NU poartă referința noastră (`observation` / `content`) →
    asocierea s-a făcut pe poziție (presupunerea neconfirmată). Confirmarea: în selfAWB, AWB-ul din ERP are la observații EXACT numărul plicului.
  - fără acest text (asociate pe poziție: 0) = FAN a întors referința pe element și ea a coincis cu plicul → asocierea e **pe referință**.
  - „necunoscute: 1” = răspuns neconfirmat (timeout / formă neașteptată / referință contrazisă) → §9, nu se reapasă.
- Forma completă a elementului (celelalte câmpuri) NU se vede din ERP în această livrare; dacă proprietarul o vrea consemnată, se cere un PR
  mic care să o întoarcă în răspuns DOAR pe loturi de TEST — nu se improvizează din jurnalul funcției.
- **Verdictul 4a se scrie în jurnal**: „asociere confirmată pe referință” / „asociere pe poziție, confirmată în selfAWB pe 1 AWB” / „neconfirmată”.
  Lotul de 3 (pasul 7) pornește DOAR cu unul din primele două verdicte. „Neconfirmată” = Testul 1 se oprește aici; un PR reduce bucata la UN plic
  pe solicitare (`imparteInBucati(…, 1)`, doc §10 pasul 4a) înainte de orice continuare.

## 7. Eticheta: descărcare și verificare

| # | Cine | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|
| 1 | owner | „4. Etichete A6 (PDF)” | se descarcă `TEST_PP-xxxx_tiraj-<ID>_etichete_A6.pdf` (o etichetă) și `TEST_PP-xxxx_tiraj-<ID>_pagina_de_control.docx`; mesaj „Etichete A6, tirajul <ID>: 1 plicuri (pozițiile 1…1).”; caseta „Pagina de control”: „Tiraj: <ID> (nr. 1)” |
| 2 | om | PDF-ul | un PDF real (nu HTML), format A6, AWB-ul = cel din ERP; **numărul plicului (PL-…) e tipărit pe etichetă?** (doc §8 deschisă 12) → în jurnal da / nu; dacă nu, se scrie de mână pe plic |
| 3 | om | pagina de control | un rând: poziția 1 · PL-… · AWB · destinatar mascat · nr. documente; tirajul <ID> în titlu |
| 4 | om | imprimanta termică | eticheta se tipărește lizibil (cod de bare întreg) |
| 5 | owner | „4. Etichete A6 (PDF)” a doua oară | același fișier, același `<ID>` (tirajul nu se schimbă) |

Lotul de 3 (după verdictul 4a, cu plafonul 3): aceiași pași de la §6 și §7 pe lotul PP-yyyy cu 3 plicuri (plicul 2 cu o localitate inexistentă,
ca FAN să-l respingă — doc §11, pașii 1–8), tot cu adrese ale firmei / colegi care acceptă, tot marcat TEST.

## 8. Urmărirea, confirmările, comanda curierului

- „6. Urmărire” imediat după generare: „Urmărire actualizată: 1 AWB-uri.”; starea de urmărire „fără evenimente” sau „în tranzit” (cod + dată în
  ora României). „de verificat de om” = formă de răspuns neașteptată → jurnal (doc §8 deschisă 10), nu se continuă cu urmăriri în buclă.
- „7. Confirmări / retururi”: „Confirmări verificate: 1 AWB-uri.”; așteptat „nicio confirmare încă”. „răspuns de formă necunoscută” → jurnal (deschisa 7).
- Comanda curierului: **manual în selfAWB** (o comandă pe zi, interval ≥ 2 h). Dacă în Testul 1 NU se vrea ridicarea fizică, nu se comandă
  curierul și AWB-ul se anulează (§9).
- După ridicare (a doua zi): „6. Urmărire” → „ridicat (C0): de confirmat” → „6b. Confirmă ridicarea (1)” → pe lotul de TEST se marchează DOAR
  evidența FAN (plicul din Poștă NU devine expediat; nu apare în registru / PV / export).

## 9. Anularea AWB-ului de test

Înainte de ridicare (doar de pe borderoul zilei): caseta „Anulare AWB (înainte de ridicare)” → **„Șterge la FAN”** (`DELETE /awb`):
- „AWB șters și anulat: PL-…” → rândul FAN „anulat”; în selfAWB AWB-ul nu mai apare pe borderou. Se notează forma răspunsului de succes
  (doc §8 deschisă 15: codul acceptă doar HTTP 200 + `status: "success"`).
- „Ștergere neconfirmată: AWB-ul rămâne «generat» …” → se verifică în selfAWB; dacă acolo e șters → „Marchează anulat (verificat în selfAWB)”,
  cu motivul; dacă nu e șters → se șterge din selfAWB, apoi același buton.
- „stergere_refuzata” (409) → FAN a refuzat (ex. deja ridicat); rămâne „generat”; se lămurește în selfAWB.
În ERP, pe un lot de TEST, plicul nu e atins în niciun caz (AWB-ul stă doar în `red_fan_awb`). Un AWB șters poate apărea totuși pe factură
(întrebarea deschisă 3): se compară factura contului de test cu evidența.

## 10. Dacă răspunsul nu are forma așteptată: OPRIRE, nu improvizație

| Ce se vede | Ce înseamnă | Ce se face |
|---|---|---|
| „necunoscute: 1” / „răspuns FAN neconfirmat” | timeout / 5xx / răspuns ambiguu DUPĂ `POST /intern-awb`: AWB-ul **poate exista** | NU se reapasă „Generează” (al doilea AWB = cost dublu). Se așteaptă 10 minute, apoi caseta „Reconciliere” cu ziua de azi → „Reconciliază”: „găsit: AWB …” → „Confirmă AWB-ul”; „nu apare în borderoul complet” → „Confirmă absența”; „de verificat în selfAWB” → se verifică acolo, fără buton |
| „respinse: 1” cu câmpuri semnalate | FAN a refuzat elementul (adresă / telefon) | se corectează contactul, „Propune” din nou (hash nou), „Aprobă”, „Generează”; nimic plătit pe el |
| `eticheta_neconfirmata` (502) | răspunsul etichetei nu e PDF | nimic descărcat; jurnal; se reîncearcă o singură dată mai târziu |
| `tiraj_schimbat` / `tiraj_oprit` | manifestul s-a schimbat de la prima descărcare | procedura „Tiraj nou” din ecran (oprește → 30 s → distruge foile → înlocuiește); nu la pasul 4a cu un singur plic |
| `urmarire_neconfirmata` / „de verificat de om” | formă de răspuns neașteptată la urmărire | nimic scris; jurnal (deschisa 10); se continuă doar după lămurire |
| `transport_real_doar_test` | lotul nu e pe `TEST-` sau nu e marcat TEST | se verifică lotul; NU se marchează nimic pe proiecte reale |
| `transport_neconfigurat` / `autentificare_fan_neconfirmata` | secretele | §1 |
| orice eroare neconfirmată („Rezultat neconfirmat: reîncarcă evidența…”) | rețea / BD | se reîncarcă evidența ÎNAINTE de orice reluare |

Regula tare: un rezultat neclar se lămurește în selfAWB și în jurnal; nu se „mai apasă o dată”.

## 11. Cum se oprește totul și ce rămâne în bază

- **Oprire imediată, fără cod** (oricând în timpul zilei): Supabase → Edge Functions → Secrets → se șterg cele trei secrete FAN → orice apel
  răspunde 503 `transport_neconfigurat`, fără niciun apel la curier (secretele se citesc la fiecare cerere). Alternativ: ștergerea funcției
  `redari-fan-awb` din Supabase (ecranul arată eroare, nimic chemat).
- **Oprire în cod** (comutatorul înapoi): PR care pune `TRANSPORT_REAL_ACTIV = false` în `redariFanHandler.mjs` (+ testele care cer `true`
  înapoi pe `false`; testul „comutatorul oprit” din `fanCourierMutanti.test.js` descrie exact comportamentul oprit) → merge → „Deploy edge
  function (manual)” → ecranul arată din nou „Transport oprit”, 423 `transport_real_oprit` pe orice acțiune.
- **Ce rămâne în bază după test** (evidență, nu se șterge): rândurile din `red_fan_awb` (stări generat / anulat / eroare, AWB, tarif),
  `red_fan_loturi` (marcajul TEST, prima aprobare, tirajul), `red_fan_setari.limita_lot` (se pune înapoi 20 din ecran), evenimentele de tiraj
  în `red_jurnal`. Plicurile și convocările de pe `TEST-RAZVAN` rămân neatinse (lot de TEST: nimic scris pe plic). Revenirea migrării
  (`20261212a_…_ROLLBACK.sql`) **refuză** cu aceste date (doc §7): tabelele rămân.
- **Trecerea la Testul 2** (după acceptarea Testului 1 și „da”-ul juridic): PR separat, revizuit, cu `DOAR_PROIECTE_TEST = false` (lotul real
  rămâne păzit de marcajul owner-ului și de plafonul pilot), + registrul de automatizări și rândul din `public.automatizari` (doc §10 pasul 5).

## 12. Ce NU se poate verifica fără apelul real și riscul care rămâne la primul apel

**Nu se poate verifica în prealabil** (toate cu pas de oprire mai sus): forma elementului din răspunsul `POST /intern-awb` (referința pe element —
deschisa 11), dacă eticheta A6 tipărește numărul plicului (12), formele răspunsurilor la urmărire / confirmări / ștergere / borderou (7, 10, 15, 16),
dacă AWB-urile contului de TEST se facturează (3), limita de solicitări pe minut (2), potrivirea adresei firmei cu nomenclatorul FAN (validarea
cu nomenclatorul nu e în cod: un refuz vine ca „respins de FAN” cu câmpurile semnalate), și că apelul din ecran trece de `verify_jwt = true`
(precedent în repo: `sms-trimite`, `polita-citeste`; dacă nu trece, probele din §3 cu `curl` merg oricum, iar soluția e lista `NO_JWT`, PR separat).

**Riscul care rămâne la primul apel și ce îl ține mic:**
- **Cost**: un AWB pe contul de TEST (tariful vine în răspuns; pe factură dacă FAN facturează contul de test). Ținut mic de: plafonul 1, aprobarea
  owner-ului pe hash, confirmarea „Se plătesc”, o singură solicitare cu o expediere.
- **Expediere reală creată din greșeală**: dacă secretele ar fi ale contului REAL al firmei, AWB-ul ar fi real (pe borderoul firmei, facturat).
  Ținut mic de: verificarea §1 (login în selfAWB cu aceleași credențiale = contul de TEST), destinatarul = adresa firmei (un plic trimis greșit
  ajunge tot la noi), fără comandă de curier prin API, anularea din §9 înainte de ridicare.
- **Date trimise curierului**: numele deținătorului de test (fictiv), telefonul și adresa firmei, numărul plicului, codul `TEST-RAZVAN`. Nicio
  dată personală a unui terț. Răspunsurile FAN nu se păstrează ca text (doar stări, AWB, tarif, câmpurile semnalate).
- **Dublare**: un „necunoscut” urmat de reapăsare ar face al doilea AWB — de aceea regula din §10 (reconciliere, nu reapăsare); claim-ul din BD
  oprește oricum rândurile deja trimise (doar „aprobat” se rezervă).
- **Proiect greșit**: garda `DOAR_PROIECTE_TEST` + marcajul TEST (imuabil după prima aprobare) → un lot real primește 423 chiar cu comutatorul pornit
  (testat: `fanCourier.test.js`, `fanCourierMutanti.test.js` — 6 mutanți ai gărzii prinși, comportamentul cu comutatorul oprit neschimbat).
