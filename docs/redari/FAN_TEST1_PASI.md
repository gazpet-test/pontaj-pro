# FAN Courier în Redări — Testul 1: lista de pași pentru dimineața activării

Document operațional, de parcurs **pas cu pas de coordonator împreună cu proprietarul**, cu bifă pe fiecare rând și un **jurnal al testului**
(un fișier text ținut de coordonator, în afara repo-ului: ora, pasul, ce s-a văzut, ce s-a decis). Proiectarea întreagă: `FANCOURIER_INTEGRARE.md`
(§10 lista de activare, §11 Testul 1). Nimic de aici nu se improvizează: la orice abatere se oprește (§11 de mai jos) și se notează.

**Ordinea pașilor e cea pe care ecranul o permite** (runda 2, verdictul recenzentului pe PR #1130): cât garda „doar TEST” e pornită, pe un lot
NEmarcat sunt active DOAR „2a. Marchează TEST” (owner, proiect `TEST-…`) și nimic altceva — nici „Propune”, nici plafonul. De aceea ordinea e:
**pregătirea lotului (§4) → marcajul TEST (§5) → plafonul 1 + recitirea din BD + verificarea că nu există aprobări (§6) → propunere → aprobare →
generare (§7) → etichetă (§8)**. Testul `fanCourier.test.js` („procedura Testului 1 din document, executabilă din ecran”) parcurge tabelele din
§5–§8 de la lot gol, în ordinea scrisă aici, și pică dacă un pas nu e activ în ecran în momentul lui.

**Ce aduce PR-ul de activare (acest PR), în cod:** `TRANSPORT_REAL_ACTIV = true` + garda **`DOAR_PROIECTE_TEST = true`** în
`supabase/functions/_shared/redariFanHandler.mjs`: funcția edge `redari-fan-awb` ajunge la curier DOAR pe un lot al unui proiect al cărui cod
începe cu `TEST-` (aceeași convenție ca SMS-urile Redări) ȘI marcat **TEST** de owner (`red_fan_loturi.test`, imuabil după prima aprobare —
trigger în BD). Orice alt lot primește **423 `transport_real_doar_test`** înainte de secrete și de orice apel; ecranul arată același motiv pe
fiecare buton. Cu `TRANSPORT_REAL_ACTIV = false` comportamentul e exact cel de dinainte (423 `transport_real_oprit`, fără nicio citire în plus).
Plafoanele (UN plic la pasul 4a, apoi 3 la 4b) NU sunt cod nou: sunt setarea existentă `red_fan_setari.limita_lot` (§6 de mai jos).

**Precondiții deja îndeplinite (17.11.2026):** migrarea `20261212a_redari_fan_awb` aplicată pe mediul real (146 de obiecte, tabelele goale);
review-ul PR #1118: fără probleme de cod restante; decizia proprietarului: Testul 1 pe **contul de TEST** al curierului.

**Ce NU face nimeni în această zi:** lot real; proiect real; mai mult de un plic pe lot înainte de verdictul 4a (§7); comanda curierului
prin API (se face manual în selfAWB); Testul 2.

---

## 0. Lista de control a zilei (proprietarul + coordonatorul; fiecare rând bifat în jurnal ÎNAINTE de pasul la care se referă)

Convenția `TEST-` **nu e o clasificare imuabilă de securitate**: un admin Redări (nu doar owner-ul) poate crea și edita proiecte, deci un proiect
cu date reale ar putea fi numit `TEST-…`, iar codul unui proiect se poate schimba (cu excepția celor cu autorizare TGZ). Garda citește codul la
fiecare cerere, nu îl fixează pe durata ei. Riscul e acceptabil DOAR cu controlul proprietarului în ziua testului:

| # | Cine | Ce verifică / decide | Când |
|---|---|---|---|
| a | proprietarul | **ID-ul proiectului** de test, **ID-ul lotului** de test, **codul** (`TEST-RAZVAN`, exact, fără spații) și **conținutul fictiv** (deținătorul de test, contactul = datele firmei; niciun deținător real în lot) — citite din ERP și din SQL-ul de previzualizare (§6), scrise în jurnal | înainte de §5 |
| b | toți | **pe durata testului nu se redenumesc proiecte și nu se schimbă marcaje de lot** (nimeni nu editează `red_proiecte.cod`, nimeni nu apasă „Marchează” pe alt lot); coordonatorul anunță colegii cu drept de admin Redări | toată ziua |
| c | coordonatorul | **commit-ul publicat** identificat: SHA-ul de pe `main` de după îmbinare = versiunea funcției edge din Supabase (§2) | înainte de §3 |
| d | coordonatorul | **probele 401 / 403 / 423 pe versiunea INERTĂ** (cea de pe `main` ÎNAINTE de îmbinarea acestui PR: 423 `transport_real_oprit`) — dacă nu au fost făcute la publicarea cu flag-ul `false` (doc §10 pasul 3b), se fac întâi ele, apoi **din nou după activare** (§3) | înainte de §3 |
| e | proprietarul | **contul de TEST al curierului, `clientId`-ul lui și costurile**: confirmare explicită, în jurnal, că secretele sunt ale contului de TEST (login în selfAWB cu aceleași credențiale), că `FAN_CLIENT_ID` e punctul de lucru al acelui cont și că acceptă costul eventual al AWB-urilor de test (răspunsul FAN la deschisa 3 în jurnal) | înainte de §7 |
| f | proprietarul | **plafonul 1 setat ȘI recitit din BD, fără aprobări / trimiteri existente** (§6) | înainte de §7 |
| g | proprietarul | **asocierea AWB ↔ plic verificată în selfAWB** pe primul AWB (verdictul 4a în jurnal) ÎNAINTE de lotul de 3 | după §7, înainte de lotul de 3 |
| h | toți | **oprire la orice rezultat ambiguu** (§11): „necunoscut”, tarif neconfirmat, nepotrivire etichetă / selfAWB / BD, formă neașteptată; nimic nu se „mai apasă o dată” | toată ziua |
| i | proprietarul | **anularea AWB-ului înainte de ridicare** (§10) dacă nu se vrea transport fizic; altfel decizia explicită de a comanda curierul | sfârșitul zilei |

**Derogări**: orice continuare după un rezultat care cere oprire (§11) o decide DOAR proprietarul, explicit, scrisă în jurnal (ora, ce anume, de ce)
ÎNAINTE de pasul următor. Coordonatorul nu decide singur și nu „notează pentru mai târziu”.

## 1. Secretele funcției edge și contul curierului (proprietarul; coordonatorul verifică DOAR existența)

Supabase → Edge Functions → Secrets. Doar **numele** de mai jos; valorile le pune proprietarul, nu se scriu nicăieri (nici în jurnal, nici în chat):

| Secret | Ce e | Verificare fără expediere |
|---|---|---|
| `FAN_SELFAWB_USERNAME` | utilizatorul contului de **TEST** indicat de FAN | proprietarul se loghează cu el în selfAWB și confirmă că e contul de TEST (nu contul firmei) |
| `FAN_SELFAWB_PASSWORD` | parola aceluiași cont | idem (login reușit în selfAWB) |
| `FAN_CLIENT_ID` | ID-ul punctului de lucru (clientId) **al contului de TEST** | în selfAWB, la punctul de lucru al contului de test; un clientId al contului real = expedieri reale |

Verificarea **din ERP, fără expediere** (după §2, §3 și §5, pe lotul de TEST marcat): owner-ul apasă **„Lista de evenimente FAN”** (acțiunea
`evenimente`): face `POST /login` + `GET /reports/awb-events` (fără cost). Rezultate:
- mesaj cu „Coduri lipsă la FAN: …; coduri FAN neclasificate: …” → secretele sunt bune și contul răspunde; se notează în jurnal lista
  (diferențele intră în `EVENIMENTE_FAN` printr-un PR mic, ÎNAINTE de prima urmărire reală — doc §10 pasul 4);
- `transport_neconfigurat` (503) → lipsește un secret (numele de mai sus, exact);
- `autentificare_fan_neconfirmata` (503) → utilizator / parolă greșite sau FAN indisponibil; nu se reîncearcă în buclă (se verifică în selfAWB);
- `transport_real_doar_test` (423) → lotul nu e pe un proiect `TEST-` sau nu e marcat TEST (§5).

**Întrebarea deschisă 3 (doc §8), de lămurit cu FAN ÎNAINTE de §7:** se facturează AWB-urile create cu contul de test? Răspunsul (în scris) în
jurnal. Dacă răspunsul arată un cost: se oprește și decide proprietarul (regula din doc §11: contul nu se schimbă de aici) — rândul (e) din §0.

## 2. Publicarea funcției edge (coordonatorul, după merge-ul acestui PR în `main`)

1. GitHub → Actions → **„Deploy edge function (manual)”** → `slug` = `redari-fan-awb` → Run workflow (de pe `main`).
   Funcția NU e în lista `NO_JWT` a workflow-ului → se publică cu `verify_jwt = true` (poarta platformei + poarta owner din cod). Apelul din
   ecran (`supabase.functions.invoke`) merge așa, ca la `sms-trimite` și `polita-citeste`.
2. **Identificarea commit-ului publicat** (rândul (c) din §0): `git rev-parse origin/main` după îmbinare = SHA-ul din pasul „Rezumat repo vs
   producție” al workflow-ului; Supabase → Edge Functions → `redari-fan-awb` → **versiunea** (crește cu 1 față de publicarea inertă). Se notează
   în jurnal: data, ora, versiunea, SHA-ul. Un SHA diferit de `main` = oprire (s-a publicat altceva).
3. Verificare că e forma ACTIVATĂ: în Supabase → Edge Functions → `redari-fan-awb` → Code, `redariFanHandler.mjs` conține
   `TRANSPORT_REAL_ACTIV = true` și `DOAR_PROIECTE_TEST = true`.

## 3. Probele 401 / 403 / 423 (coordonatorul, de pe server, cu `curl`; nimic nu ajunge la curier)

Se fac de DOUĂ ori (rândul (d) din §0): **pe versiunea INERTĂ** (publicarea cu flag-ul `false`, doc §10 pasul 3b; așteptat la pasul 3: 423
`transport_real_oprit`), dacă nu au fost făcute atunci; apoi **pe versiunea activată** (așteptările de mai jos). Ambele seturi în jurnal.

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
#    (pe versiunea INERTĂ: 423 {"cod":"transport_real_oprit"})
curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT owner>" -H 'Content-Type: application/json' -d "$corp"
# 3b) JWT owner, lot al unui proiect REAL → 423 {"cod":"transport_real_doar_test","motiv":"transport doar pe proiecte de TEST …"}
corp2='{"actiune":"evenimente","lot_id":"<uuid L_REAL>"}'
curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT owner>" -H 'Content-Type: application/json' -d "$corp2"
# 4) acțiune necunoscută, JWT owner → 400 {"cod":"cerere_invalida"}
curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT owner>" -H 'Content-Type: application/json' -d '{"actiune":"trimite","lot_id":"<uuid L_NEMARCAT>"}'
```

**Dovada că nimic n-a plecat spre curier** (toate trei, în jurnal; niciuna nu ajunge singură):
1. **codurile de răspuns** de mai sus: 401 / 403 / 423 / 400 sunt date ÎNAINTEA citirii secretelor și a oricărui apel (ordinea din cod, probată
   de teste: autentificare → owner → cerere → lot → flag → proiect + marcaj → abia apoi transportul);
2. **jurnalul funcției** (Supabase → Edge Functions → Logs): exact cele 6 cereri, cu codurile lor. Jurnalul arată cererile PRIMITE de funcție,
   nu apelurile ei IEȘITE (funcția nu scrie în jurnal `POST /login` și nici alt apel către `api.fancourier.ro`): **absența unei linii `POST /login`
   nu dovedește nimic** singură;
3. **selfAWB, contul de TEST**: niciun AWB nou și (dacă selfAWB arată istoricul de autentificări) nicio autentificare nouă în intervalul probelor.
Un rezultat diferit la oricare = oprire (§11).

## 4. Lotul de test cu UN plic, pe `TEST-RAZVAN` (date ale firmei, fără date personale ale terților)

În ERP, pe proiectul `TEST-RAZVAN` (codul trebuie să înceapă cu `TEST-`, altfel garda refuză; ID-ul proiectului și al lotului = rândul (a) din §0):
1. Un deținător de test (nume fictiv, ex. „TEST GAZPET PLIC UNU”), cu contactul = **datele firmei**: telefon = telefonul firmei (obligatoriu la FAN),
   strada + nr. = adresa sediului, localitate = Ploiești, județ = Prahova, cod poștal = al sediului. Nicio adresă / telefon al unei persoane.
2. O convocare poștală activă pentru el, cu documentele generate, apoi plicuirea → un **lot de plicuire nou (PP-xxxx) cu EXACT un plic**, activ,
   fără AWB, fără dată de expediere, cu opisul atașat (doc §11, „Înainte”, (c)).
3. ✉️ Poștă → lotul → **„📦 AWB FAN”**: previzualizarea arată „1 din 1 plicuri au toate datele cerute de FAN” și „referința pe etichetă: PL-…”.
   Dacă lipsește ceva (telefon, județ, stradă) se completează pe contact, nu se forțează.
4. Banner-ul de sus: „Activare de TEST (Testul 1): transport doar pe loturi marcate TEST …” (lotul încă nemarcat). **În acest moment singurul
   buton activ e „2a. Marchează TEST”**: „1. Propune”, „2c. Aprobă”, „Schimbă plafonul” și restul sunt dezactivate cu motivul gărzii.

Ce pleacă la curier pentru acest plic (doc §2): numele deținătorului de test, telefonul și adresa firmei, numărul plicului (`content` /
`observation`), centrul de cost = `TEST-RAZVAN`, plic 1 kg, 32×24×1 cm, opțiunea B (oPOD), plătește expeditorul.

## 5. Marcajul TEST al lotului (owner; lotul e încă GOL în evidența FAN)

Marcajul se pune pe lotul gol (RPC-ul `fn_red_fan_lot_marcheaza` nu cere rânduri FAN) și e imuabil după prima aprobare. Fără el, garda ține
totul dezactivat; cu el, devin active propunerea, plafonul și lista de evenimente.

| # | Cine | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|
| 1 | owner | „2a. Marchează TEST” → confirmare | „Lot marcat: TEST.”; titlul „LOT DE TEST · PP-xxxx”; banner-ul devine roșu: „TRANSPORT REAL PORNIT pe acest lot de TEST …”; „1. Propune”, „Schimbă plafonul”, „Lista de evenimente FAN” devin active; „2c. Aprobă” rămâne inactiv („niciun plic propus”) |
| 2 | owner | (verificarea din §1, fără cost) „Lista de evenimente FAN” | mesajul cu codurile; în jurnal: lista și diferențele. 503 / 423 → §1 / §11, nu se continuă |

## 6. Plafonul lotului pilot: UN plic, setat, RECITIT din BD, fără aprobări existente (setare existentă, nu cod)

`red_fan_setari.limita_lot` (implicit 20, pus de migrare) limitează plicurile **aprobate** pe lot (`fn_red_fan_aproba`: deja aprobate / trimise +
cele de acum ≤ plafon). Plafonul e global (toate loturile) și **scăderea lui NU retrage aprobări sau trimiteri existente** — de aceea pasul 3 de
mai jos verifică în BD că nu există niciuna.

**Calendarul plafonului, spus o singură dată:** **1** acum (pasul 4a); **3** după verdictul 4a, înaintea lotului de 3 (§8, final); **20** la
încheierea Testului 1 (e precondiția Testului 2, doc §11); **peste 20** doar după Testul 2 (doc §10 pasul 5). Toate din ecran, de owner, cu
recitirea din BD de mai jos. Butonul e activ doar pe lotul marcat TEST (§5), de aceea plafonul se pune după marcaj.

| # | Cine | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|
| 1 | owner | caseta „Plafonul lotului pilot” → `1` → „Schimbă plafonul” → confirmare (RPC `fn_red_fan_setari_seteaza`, cere owner; scrie `actualizat_de` = owner) | mesaj „Plafonul lotului pilot: 1.”; ecranul reîncarcă evidența și caseta arată „Plafonul lotului pilot: 1 plicuri aprobate pe lot” |
| 2 | coordonator | **recitirea din BD** (SQL, doar citire, de mai jos) | `limita_lot = 1`, `actualizat_de` = uuid-ul owner-ului, `actualizat_la` = acum; altceva = oprire |
| 3 | coordonator | **verificarea că NU există aprobări / trimiteri** (SQL de mai jos) | zero rânduri în `red_fan_awb` cu stare în afara `propus` / `eroare` / `anulat` (tabelul e gol din 17.11.2026); în `red_fan_loturi` exact un rând: lotul de test, `test = true`, `prima_aprobare_la IS NULL`; altceva = oprire, se lămurește înainte |

**SQL (coordonatorul, doar citire; nu pune valori):**
```sql
SELECT limita_lot, actualizat_de, actualizat_la FROM public.red_fan_setari;                           -- pasul 2: 1 | <uuid owner> | <acum>
SELECT lot_id, stare, count(*) FROM public.red_fan_awb WHERE stare NOT IN ('propus', 'eroare', 'anulat') GROUP BY 1, 2;   -- pasul 3: 0 rânduri
SELECT lot_id, proiect_id, test, prima_aprobare_la FROM public.red_fan_loturi;                        -- pasul 3: exact lotul de test, true, NULL
SELECT id, cod FROM public.red_proiecte WHERE cod LIKE 'TEST-%';                                      -- rândul (a) din §0: proiectul de test, codul cu TEST-
```
**Aplicare de rezervă (DOAR dacă ecranul nu poate; coordonatorul, cu „da”-ul proprietarului, ca `postgres`; RPC-ul cere JWT de owner, deci
prin psql e scrierea directă, cu autorul explicit):**
```sql
UPDATE public.red_fan_setari SET limita_lot = 1, actualizat_de = '<uuid owner>', actualizat_la = now() WHERE id RETURNING limita_lot, actualizat_la;
```
Și după rezervă, recitirea de la pasul 2 e obligatorie. Aceleași instrucțiuni cu `3` înaintea lotului de 3 și `20` la încheierea testului.

## 7. Pasul 4a (BLOCANT): propunere → aprobare → apelul real → asocierea răspuns ↔ plic

Toate cu proprietarul de față; fiecare rând în jurnal, cu ora. Precondiții bifate: §0 (a), (e), (f); §5; §6.

| # | Cine | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|
| 1 | admin / editor Redări (sau owner-ul) | „1. Propune 1 plicuri” | „Propuse: 1; erori: 0.”; rândul FAN „propus”; „2c. Aprobă” devine activ (owner); „2a. / 2b.” încă active (nicio aprobare) |
| 2 | owner | „2c. Aprobă” → confirmare („Aprobi 1 AWB-uri FAN … Fiecare AWB generat costă”) | „Aprobate: 1.”; „3. Generează AWB” devine activ; „2a. / 2b.” devin inactive (marcajul e fixat de prima aprobare); cu plafonul 1 un lot mai mare ar fi refuzat („peste plafonul lotului pilot (1)”) |
| 3 | owner | **„3. Generează AWB”** → confirmare („Se plătesc.”) — **primul apel real `POST /intern-awb`, o expediere** | mesaj: „Generate: 1; respinse: 0; necunoscute: 0; rămase: 0.” + eventual „Asociate pe poziție (de verificat în selfAWB): 1.” |
| 4 | owner | selfAWB (contul de TEST) → AWB-urile zilei | **un singur AWB nou**, cu numărul plicului (PL-…) la observații / conținut, destinatarul și adresa firmei, tariful |
| 5 | coordonator | ERP: rândul FAN al plicului | stare „AWB generat”, AWB-ul = cel din selfAWB, **tariful = cel din selfAWB ȘI = oferta FAN**. Tarif **gol sau diferit = OPRIRE** (§11): nu se continuă cu eticheta; se lămurește cu FAN / în selfAWB; continuarea cu tarif neconfirmat e o derogare pe care o decide explicit proprietarul (§0) |

**Ce se citește din răspuns și cum se confirmă asocierea (doc §8 deschisă 11, §10 pasul 4a):**
- ERP-ul nu afișează și nu păstrează corpul brut al răspunsului FAN (regula „textele FAN nu intră în evidență”). Ce spune mesajul:
  - **„Asociate pe poziție (de verificat în selfAWB): 1”** = elementul din răspuns NU poartă referința noastră (`observation` / `content`) →
    asocierea s-a făcut pe poziție (presupunerea neconfirmată). Confirmarea: în selfAWB, AWB-ul din ERP are la observații EXACT numărul plicului.
  - fără acest text (asociate pe poziție: 0) = FAN a întors referința pe element și ea a coincis cu plicul → asocierea e **pe referință**.
  - „necunoscute: 1” = răspuns neconfirmat (timeout / formă neașteptată / referință contrazisă) → §11, nu se reapasă.
- Forma completă a elementului (celelalte câmpuri) NU se vede din ERP în această livrare; dacă proprietarul o vrea consemnată, se cere un PR
  mic care să o întoarcă în răspuns DOAR pe loturi de TEST — nu se improvizează din jurnalul funcției.
- **Verdictul 4a se scrie în jurnal** (rândul (g) din §0): „asociere confirmată pe referință” / „asociere pe poziție, confirmată în selfAWB pe 1 AWB” /
  „neconfirmată”. Lotul de 3 (§8, final) pornește DOAR cu unul din primele două verdicte. „Neconfirmată” = Testul 1 se oprește aici; un PR
  reduce bucata la UN plic pe solicitare (`imparteInBucati(…, 1)`, doc §10 pasul 4a) înainte de orice continuare.

## 8. Eticheta: descărcare și verificare

| # | Cine | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|
| 1 | owner | „4. Etichete A6 (PDF)” | se descarcă `TEST_PP-xxxx_tiraj-<ID>_etichete_A6.pdf` (o etichetă) și `TEST_PP-xxxx_tiraj-<ID>_pagina_de_control.docx`; mesaj „Etichete A6, tirajul <ID>: 1 plicuri (pozițiile 1…1).”; caseta „Pagina de control”: „Tiraj: <ID> (nr. 1)” |
| 2 | om | PDF-ul | un PDF real (nu HTML), format A6, AWB-ul = cel din ERP; **numărul plicului (PL-…) e tipărit pe etichetă?** (doc §8 deschisă 12) → în jurnal da / nu. **NU = OPRIRE** (doc §11, Testul 1): nu se tipărește, nu se continuă cu lotul de 3; scrierea de mână pe plic NU e procedura — ar fi o derogare pe care o decide explicit proprietarul, în jurnal, înainte (§0) |
| 3 | om | pagina de control | un rând: poziția 1 · PL-… · AWB · destinatar mascat · nr. documente; tirajul <ID> în titlu; orice nepotrivire cu eticheta = oprire |
| 4 | om | imprimanta termică | eticheta se tipărește lizibil (cod de bare întreg) |
| 5 | owner | „4. Etichete A6 (PDF)” a doua oară | același fișier, același `<ID>` (tirajul nu se schimbă) |

Lotul de 3 (după verdictul 4a, cu plafonul **3** pus și recitit ca în §6): aceiași pași de la §5 la §8 pe lotul PP-yyyy cu 3 plicuri (plicul 2 cu o
localitate inexistentă, ca FAN să-l respingă — doc §11, pașii 1–8), tot cu adrese ale firmei / colegi care acceptă, tot marcat TEST, în aceeași
ordine: marcaj → plafon → propune → aprobă → generează.

## 9. Urmărirea, confirmările, comanda curierului

- „6. Urmărire” imediat după generare: „Urmărire actualizată: 1 AWB-uri.”; starea de urmărire „fără evenimente” sau „în tranzit” (cod + dată în
  ora României). „de verificat de om” = formă de răspuns neașteptată → jurnal (doc §8 deschisă 10), nu se continuă cu urmăriri în buclă.
- „7. Confirmări / retururi”: „Confirmări verificate: 1 AWB-uri.”; așteptat „nicio confirmare încă”. „răspuns de formă necunoscută” → jurnal (deschisa 7).
- Comanda curierului: **manual în selfAWB** (o comandă pe zi, interval ≥ 2 h), DOAR cu decizia explicită a proprietarului (rândul (i) din §0).
  Dacă în Testul 1 NU se vrea ridicarea fizică, nu se comandă curierul și AWB-ul se anulează (§10).
- După ridicare (a doua zi): „6. Urmărire” → „ridicat (C0): de confirmat” → „6b. Confirmă ridicarea (1)” → pe lotul de TEST se marchează DOAR
  evidența FAN (plicul din Poștă NU devine expediat; nu apare în registru / PV / export).

## 10. Anularea AWB-ului de test

Înainte de ridicare (doar de pe borderoul zilei): caseta „Anulare AWB (înainte de ridicare)” → **„Șterge la FAN”** (`DELETE /awb`):
- „AWB șters și anulat: PL-…” → rândul FAN „anulat”; în selfAWB AWB-ul nu mai apare pe borderou. Se notează forma răspunsului de succes
  (doc §8 deschisă 15: codul acceptă doar HTTP 200 + `status: "success"`).
- „Ștergere neconfirmată: AWB-ul rămâne «generat» …” → se verifică în selfAWB; dacă acolo e șters → „Marchează anulat (verificat în selfAWB)”,
  cu motivul; dacă nu e șters → se șterge din selfAWB, apoi același buton.
- „stergere_refuzata” (409) → FAN a refuzat (ex. deja ridicat); rămâne „generat”; se lămurește în selfAWB.
În ERP, pe un lot de TEST, plicul nu e atins în niciun caz (AWB-ul stă doar în `red_fan_awb`). Un AWB șters poate apărea totuși pe factură
(întrebarea deschisă 3): se compară factura contului de test cu evidența.

## 11. Dacă răspunsul nu are forma așteptată sau un rezultat e ambiguu: OPRIRE, nu improvizație

Aceleași opriri ca în doc §11 „Oprire imediată”. Se oprește, se lămurește (selfAWB, BD, jurnal), apoi se reia DOAR de la pasul în cauză — niciodată
„de la capăt” cu o nouă generare. O continuare fără lămurire e derogare: DOAR proprietarul, explicit, în jurnal, înainte (§0).

| Ce se vede | Ce înseamnă | Ce se face |
|---|---|---|
| „necunoscute: 1” / „răspuns FAN neconfirmat” | timeout / 5xx / răspuns ambiguu DUPĂ `POST /intern-awb`: AWB-ul **poate exista** | NU se reapasă „Generează” (al doilea AWB = cost dublu). Se așteaptă 10 minute, apoi caseta „Reconciliere” cu ziua de azi → „Reconciliază”: „găsit: AWB …” → „Confirmă AWB-ul”; „nu apare în borderoul complet” → „Confirmă absența”; „de verificat în selfAWB” → se verifică acolo, fără buton |
| rândul FAN „în curs (trimis la FAN)” după ce ecranul s-a liniștit | rezultatul nu s-a putut scrie în BD după apel (sau cererea încă rulează, §12) | fără reapăsare; după 10 minute reconcilierea de mai sus |
| **tarif gol sau diferit** de selfAWB / de oferta FAN (§7 pasul 5) | tariful nu e confirmat | **OPRIRE**: nicio etichetă, niciun lot de 3; se lămurește cu FAN; continuarea = derogare a proprietarului |
| **referința (numărul plicului) absentă de pe etichetă** (§8 pasul 2) | eticheta nu poate fi verificată față de pagina de control (doc §12) | **OPRIRE**: nu se tipărește, nu se continuă; scrierea de mână NU e procedura; continuarea = derogare a proprietarului |
| „respinse: 1” cu câmpuri semnalate | FAN a refuzat elementul (adresă / telefon) | se corectează contactul, „Propune” din nou (hash nou), „Aprobă”, „Generează”; nimic plătit pe el |
| `eticheta_neconfirmata` (502) | răspunsul etichetei nu e PDF | nimic descărcat; jurnal; se reîncearcă o singură dată mai târziu |
| `tiraj_schimbat` / `tiraj_oprit` | manifestul s-a schimbat de la prima descărcare | procedura „Tiraj nou” din ecran (oprește → 30 s → distruge foile → înlocuiește); nu la pasul 4a cu un singur plic |
| `urmarire_neconfirmata` / „de verificat de om” | formă de răspuns neașteptată la urmărire | nimic scris; jurnal (deschisa 10); se continuă doar după lămurire |
| orice nepotrivire etichetă ↔ pagina de control ↔ selfAWB ↔ BD | asocierea sau tirajul nu sunt sigure | **OPRIRE**; se lămurește în selfAWB; nimic tipărit / plicuit |
| `transport_real_doar_test` | lotul nu e pe `TEST-` sau nu e marcat TEST | se verifică lotul; NU se marchează nimic pe proiecte reale |
| `transport_neconfigurat` / `autentificare_fan_neconfirmata` | secretele | §1 |
| orice eroare neconfirmată („Rezultat neconfirmat: reîncarcă evidența…”) | rețea / BD | se reîncarcă evidența ÎNAINTE de orice reluare |

Regula tare: un rezultat neclar se lămurește în selfAWB și în jurnal; nu se „mai apasă o dată”.

## 12. Oprirea de urgență: ce oprește, ce NU oprește, cererile în curs; ce rămâne în bază

**Cum funcționează cererea** (`redariFanTransport.mjs`, `executaActiuneFan`): secretele se citesc **o dată, la începutul fiecărei cereri**, înaintea
oricărei alte operații; cererea continuă apoi cu valorile capturate (inclusiv tokenul FAN obținut la `POST /login`) până la final — rezervarea în BD,
`POST /intern-awb`, scrierea rezultatului. Durata maximă a unei generări: cel mult 5 solicitări × (30 s timeout + 2 s pauză) ≈ 3 minute; la un plic,
sub un minut.

| Măsura | Ce oprește | Ce NU oprește |
|---|---|---|
| **Ștergerea celor trei secrete** (Supabase → Edge Functions → Secrets; fără cod) | orice cerere NOUĂ: 503 `transport_neconfigurat`, fără niciun apel la curier | **o cerere deja începută**: continuă cu secretele capturate și poate crea AWB-ul |
| **Ștergerea funcției** `redari-fan-awb` din Supabase | cererile noi (ecranul arată eroare, nimic chemat) | o cerere în curs poate fi întreruptă în orice punct (rezultat NECUNOSCUT: AWB creat la FAN fără rezultat scris, rând „în curs”) |
| **Comutatorul în cod** (PR cu `TRANSPORT_REAL_ACTIV = false` + testele înapoi pe `false`; testul „comutatorul oprit” din `fanCourierMutanti.test.js` descrie exact comportamentul) → merge → „Deploy edge function (manual)” | cererile noi după publicare: 423 `transport_real_oprit`, ecranul „Transport oprit” | o cerere în curs pe versiunea veche; o solicitare deja trimisă la FAN (AWB-ul creat rămâne creat: se anulează din §10 / selfAWB) |

**Cererile în curs la momentul opririi** (regula L05: ambiguu = necunoscut, nu se repetă):
1. **fără reapăsare** pe nimic; se așteaptă liniștirea ecranului (cel mult ~3 minute) și NU se închide ecranul ca „să oprească” (închiderea oprește
   doar afișarea, nu cererea din funcția edge);
2. **verificarea rezultatului în BD** (coordonator, doar citire): `SELECT nr_plic, stare, awb, tarif_estimat FROM public.red_fan_awb WHERE lot_id = '<uuid lot>';`
   → `generat` / `eroare` = rezultat scris (cererea s-a încheiat); `in_curs` = solicitarea a fost rezervată și poate fi trimisă, fără rezultat scris;
   `necunoscut` = răspuns neconfirmat;
3. **verificarea în contul curierului** (proprietar): selfAWB, contul de TEST, AWB-urile zilei: există un AWB cu numărul plicului la observații?
4. **reconciliere dacă rămâne ambiguu** (`in_curs` / `necunoscut`, sau selfAWB ≠ BD): după 10 minute, caseta „Reconciliere” (§11, primul rând).
   Reconcilierea citește borderoul zilei prin funcția edge (fără cost, dar cere secretele și comutatorul): dacă secretele au fost șterse, proprietarul
   le repune pentru reconciliere și le șterge din nou după, dacă oprirea rămâne. Un AWB găsit se confirmă („Confirmă AWB-ul”) și apoi se anulează (§10)
   dacă nu se vrea transport.
Nimic din evidență nu se șterge și nu se „repară” de mână în BD.

**Ce rămâne în bază după test** (evidență, nu se șterge): rândurile din `red_fan_awb` (stări generat / anulat / eroare, AWB, tarif),
`red_fan_loturi` (marcajul TEST, prima aprobare, tirajul), `red_fan_setari.limita_lot` (calendarul din §6: 20 la încheierea Testului 1), evenimentele
de tiraj în `red_jurnal`. Plicurile și convocările de pe `TEST-RAZVAN` rămân neatinse (lot de TEST: nimic scris pe plic). Revenirea migrării
(`20261212a_…_ROLLBACK.sql`) **refuză** cu aceste date (doc §7): tabelele rămân.

**Trecerea la Testul 2** (după acceptarea Testului 1 și „da”-ul juridic): PR separat, revizuit, cu `DOAR_PROIECTE_TEST = false` (lotul real
rămâne păzit de marcajul owner-ului și de plafonul pilot), + registrul de automatizări și rândul din `public.automatizari` (doc §10 pasul 5).

## 13. Ce NU se poate verifica fără apelul real și riscul care rămâne la primul apel

**Nu se poate verifica în prealabil** (toate cu pas de oprire mai sus): forma elementului din răspunsul `POST /intern-awb` (referința pe element —
deschisa 11), dacă eticheta A6 tipărește numărul plicului (12), formele răspunsurilor la urmărire / confirmări / ștergere / borderou (7, 10, 15, 16),
dacă AWB-urile contului de TEST se facturează (3), limita de solicitări pe minut (2), potrivirea adresei firmei cu nomenclatorul FAN (validarea
cu nomenclatorul nu e în cod: un refuz vine ca „respins de FAN” cu câmpurile semnalate), și că apelul din ecran trece de `verify_jwt = true`
(precedent în repo: `sms-trimite`, `polita-citeste`; dacă nu trece, probele din §3 cu `curl` merg oricum, iar soluția e lista `NO_JWT`, PR separat).

**Riscul care rămâne la primul apel și ce îl ține mic:**
- **Cost**: un AWB pe contul de TEST (tariful vine în răspuns; pe factură dacă FAN facturează contul de test). Ținut mic de: plafonul 1 (setat și
  recitit, §6), aprobarea owner-ului pe hash, confirmarea „Se plătesc”, o singură solicitare cu o expediere.
- **Expediere reală creată din greșeală**: dacă secretele ar fi ale contului REAL al firmei, AWB-ul ar fi real (pe borderoul firmei, facturat).
  Ținut mic de: rândul (e) din §0 (login în selfAWB cu aceleași credențiale = contul de TEST), destinatarul = adresa firmei (un plic trimis greșit
  ajunge tot la noi), fără comandă de curier prin API, anularea din §10 înainte de ridicare.
- **Date trimise curierului**: numele deținătorului de test (fictiv), telefonul și adresa firmei, numărul plicului, codul `TEST-RAZVAN`. Nicio
  dată personală a unui terț. Răspunsurile FAN nu se păstrează ca text (doar stări, AWB, tarif, câmpurile semnalate).
- **Dublare**: un „necunoscut” urmat de reapăsare ar face al doilea AWB — de aceea regula din §11 (reconciliere, nu reapăsare); claim-ul din BD
  oprește oricum rândurile deja trimise (doar „aprobat” se rezervă).
- **Proiect greșit**: garda `DOAR_PROIECTE_TEST` + marcajul TEST (imuabil după prima aprobare) → un lot real primește 423 chiar cu comutatorul pornit
  (testat: `fanCourier.test.js`, `fanCourierMutanti.test.js` — 6 mutanți ai gărzii prinși, comportamentul cu comutatorul oprit neschimbat). Rămâne
  riscul din §0: convenția `TEST-` nu e imuabilă — de aceea rândurile (a) și (b) sunt obligatorii.
- **Oprirea de urgență nu e instantanee** (§12): oprește cererile noi, nu una deja începută.
