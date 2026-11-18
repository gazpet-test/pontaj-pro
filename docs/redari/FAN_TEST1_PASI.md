# FAN Courier în Redări — Testul 1: lista de pași pentru dimineața activării

Document operațional, de parcurs **pas cu pas de coordonator împreună cu proprietarul**, cu bifă pe fiecare rând și un **jurnal al testului**
(un fișier text ținut de coordonator, în afara repo-ului: ora, pasul, ce s-a văzut, ce s-a decis). Proiectarea întreagă: `FANCOURIER_INTEGRARE.md`
(§10 lista de activare, §11 criteriile de acceptare ale Testului 1). **Acesta e singurul document care dă ORDINEA pașilor** (o singură definiție,
runda 3): documentul de proiectare nu o mai repetă. Nimic de aici nu se improvizează: la orice abatere se oprește (§12 de mai jos) și se notează.

**Ordinea pașilor e cea pe care ecranul o permite** (runda 2, verdictul recenzentului pe PR #1130): cât garda „doar TEST” e pornită, pe un lot
NEmarcat sunt active DOAR „2a. Marchează TEST” (owner, proiect `TEST-…`) și nimic altceva — nici „Propune”, nici plafonul. De aceea ordinea e:
**lotul cu UN plic pregătit (§3) → probele 401 / 403 / 423 (§4) → marcajul TEST (§5) → plafonul 1 + recitirea din BD + verificarea inițială
globală (§6) → propunere → aprobare → generare → verificarea în selfAWB și a tarifului (§7) → etichetă (§8) → lotul de 3 (§9: lot NOU marcat
TEST, plafonul 3 recitit, verificările lotului nou cu istoricul primului lot numit explicit, apoi propune → aprobă → generează → etichete) →
urmărire / comanda curierului / încheierea cu plafonul 20 (§10) → anularea (§11)**. Runda 3 (al doilea verdict): continuarea cu trei plicuri
NU mai „repetă §5–§8” — verificarea globală din §6 (zero aprobări / trimiteri, un singur lot marcat) nu mai poate trece după primul AWB, pentru
că istoricul primului lot rămâne în bază (și după anulare); lotul de 3 are verificările lui (§9 pasul 4).

**Coloana „Acțiune” a tabelelor de pași (§5–§10)** e identificatorul stabil al fiecărui pas; textul din „Ce apasă” și „Ce trebuie să vadă” e liber.
Butoane: `marcaj-test`, `evenimente`, `plafon=N`, `propune`, `aproba`, `genereaza`, `etichete`. Verificări fără buton (precondiții ale pașilor
următori): `verifica-plafon=N` (recitirea din BD), `verifica-fara-aprobari` (verificarea inițială globală — o singură dată, înaintea primului plic),
`verifica-lot-nou` (lotul de 3: lotul nou gol și marcat, istoricul primului lot exact cel așteptat), `verifica-selfawb`, `verifica-tarif`,
`verifica-eticheta`, `verifica-control`, `tipareste`. Testul `fanCourier.test.js` („procedura Testului 1 din document”) citește coloana, parcurge
AMBELE loturi și încheierea, de la lot gol, pe funcțiile reale ale ecranului (`stariPasi` / `stareMarcaj` / `stariOperatii`), și pică dacă: un
buton nu e activ în momentul lui; aprobarea vine fără recitirea plafonului sau fără verificarea de dinainte; recitirea cere alt plafon decât cel
pus; verificarea globală e repetată după primul AWB; eticheta vine înaintea tarifului confirmat; tipărirea, înaintea verificării etichetei și a
paginii de control. Documentele vechi (9ceea228, 9fb88b2f) pică în același simulator (`fanCourierMutanti.test.js`).

**Ce aduce PR-ul de activare (acest PR), în cod:** `TRANSPORT_REAL_ACTIV = true` + garda **`DOAR_PROIECTE_TEST = true`** în
`supabase/functions/_shared/redariFanHandler.mjs`: funcția edge `redari-fan-awb` ajunge la curier DOAR pe un lot al unui proiect al cărui cod
începe cu `TEST-` (aceeași convenție ca SMS-urile Redări) ȘI marcat **TEST** de owner (`red_fan_loturi.test`, imuabil după prima aprobare —
trigger în BD). Orice alt lot primește **423 `transport_real_doar_test`** înainte de secrete și de orice apel; ecranul arată același motiv pe
fiecare buton. Cu `TRANSPORT_REAL_ACTIV = false` comportamentul e exact cel de dinainte (423 `transport_real_oprit`, fără nicio citire în plus).
Plafoanele (UN plic la pasul 4a, apoi 3 la 4b, 20 la încheiere) NU sunt cod nou: sunt setarea existentă `red_fan_setari.limita_lot` (§6 de mai jos).

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
| a | proprietarul | **ID-ul proiectului** de test, **ID-urile celor două loturi** de test (PP-xxxx cu UN plic, §3; PP-yyyy cu trei, §9), **codul** (`TEST-RAZVAN`, exact, fără spații) și **conținutul fictiv** (deținătorii de test, contactele = datele firmei sau ale unor colegi care acceptă; niciun deținător real în loturi) — citite din ERP și din SQL-ul de previzualizare (§6, A4), scrise în jurnal | înainte de §5 (PP-xxxx) și de §9 (PP-yyyy) |
| b | toți | **pe durata testului nu se redenumesc proiecte și nu se schimbă marcaje de lot** (nimeni nu editează `red_proiecte.cod`, nimeni nu apasă „Marchează” pe alt lot); coordonatorul anunță colegii cu drept de admin Redări | toată ziua |
| c | coordonatorul | **commit-ul publicat** identificat: SHA-ul de pe `main` de după îmbinare = versiunea funcției edge din Supabase (§2) | înainte de §4 |
| d | coordonatorul | **probele 401 / 403 / 423 pe versiunea INERTĂ** (cea de pe `main` ÎNAINTE de îmbinarea acestui PR: 423 `transport_real_oprit`) — dacă nu au fost făcute la publicarea cu flag-ul `false` (doc §10 pasul 3b), **OPRIRE înaintea îmbinării acestui PR**: se fac întâi ele (§2 pasul 0), pe forma inertă publicată de pe `main`-ul de dinaintea îmbinării; după publicarea formei activate nu mai pot fi făcute. Apoi **din nou după activare** (§4) | înainte de §2 (înaintea îmbinării), respectiv înainte de §5 |
| e | proprietarul | **contul de TEST al curierului, `clientId`-ul lui și costurile**: confirmare explicită, în jurnal, că secretele sunt ale contului de TEST (login în selfAWB cu aceleași credențiale), că `FAN_CLIENT_ID` e punctul de lucru al acelui cont și că acceptă costul eventual al AWB-urilor de test (răspunsul FAN la deschisa 3 în jurnal) | înainte de §7 |
| f | proprietarul | **plafonul 1 setat ȘI recitit din BD, verificarea inițială globală trecută** (§6); pentru lotul de 3: **plafonul 3 setat ȘI recitit, verificările lotului NOU trecute** (§9 pașii 2–4) | înainte de §7, respectiv de §9 pasul 5 |
| g | proprietarul | **asocierea AWB ↔ plic verificată în selfAWB** pe primul AWB (verdictul 4a în jurnal) ÎNAINTE de lotul de 3 | după §7, înainte de §9 |
| h | toți | **oprire la orice rezultat ambiguu** (§12): „necunoscut”, tarif neconfirmat, nepotrivire etichetă / selfAWB / BD, formă neașteptată; nimic nu se „mai apasă o dată” | toată ziua |
| i | proprietarul | **anularea AWB-urilor înainte de ridicare** (§11) dacă nu se vrea transport fizic; altfel decizia explicită de a comanda curierul | sfârșitul zilei |

**Derogări**: orice continuare după un rezultat care cere oprire (§12) o decide DOAR proprietarul, explicit, scrisă în jurnal (ora, ce anume, de ce)
ÎNAINTE de pasul următor. Coordonatorul nu decide singur și nu „notează pentru mai târziu”.

## 1. Secretele funcției edge și contul curierului (proprietarul; coordonatorul verifică DOAR existența)

Supabase → Edge Functions → Secrets. Doar **numele** de mai jos; valorile le pune proprietarul, nu se scriu nicăieri (nici în jurnal, nici în chat):

| Secret | Ce e | Verificare fără expediere |
|---|---|---|
| `FAN_SELFAWB_USERNAME` | utilizatorul contului de **TEST** indicat de FAN | proprietarul se loghează cu el în selfAWB și confirmă că e contul de TEST (nu contul firmei) |
| `FAN_SELFAWB_PASSWORD` | parola aceluiași cont | idem (login reușit în selfAWB) |
| `FAN_CLIENT_ID` | ID-ul punctului de lucru (clientId) **al contului de TEST** | în selfAWB, la punctul de lucru al contului de test; un clientId al contului real = expedieri reale |

Verificarea **din ERP, fără expediere** (după §2, §4 și §5, pe lotul de TEST marcat): owner-ul apasă **„Lista de evenimente FAN”** (acțiunea
`evenimente`): face `POST /login` + `GET /reports/awb-events` (fără cost). Rezultate:
- mesaj cu „Coduri lipsă la FAN: …; coduri FAN neclasificate: …” → secretele sunt bune și contul răspunde; se notează în jurnal lista
  (diferențele intră în `EVENIMENTE_FAN` printr-un PR mic, ÎNAINTE de prima urmărire reală — doc §10 pasul 4);
- `transport_neconfigurat` (503) → lipsește un secret (numele de mai sus, exact);
- `autentificare_fan_neconfirmata` (503) → utilizator / parolă greșite sau FAN indisponibil; nu se reîncearcă în buclă (se verifică în selfAWB);
- `transport_real_doar_test` (423) → lotul nu e pe un proiect `TEST-` sau nu e marcat TEST (§5).

**Întrebarea deschisă 3 (doc §8), de lămurit cu FAN ÎNAINTE de §7:** se facturează AWB-urile create cu contul de test? Răspunsul (în scris) în
jurnal. Dacă răspunsul arată un cost: se oprește și decide proprietarul (regula din doc §11: contul nu se schimbă de aici) — rândul (e) din §0.

## 2. Publicarea funcției edge (coordonatorul, după merge-ul acestui PR în `main`)

0. **ÎNAINTE de îmbinarea acestui PR — probele pe forma INERTĂ** (rândul (d) din §0). Dacă există deja în jurnal (publicarea cu flag-ul `false`, doc §10 pasul 3b), se trece la pasul 1. Dacă LIPSESC: **OPRIRE, PR-ul nu se îmbină încă**. Se pregătește întâi lotul din §3 (§3 nu depinde de publicare), se publică funcția de pe `main`-ul actual (același workflow ca la pasul 1; în Code: `TRANSPORT_REAL_ACTIV = false`), se fac probele din §4 cu așteptările formei inerte (la 3 și 3b: 423 `transport_real_oprit`) și se trec în jurnal cu versiunea și SHA-ul. Abia apoi îmbinarea și pasul 1. După publicarea formei activate, `transport_real_oprit` nu mai poate fi dovedit.
1. După îmbinare: GitHub → Actions → **„Deploy edge function (manual)”** → `slug` = `redari-fan-awb` → Run workflow (de pe `main`).
   Funcția NU e în lista `NO_JWT` a workflow-ului → se publică cu `verify_jwt = true` (poarta platformei + poarta owner din cod). Apelul din
   ecran (`supabase.functions.invoke`) merge așa, ca la `sms-trimite` și `polita-citeste`.
2. **Identificarea commit-ului publicat** (rândul (c) din §0): `git rev-parse origin/main` după îmbinare = SHA-ul din pasul „Rezumat repo vs
   producție” al workflow-ului; Supabase → Edge Functions → `redari-fan-awb` → **versiunea** (crește cu 1 față de publicarea inertă). Se notează
   în jurnal: data, ora, versiunea, SHA-ul. Un SHA diferit de `main` = oprire (s-a publicat altceva).
3. Verificare că e forma ACTIVATĂ: în Supabase → Edge Functions → `redari-fan-awb` → Code, `redariFanHandler.mjs` conține
   `TRANSPORT_REAL_ACTIV = true` și `DOAR_PROIECTE_TEST = true`.

## 3. Lotul de test cu UN plic, pe `TEST-RAZVAN` (date ale firmei, fără date personale ale terților)

În ERP, pe proiectul `TEST-RAZVAN` (codul trebuie să înceapă cu `TEST-`, altfel garda refuză; ID-ul proiectului și al lotului = rândul (a) din §0):
1. Un deținător de test (nume fictiv, ex. „TEST GAZPET PLIC UNU”), cu contactul = **datele firmei**: telefon = telefonul firmei (obligatoriu la FAN),
   strada + nr. = adresa sediului, localitate = Ploiești, județ = Prahova, cod poștal = al sediului. Nicio adresă / telefon al unei persoane.
2. O convocare poștală activă pentru el, cu documentele generate, apoi plicuirea → un **lot de plicuire nou (PP-xxxx) cu EXACT un plic**, activ,
   fără AWB, fără dată de expediere, cu opisul atașat (doc §11, „Înainte”, (c)).
3. ✉️ Poștă → lotul → **„📦 AWB FAN”**: previzualizarea arată „1 din 1 plicuri au toate datele cerute de FAN” și „referința pe etichetă: PL-…”.
   Dacă lipsește ceva (telefon, județ, stradă) se completează pe contact, nu se forțează.
4. **Doar pe forma ACTIVATĂ (după §2 pasul 1).** Dacă §3 se face înaintea îmbinării, pentru probele inerte (§2 pasul 0), pregătirea se oprește la pasul 3: pe forma inertă toate operațiile FAN din ecran sunt dezactivate („transport real oprit”), nu există banner-ul activării și nu se apasă nimic; pasul 4 se verifică după publicarea formei activate, înainte de §5. Banner-ul de sus: „Activare de TEST (Testul 1): transport doar pe loturi marcate TEST …” (lotul încă nemarcat). **În acest moment singurul
   buton activ e „2a. Marchează TEST”**: „1. Propune”, „2c. Aprobă”, „Schimbă plafonul” și restul sunt dezactivate cu motivul gărzii; „2b. Marchează real”
   e dezactivat cât garda „doar TEST” e pornită (corecție după proba din 18.11.2026, când era activ alături de 2a). Lotul rămâne
   NEMARCAT până la §5 (nu se apasă nimic aici): el e **L_NEMARCAT** din probele de la §4.

Ce pleacă la curier pentru acest plic (doc §2): numele deținătorului de test, telefonul și adresa firmei, numărul plicului (`content` /
`observation`), centrul de cost = `TEST-RAZVAN`, plic 1 kg, 32×24×1 cm, **fără oPOD** (din 18.11.2026: bifa „Confirmare de primire în original
(oPOD, +14 lei / plic)” e nebifată implicit — confirmarea de primire e cea electronică, de pe terminalul curierului; oPOD doar dacă owner-ul îl
bifează pe lot, după marcaj și înainte de prima aprobare — decizia proprietarului din 09.11 + 18.11.2026; primul AWB real plecase cu oPOD și a
costat 27,16 lei în loc de 13,16), plătește expeditorul. Dialogul de la „2c. Aprobă” spune explicit „FĂRĂ oPOD” sau „oPOD CERUT” cu costul estimat.

## 4. Probele 401 / 403 / 423 (coordonatorul, de pe server, cu `curl`; nimic nu ajunge la curier)

Se fac de DOUĂ ori (rândul (d) din §0): **pe versiunea INERTĂ**, ÎNAINTEA îmbinării acestui PR (§2 pasul 0; așteptat la pașii 3 și 3b: 423
`transport_real_oprit`); apoi, aici, **pe versiunea activată** (așteptările de mai jos). Ambele seturi în jurnal. Dacă setul inert lipsește din
jurnal în acest punct = OPRIRE (§12): forma activată e deja publicată, proba inertă nu mai poate fi recuperată fără revenirea la forma inertă.

`<URL>` = adresa proiectului Supabase, `<ANON>` = cheia publică (anon). JWT-urile se iau din sesiunea contului respectiv (browser → DevTools →
Application → Local Storage → cheia `sb-…-auth-token` → `access_token`; expiră în ~1 oră) și **nu se scriu nicăieri** (nici în jurnal).

Loturile folosite la probe: **L_NEMARCAT** = lotul PP-xxxx din §3 (încă fără rând în `red_fan_loturi`: marcajul vine abia la §5);
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
Un rezultat diferit la oricare = oprire (§12).

## 5. Marcajul TEST al lotului (owner; lotul e încă GOL în evidența FAN)

Marcajul se pune pe lotul gol (RPC-ul `fn_red_fan_lot_marcheaza` nu cere rânduri FAN) și e imuabil după prima aprobare. Fără el, garda ține
totul dezactivat; cu el, devin active propunerea, plafonul și lista de evenimente.

| # | Cine | Acțiune | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|---|
| 1 | owner | `marcaj-test` | „2a. Marchează TEST” → confirmare | „Lot marcat: TEST.”; titlul „LOT DE TEST · PP-xxxx”; banner-ul devine roșu: „TRANSPORT REAL PORNIT pe acest lot de TEST …”; „1. Propune”, „Schimbă plafonul”, „Lista de evenimente FAN” devin active; „2c. Aprobă” rămâne inactiv („niciun plic propus”) |
| 2 | owner | `evenimente` | (verificarea din §1, fără cost) „Lista de evenimente FAN” | mesajul cu codurile; în jurnal: lista și diferențele. 503 / 423 → §1 / §12, nu se continuă |

## 6. Plafonul lotului pilot: UN plic, setat, RECITIT din BD, și verificarea inițială GLOBALĂ (o singură dată, înaintea primului plic)

`red_fan_setari.limita_lot` (implicit 20, pus de migrare) limitează plicurile **aprobate** pe lot (`fn_red_fan_aproba`: deja aprobate / trimise
pe acel lot + cele de acum ≤ plafon). Valoarea plafonului e globală (toate loturile), numărătoarea e pe lot, și **scăderea lui NU retrage aprobări
sau trimiteri existente** — de aceea pasul 3 de mai jos verifică în BD, GLOBAL, că nu există niciuna. **Această verificare globală se face o
singură dată, aici, înaintea primului plic**: după primul AWB istoricul lotului PP-xxxx rămâne în `red_fan_awb` și `red_fan_loturi` (și după
anulare), deci condițiile ei nu mai pot trece și NU se repetă; lotul de 3 are verificările lui (§9 pasul 4).

**Calendarul plafonului, spus o singură dată:** **1** acum (pasul 4a); **3** după verdictul 4a, înaintea lotului de 3 (§9 pasul 2); **20** la
încheierea Testului 1 (§10, ultimul tabel; e precondiția Testului 2, doc §11); **peste 20** doar după Testul 2 (doc §10 pasul 5). Toate din ecran,
de owner, cu recitirea din BD. Butonul e activ doar pe lotul marcat TEST (§5), de aceea plafonul se pune după marcaj.

| # | Cine | Acțiune | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|---|
| 1 | owner | `plafon=1` | caseta „Plafonul lotului pilot” → `1` → „Schimbă plafonul” → confirmare (RPC `fn_red_fan_setari_seteaza`, cere owner; scrie `actualizat_de` = owner) | mesaj „Plafonul lotului pilot: 1.”; ecranul reîncarcă evidența și caseta arată „Plafonul lotului pilot: 1 plicuri aprobate pe lot” |
| 2 | coordonator | `verifica-plafon=1` | **recitirea din BD** (SQL A1, doar citire) | `limita_lot = 1`, `actualizat_de` = uuid-ul owner-ului, `actualizat_la` = acum; altceva = oprire |
| 3 | coordonator | `verifica-fara-aprobari` | **verificarea inițială globală** (SQL A2 și A3) | A2: zero rânduri (nicio aprobare / trimitere, în niciun lot; tabelul e gol din 17.11.2026); A3: exact un rând — lotul PP-xxxx, `test = true`, `prima_aprobare_la IS NULL`, `tiraj_nr = 0`; altceva = oprire, se lămurește înainte |

**SQL (coordonatorul, doar citire; nu pune valori):**
```sql
-- A1 (pasul 2): 1 | <uuid owner> | <acum>
SELECT limita_lot, actualizat_de, actualizat_la FROM public.red_fan_setari;
-- A2 (pasul 3): 0 rânduri — nicio aprobare / trimitere, în niciun lot
SELECT lot_id, stare, count(*) FROM public.red_fan_awb WHERE stare NOT IN ('propus', 'eroare', 'anulat') GROUP BY 1, 2;
-- A3 (pasul 3): exact un rând — lotul PP-xxxx | proiectul de test | true | NULL | 0
SELECT lot_id, proiect_id, test, prima_aprobare_la, tiraj_nr FROM public.red_fan_loturi;
-- A4 (rândul (a) din §0): proiectul de test, codul cu TEST-
SELECT id, cod FROM public.red_proiecte WHERE cod LIKE 'TEST-%';
```
**Aplicare de rezervă (DOAR dacă ecranul nu poate; coordonatorul, cu „da”-ul proprietarului, ca `postgres`; RPC-ul cere JWT de owner, deci
prin psql e scrierea directă, cu autorul explicit):**
```sql
UPDATE public.red_fan_setari SET limita_lot = 1, actualizat_de = '<uuid owner>', actualizat_la = now() WHERE id RETURNING limita_lot, actualizat_la;
```
Și după rezervă, recitirea de la pasul 2 e obligatorie. Aceleași instrucțiuni cu `3` la §9 (pașii 2–3) și cu `20` la §10 (încheierea).

## 7. Pasul 4a (BLOCANT): propunere → aprobare → apelul real → asocierea răspuns ↔ plic

Toate cu proprietarul de față; fiecare rând în jurnal, cu ora. Precondiții bifate: §0 (a), (e), (f); §5; §6.

| # | Cine | Acțiune | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|---|
| 1 | admin / editor Redări (sau owner-ul) | `propune` | „1. Propune 1 plicuri” | „Propuse: 1; erori: 0.”; rândul FAN „propus”; „2c. Aprobă” devine activ (owner); „2a.” încă activă (nicio aprobare); „1. Propune” devine inactiv („nimic de propus”: plicul e deja propus cu datele de acum); „2b. Marchează real” rămâne dezactivat cât garda „doar TEST” e pornită (18.11.2026) |
| 2 | owner | `aproba` | „2c. Aprobă” → confirmare („Aprobi 1 AWB-uri FAN … Fiecare AWB generat costă … FĂRĂ oPOD: confirmarea de primire e cea electronică” — dacă dialogul spune „oPOD CERUT”, bifa oPOD e pusă: se renunță la ea întâi, altfel plicul costă +14 lei) | „Aprobate: 1.”; „3. Generează AWB” devine activ; „2a.” și bifa oPOD devin inactive (marcajul și alegerea oPOD sunt fixate de prima aprobare); cu plafonul 1 un lot mai mare ar fi refuzat („peste plafonul lotului pilot (1)”) |
| 3 | owner | `genereaza` | **„3. Generează AWB”** → confirmare („Se plătesc.”) — **primul apel real `POST /intern-awb`, o expediere** | mesaj: „Generate: 1; respinse: 0; necunoscute: 0; rămase: 0.” + eventual „Asociate pe poziție (de verificat în selfAWB): 1.”; „1. Propune” rămâne inactiv („nimic de propus”: plicul are AWB) |
| 4 | owner | `verifica-selfawb` | selfAWB (contul de TEST) → AWB-urile zilei | **un singur AWB nou**, cu numărul plicului (PL-…) la observații / conținut, destinatarul și adresa firmei, tariful. **Verdictul 4a** (asocierea, mai jos) se scrie acum în jurnal |
| 5 | coordonator | `verifica-tarif` | ERP: rândul FAN al plicului | stare „AWB generat”, AWB-ul = cel din selfAWB; tariful e afișat în ecran lângă AWB (lei, 2 zecimale, fără TVA; TVA-ul alături, dacă a venit) și în rândul „Tarif FAN pe lot” (totalul lotului; 18.11.2026); **tariful = cel din selfAWB ȘI = oferta FAN**. Tarif **gol sau diferit = OPRIRE** (gol = „tarif necunoscut”, evidențiat roșu în ecran; §12): nu se continuă cu eticheta; se lămurește cu FAN / în selfAWB; continuarea cu tarif neconfirmat e o derogare pe care o decide explicit proprietarul (§0) |

**Ce se citește din răspuns și cum se confirmă asocierea (doc §8 deschisă 11, §10 pasul 4a):**
- ERP-ul nu afișează și nu păstrează corpul brut al răspunsului FAN (regula „textele FAN nu intră în evidență”). Ce spune mesajul:
  - **„Asociate pe poziție (de verificat în selfAWB): 1”** = elementul din răspuns NU poartă referința noastră (`observation` / `content`) →
    asocierea s-a făcut pe poziție (presupunerea neconfirmată). Confirmarea: în selfAWB, AWB-ul din ERP are la observații EXACT numărul plicului.
  - fără acest text (asociate pe poziție: 0) = FAN a întors referința pe element și ea a coincis cu plicul → asocierea e **pe referință**.
  - „necunoscute: 1” = răspuns neconfirmat (timeout / formă neașteptată / referință contrazisă) → §12, nu se reapasă.
- Forma completă a elementului (celelalte câmpuri) NU se vede din ERP în această livrare; dacă proprietarul o vrea consemnată, se cere un PR
  mic care să o întoarcă în răspuns DOAR pe loturi de TEST — nu se improvizează din jurnalul funcției.
- **Verdictul 4a se scrie în jurnal** (rândul (g) din §0): „asociere confirmată pe referință” / „asociere pe poziție, confirmată în selfAWB pe 1 AWB” /
  „neconfirmată”. Lotul de 3 (§9) pornește DOAR cu unul din primele două verdicte. „Neconfirmată” = Testul 1 se oprește aici; un PR
  reduce bucata la UN plic pe solicitare (`imparteInBucati(…, 1)`, doc §10 pasul 4a) înainte de orice continuare.

## 8. Eticheta primului plic: descărcare și verificare

| # | Cine | Acțiune | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|---|
| 1 | owner | `etichete` | „4. Etichete (PDF)” | se descarcă `TEST_PP-xxxx_tiraj-<ID>_etichete.pdf` (o etichetă) și `TEST_PP-xxxx_tiraj-<ID>_pagina_de_control.docx`; mesaj „Etichete PDF, tirajul <ID>: 1 plicuri (pozițiile 1…1). Formatul paginii (cerut: A6) se verifică pe PDF înainte de tipărire.”; caseta „Pagina de control”: „Tiraj: <ID> (nr. 1)” |
| 2 | om | `verifica-eticheta` | PDF-ul | un PDF real (nu HTML); **formatul paginii se notează în jurnal** (ERP-ul cere curierului A6 — parametrul `format` din documentația lui —, dar la proba din 18.11.2026 PDF-ul a venit A4: întrebare deschisă pentru curier, doc §8 deschisă 17; pe A4 imprimanta termică nu e de folos, decizia de tipărire e a proprietarului); AWB-ul = cel din ERP; **numărul plicului (PL-…) e tipărit pe etichetă?** (doc §8 deschisă 12) → în jurnal da / nu. **NU = OPRIRE** (doc §11, Testul 1): nu se tipărește, nu se continuă cu lotul de 3; scrierea de mână pe plic NU e procedura — ar fi o derogare pe care o decide explicit proprietarul, în jurnal, înainte (§0) |
| 3 | om | `verifica-control` | pagina de control | un rând: poziția 1 · PL-… · AWB · destinatar mascat · nr. documente; tirajul <ID> în titlu; orice nepotrivire cu eticheta = oprire |
| 4 | om | `tipareste` | imprimanta termică | eticheta se tipărește lizibil (cod de bare întreg) |
| 5 | owner | `etichete` | „4. Etichete (PDF)” a doua oară | același fișier, același `<ID>` (tirajul nu se schimbă) |

## 9. Pasul 4b: lotul de 3 plicuri — lot NOU, după verdictul 4a (plafonul 3, verificările lotului nou, apoi propune → aprobă → generează → etichete)

**Pornește DOAR dacă** (toate în jurnal): verdictul 4a e „asociere confirmată pe referință” sau „pe poziție, confirmată în selfAWB” (§7); tariful
primului AWB e confirmat (§7 pasul 5); eticheta primului plic poartă numărul plicului (§8 pasul 2); rândurile (f) și (g) din §0 sunt bifate.
Altfel Testul 1 se oprește după primul plic (§7, „neconfirmată”).

**Pregătirea lotului nou** (ca la §3, înainte de tabel): trei deținători de test (nume fictive), cu contactele = datele firmei sau adrese ale unor
colegi care acceptă (telefon obligatoriu; nicio dată a unui terț); **plicul 2** primește o localitate care NU există în nomenclatorul FAN (ex. un sat
inventat), ca FAN să-l respingă la creare (doc §11); convocări poștale active, documentele generate, plicuirea → **un lot de plicuire NOU (PP-yyyy)
cu EXACT 3 plicuri**, activ, fără AWB, fără dată de expediere, cu opisul atașat pe fiecare; ID-ul lotului în jurnal (rândul (a) din §0).
✉️ Poștă → lotul → „📦 AWB FAN”: „3 din 3 plicuri au toate datele cerute de FAN” (verificarea ERP e de completitudine; respingerea plicului 2 vine
de la FAN, la generare); banner-ul „Activare de TEST (Testul 1) …” (lot nemarcat); **singurul buton activ e „2a. Marchează TEST”**.

Nimic din lotul PP-xxxx nu se atinge și nu se „curăță”: istoricul lui (rândul FAN generat sau anulat, marcajul cu prima aprobare, tirajul) e
așteptat în bază și verificat ca atare la pasul 4. Istoricul NU intră în plafonul lotului nou: `fn_red_fan_aproba` numără doar plicurile lotului
aprobat (probat în proba PGlite a migrării: lotul cu un plic aprobat + lotul de 3 sub plafonul 3).

| # | Cine | Acțiune | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|---|
| 1 | owner | `marcaj-test` | „2a. Marchează TEST” pe PP-yyyy → confirmare | „Lot marcat: TEST.”; titlul „LOT DE TEST · PP-yyyy”; banner roșu „TRANSPORT REAL PORNIT pe acest lot de TEST …”; „1. Propune”, „Schimbă plafonul”, „Lista de evenimente FAN” devin active; „2c. Aprobă” inactiv („niciun plic propus”) |
| 2 | owner | `plafon=3` | caseta „Plafonul lotului pilot” → `3` → „Schimbă plafonul” → confirmare | mesaj „Plafonul lotului pilot: 3.”; caseta arată „Plafonul lotului pilot: 3 plicuri aprobate pe lot” |
| 3 | coordonator | `verifica-plafon=3` | **recitirea din BD** (SQL B1, doar citire) | `limita_lot = 3`, `actualizat_de` = uuid-ul owner-ului, `actualizat_la` = acum; altceva = oprire |
| 4 | coordonator | `verifica-lot-nou` | **verificările lotului NOU și istoricul primului lot** (SQL B2, B3, B4) | B2 (lotul nou): zero rânduri în `red_fan_awb`. B3 (istoricul, așteptat): DOAR lotul PP-xxxx, cu exact un rând `generat` (sau `anulat`, dacă §11 s-a făcut deja) cu AWB-ul din selfAWB și tariful, plus eventual rânduri `eroare` ale unei respingeri corectate (fiecare cunoscută din jurnal); NICIUN rând `in_curs` / `necunoscut` / `aprobat` / `propus` (ar însemna o cerere neîncheiată: §12, nu se continuă). B4: exact două rânduri în `red_fan_loturi` — PP-xxxx (`test = true`, `prima_aprobare_la NOT NULL`, `tiraj_nr ≥ 1`) și PP-yyyy (`test = true`, `prima_aprobare_la IS NULL`, `tiraj_nr = 0`). Altceva = oprire, se lămurește înainte |
| 5 | admin / editor Redări (sau owner-ul) | `propune` | „1. Propune 3 plicuri” | „Propuse: 3; erori: 0.”; 3 rânduri „propus”; „2c. Aprobă” devine activ |
| 6 | owner | `aproba` | „2c. Aprobă” → confirmare („Aprobi 3 AWB-uri FAN …”) | „Aprobate: 3.”; „3. Generează AWB” devine activ; „2a.” devine inactivă (marcajul e fixat); „2b. Marchează real” e dezactivat oricum în Testul 1 |
| 7 | owner | `genereaza` | „3. Generează AWB” → confirmare („Se plătesc.”) — o solicitare cu 3 expedieri | mesaj „Generate: 2; respinse: 1; necunoscute: 0; rămase: 0.” (+ eventual „Asociate pe poziție (de verificat în selfAWB): 2.”); rândurile FAN: 1 și 3 „AWB generat”, 2 „respins de FAN” cu câmpul semnalat (localitatea), fără textul FAN; „1. Propune 1 plicuri” rămâne activ DOAR pentru plicul 2 (respins; se re-propune după corectare, nu acum). „necunoscute: 1”, „respinse: 0” sau respinsul pe alt plic decât 2 = §12 |
| 8 | owner | `verifica-selfawb` | selfAWB (contul de TEST) → AWB-urile zilei | exact 2 AWB-uri noi, cu numărul plicului la observații (PL-…-0001, PL-…-0003). **Verificare obligatorie, înainte de orice tipărire**: fiecare AWB din ERP ↔ numărul plicului din observațiile lui, inclusiv că elementul respins e cel al plicului 2; „asociate pe poziție” > 0 = oprire până la această verificare. Rezultatul (confirmat / neconfirmat) în jurnal = pasul 4a din doc §10 |
| 9 | coordonator | `verifica-tarif` | ERP: rândurile FAN ale plicurilor 1 și 3 | AWB-urile = cele din selfAWB; tarifele afișate lângă AWB și totalul „Tarif FAN pe lot” (2 AWB-uri); **tariful = cel din selfAWB ȘI = oferta FAN** pe fiecare; gol („tarif necunoscut”) sau diferit = OPRIRE (§12) |
| 10 | owner | `etichete` | „4. Etichete (PDF)” | `TEST_PP-yyyy_tiraj-<ID>_etichete.pdf` cu **2** etichete (PL-…-0001 pe poziția 1, PL-…-0003 pe poziția 2) + `TEST_PP-yyyy_tiraj-<ID>_pagina_de_control.docx` (titlul cu „tirajul <ID> (nr. 1)”, 2 rânduri + „rămase: PL-…-0002”); mesaj „Etichete PDF, tirajul <ID>: 2 plicuri (pozițiile 1…2). Formatul paginii (cerut: A6) se verifică pe PDF înainte de tipărire.”; caseta „Pagina de control”: 2 plicuri tipărite, rămase netipărite: PL-…-0002 |
| 11 | om | `verifica-eticheta` | PDF-ul | 2 etichete, formatul paginii notat în jurnal (ca la §8 pasul 2), AWB-urile = cele din ERP, **numărul plicului tipărit pe fiecare**; NU = OPRIRE (§12) |
| 12 | om | `verifica-control` | pagina de control + Loturi → „Documente lot (ZIP, în ordinea plicurilor)” | arhiva `TEST_PP-yyyy_tiraj-<ID>_documente_in_ordinea_plicurilor.zip` cu ACELAȘI `<ID>`: `TEST_0000_tiraj-<ID>_pagina_de_control.docx`, apoi fișierele plicurilor 1 și 3 (`TEST_0001_PL-…-0001_000_opis_T<ID>.docx`, `TEST_0001_…_001_C-…_T<ID>.docx`, `TEST_0002_PL-…-0003_000_opis_T<ID>.docx` …), **niciun fișier al plicului 2**; pagina de control IDENTICĂ cu cea de la pasul 10 (aceleași rânduri, același număr de documente); verificarea celor trei numere (doc §12) pe fiecare poziție; orice nepotrivire = oprire |
| 13 | om | `tipareste` | imprimanta termică | 2 etichete lizibile (cod de bare întreg); plicul 2 rămâne deoparte (fără etichetă, fără documente în arhivă) |

**SQL (coordonatorul, doar citire; `<uuid PP-yyyy>` = ID-ul lotului nou, din jurnal):**
```sql
-- B1 (pasul 3): 3 | <uuid owner> | <acum>
SELECT limita_lot, actualizat_de, actualizat_la FROM public.red_fan_setari;
-- B2 (pasul 4, lotul NOU): 0 rânduri
SELECT stare, count(*) FROM public.red_fan_awb WHERE lot_id = '<uuid PP-yyyy>' GROUP BY 1;
-- B3 (pasul 4, istoricul): DOAR PP-xxxx — un rând generat (sau anulat) cu AWB + tarif, eventual rânduri eroare; NIMIC in_curs / necunoscut / aprobat / propus
SELECT lot_id, nr_plic, stare, awb, tarif FROM public.red_fan_awb WHERE lot_id <> '<uuid PP-yyyy>' ORDER BY lot_id, nr_plic, stare;
-- B4 (pasul 4): exact două rânduri — PP-xxxx | true | NOT NULL | ≥ 1 și PP-yyyy | true | NULL | 0
SELECT lot_id, test, prima_aprobare_la, tiraj_nr FROM public.red_fan_loturi ORDER BY marcat_la;
```

**Corectarea plicului 2 (OPȚIONAL, ⚑ cost, decizia proprietarului; doc §11 Testul 1, „Tiraj nou”):** localitatea reală pe contact → „1. Propune”
(hash nou) → „2c. Aprobă” → „3. Generează AWB” (un AWB în plus) → **aceleași verificări ca la orice AWB nou, ÎNAINTEA oricărei descărcări**: selfAWB (un singur AWB nou, cu numărul plicului 2 la observații), ERP (rândul plicului 2 „AWB generat”, AWB-ul = cel din selfAWB, tariful = cel din selfAWB ȘI = oferta FAN); tarif gol / diferit sau nepotrivire = OPRIRE (§12) → „Etichete” și „Documente lot” sunt REFUZATE („tirajul s-a schimbat; retipărește
tot lotul”, nimic descărcat) → owner: „Tiraj nou — 1. Oprește descărcările” → după 30 s se distrug foile ȘI fișierele tirajului `<ID>` →
„2. Înlocuiește tirajul” → se descarcă din nou TOT lotul (tirajul `<ID2>`, nr. 2, 3 poziții, fără „rămase”) → **se verifică din nou etichetele și pagina de control pentru `<ID2>`**, ca la pașii 11–13: 3 etichete A6, AWB-urile = cele din ERP, numărul plicului tipărit pe fiecare (NU = OPRIRE, §12), pagina de control cu 3 rânduri și tirajul `<ID2>`; foile tirajului `<ID>` nu se mai folosesc. Fără această decizie, plicul 2 rămâne
„respins de FAN” și nu se mai atinge în Testul 1. **Dacă se face corectarea, PP-yyyy are 3 AWB-uri (4 în total cu PP-xxxx)**: decizia și numărul se scriu în jurnal, iar toate numărătorile din §10 și §11 pentru PP-yyyy devin 3.

## 10. Urmărirea, confirmările, comanda curierului; încheierea Testului 1

- **Doar pe AWB-urile NEANULATE.** Un AWB anulat (§11) iese din urmărire și din confirmări: pe un lot fără niciun AWB neanulat butoanele „6. Urmărire” și „7. Confirmări / retururi” sunt dezactivate, iar pașii de mai jos se sar pentru el (în jurnal: „anulat la ora …”). Dacă primul AWB (PP-xxxx) a fost anulat înaintea lotului de 3 (§9 îl acceptă), §10 se aplică doar pe PP-yyyy. Numărătorile de mai jos sunt pentru cazul fără anulări; cu anulări, numărul = AWB-urile neanulate ale lotului.
- „6. Urmărire” imediat după generare, pe fiecare lot: „Urmărire actualizată: 1 AWB-uri.” pe PP-xxxx, „Urmărire actualizată: 2 AWB-uri.” pe
  PP-yyyy (3 dacă s-a făcut corectarea opțională din §9); starea de urmărire „fără evenimente”, „AWB înregistrat la curier (plic neridicat încă)” (codul S98,
  starea de după generare) sau „în tranzit” (cod + dată în ora României). Lista reală de evenimente a curierului (37 de coduri în plus față de PDF) a fost
  clasificată pe 18.11.2026 (doc §1): codurile cu sens nelimpede rămân „de verificat de om”. „de verificat de om” = cod nelimpede sau formă de răspuns
  neașteptată → jurnal (doc §8 deschisă 10), nu se continuă cu urmăriri în buclă.
- „7. Confirmări / retururi”, pe fiecare lot: „Confirmări verificate: 1 AWB-uri.” / „… 2 AWB-uri.” (3 cu corectarea); așteptat „nicio confirmare încă”. „răspuns de
  formă necunoscută” → jurnal (deschisa 7).
- Comanda curierului: **manual în selfAWB** (o comandă pe zi, interval ≥ 2 h), DOAR cu decizia explicită a proprietarului (rândul (i) din §0).
  Dacă în Testul 1 NU se vrea ridicarea fizică, nu se comandă curierul și TOATE AWB-urile existente (3; 4 cu corectarea opțională) se anulează (§11).
- După ridicare (a doua zi): „6. Urmărire” → „ridicat (C0): de confirmat” → „6b. Confirmă ridicarea (N)” pe fiecare lot → pe un lot de TEST se
  marchează DOAR evidența FAN (plicurile din Poștă NU devin expediate; nu apar în registru / PV / export).
- Zilele următoare (doc §11, Testul 1): plicul 1 „livrat (S2)”; colegul destinatar al plicului 3 refuză → „Urmărire”: plicul 3 „RETUR”, propus
  „Refuz”; „Confirmări / retururi”: 1 „confirmare primită: de verificat de om”, 3 „nicio confirmare încă” — formele reale ale răspunsurilor în jurnal
  (deschisele 7, 10).

**Încheierea Testului 1** (după ultimul pas de urmărire / confirmare și, dacă e cazul, anularea din §11; jurnalul complet — formele reale ale
răspunsurilor, verdictul 4a — predat proprietarului). Plafonul se duce la **20** (calendarul din §6: 20 la încheierea Testului 1 e precondiția
Testului 2), din ecran, de pe oricare dintre cele două loturi de TEST (butonul e activ doar pe un lot marcat TEST):

| # | Cine | Acțiune | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|---|
| 1 | owner | `plafon=20` | caseta „Plafonul lotului pilot” → `20` → „Schimbă plafonul” → confirmare | mesaj „Plafonul lotului pilot: 20.” |
| 2 | coordonator | `verifica-plafon=20` | recitirea din BD (SQL A1) | `limita_lot = 20`, `actualizat_de` = uuid-ul owner-ului, `actualizat_la` = acum |

Testul 2 NU pornește de aici: PR separat (`DOAR_PROIECTE_TEST = false`), după acceptarea Testului 1 și „da”-ul juridic (doc §10 pasul 5).

## 11. Anularea AWB-urilor de test

Fiecare AWB separat — **toate cele existente**: 1 pe PP-xxxx, 2 pe PP-yyyy (3 dacă s-a făcut corectarea opțională din §9) —, înainte de ridicare (doar de pe borderoul zilei): caseta „Anulare AWB (înainte de ridicare)” a
lotului → **„Șterge la FAN”** (`DELETE /awb`):
- „AWB șters și anulat: PL-…” → rândul FAN „anulat”; în selfAWB AWB-ul nu mai apare pe borderou. Se notează forma răspunsului de succes
  (doc §8 deschisă 15: codul acceptă doar HTTP 200 + `status: "success"`).
- „Ștergere neconfirmată: AWB-ul rămâne «generat» …” → se verifică în selfAWB; dacă acolo e șters → „Marchează anulat (verificat în selfAWB)”,
  cu motivul; dacă nu e șters → se șterge din selfAWB, apoi același buton.
- „stergere_refuzata” (409) → FAN a refuzat (ex. deja ridicat); rămâne „generat”; se lămurește în selfAWB.
În ERP, pe un lot de TEST, plicul nu e atins în niciun caz (AWB-ul stă doar în `red_fan_awb`). Un AWB șters poate apărea totuși pe factură
(întrebarea deschisă 3): se compară factura contului de test cu evidența.

**Inventarul de închidere (coordonatorul, doar citire; în jurnal):** fiecare AWB din evidență se regăsește în selfAWB și invers; dacă s-a decis anularea, niciun rând nu rămâne „generat”; dacă s-a decis ridicarea, rândurile confirmate ca ridicate (§10, „6b. Confirmă ridicarea”) sunt „ridicat”, iar „generat” înseamnă AWB încă neridicat (se urmărește până la ridicare sau se anulează).
```sql
-- C1: toate AWB-urile testului, pe loturi; așteptat 3 rânduri (4 cu corectarea opțională). Ramura «fără ridicare»: toate «anulat».
--     Ramura «cu ridicare»: «ridicat» după confirmarea ridicării, «generat» cât AWB-ul nu e încă ridicat, «anulat» pentru cele anulate.
SELECT lot_id, nr_plic, stare, awb FROM public.red_fan_awb WHERE awb IS NOT NULL ORDER BY lot_id, nr_plic;
```

## 12. Dacă răspunsul nu are forma așteptată sau un rezultat e ambiguu: OPRIRE, nu improvizație

Aceleași opriri ca în doc §11 „Oprire imediată”. Se oprește, se lămurește (selfAWB, BD, jurnal), apoi se reia DOAR de la pasul în cauză — niciodată
„de la capăt” cu o nouă generare. O continuare fără lămurire e derogare: DOAR proprietarul, explicit, în jurnal, înainte (§0).

| Ce se vede | Ce înseamnă | Ce se face |
|---|---|---|
| „necunoscute: 1” / „răspuns FAN neconfirmat” | timeout / 5xx / răspuns ambiguu DUPĂ `POST /intern-awb`: AWB-ul **poate exista** | NU se reapasă „Generează” (al doilea AWB = cost dublu). Se așteaptă 10 minute, apoi caseta „Reconciliere” cu ziua de azi → „Reconciliază”: „găsit: AWB …” → „Confirmă AWB-ul”; „nu apare în borderoul complet” → „Confirmă absența”; „de verificat în selfAWB” → se verifică acolo, fără buton |
| rândul FAN „în curs (trimis la FAN)” după ce ecranul s-a liniștit | rezultatul nu s-a putut scrie în BD după apel (sau cererea încă rulează, §13) | fără reapăsare; după 10 minute reconcilierea de mai sus |
| **tarif gol sau diferit** de selfAWB / de oferta FAN (§7 pasul 5, §9 pasul 9) | tariful nu e confirmat | **OPRIRE**: nicio etichetă, niciun lot de 3; se lămurește cu FAN; continuarea = derogare a proprietarului |
| **referința (numărul plicului) absentă de pe etichetă** (§8 pasul 2, §9 pasul 11) | eticheta nu poate fi verificată față de pagina de control (doc §12) | **OPRIRE**: nu se tipărește, nu se continuă; scrierea de mână NU e procedura; continuarea = derogare a proprietarului |
| istoricul primului lot altfel decât așteptat la §9 pasul 4 (rânduri `in_curs` / `necunoscut` / `aprobat` / `propus`, sau alt lot marcat) | o cerere a primului lot nu s-a încheiat, sau cineva a propus / marcat între timp | **OPRIRE**: §13 pașii 2–4 (BD, selfAWB, reconciliere) înainte de orice pe lotul nou; nimic nu se „curăță” de mână |
| „respinse: 1” cu câmpuri semnalate | FAN a refuzat elementul (adresă / telefon) | se corectează contactul, „Propune” din nou (hash nou), „Aprobă”, „Generează”; nimic plătit pe el (la §9 plicul 2 e respins intenționat: nu se corectează decât cu decizia proprietarului) |
| `eticheta_neconfirmata` (502) | răspunsul etichetei nu e PDF | nimic descărcat; jurnal; se reîncearcă o singură dată mai târziu |
| `tiraj_schimbat` / `tiraj_oprit` | manifestul s-a schimbat de la prima descărcare | procedura „Tiraj nou” din ecran (oprește → 30 s → distruge foile → înlocuiește); nu la pasul 4a cu un singur plic |
| `urmarire_neconfirmata` / „de verificat de om” | formă de răspuns neașteptată la urmărire | nimic scris; jurnal (deschisa 10); se continuă doar după lămurire |
| orice nepotrivire etichetă ↔ pagina de control ↔ selfAWB ↔ BD | asocierea sau tirajul nu sunt sigure | **OPRIRE**; se lămurește în selfAWB; nimic tipărit / plicuit |
| `transport_real_doar_test` | lotul nu e pe `TEST-` sau nu e marcat TEST | se verifică lotul; NU se marchează nimic pe proiecte reale |
| `transport_neconfigurat` / `autentificare_fan_neconfirmata` | secretele | §1 |
| orice eroare neconfirmată („Rezultat neconfirmat: reîncarcă evidența…”) | rețea / BD | se reîncarcă evidența ÎNAINTE de orice reluare |

Regula tare: un rezultat neclar se lămurește în selfAWB și în jurnal; nu se „mai apasă o dată”.

## 13. Oprirea de urgență: ce oprește, ce NU oprește, cererile în curs; ce rămâne în bază

**Cum funcționează cererea** (`redariFanTransport.mjs`, `executaActiuneFan`): secretele se citesc **o dată, la începutul fiecărei cereri**, înaintea
oricărei alte operații; cererea continuă apoi cu valorile capturate (inclusiv tokenul FAN obținut la `POST /login`) până la final — rezervarea în BD,
`POST /intern-awb`, scrierea rezultatului. **Cât durează o generare — estimare, NU plafon garantat:** la un plic, în condiții normale, câteva
secunde până la un minut. Calculul „5 solicitări × (30 s timeout + 2 s pauză) ≈ 2,7 minute” acoperă DOAR timeout-urile solicitărilor de creare și
NU include: `POST /login` (încă un timeout de 30 s), reautentificarea și reapelarea la 401 (încă până la 60 s pe solicitare), rezervarea și
scrierea rezultatelor în BD, rețeaua și timpul de rulare al funcției edge. De aceea procedura nu cronometrează: se așteaptă liniștirea ecranului
și se verifică în BD (mai jos, pasul 2).

| Măsura | Ce oprește | Ce NU oprește |
|---|---|---|
| **Ștergerea celor trei secrete** (Supabase → Edge Functions → Secrets; fără cod) | orice cerere NOUĂ: 503 `transport_neconfigurat`, fără niciun apel la curier | **o cerere deja începută**: continuă cu secretele capturate și poate crea AWB-ul |
| **Ștergerea funcției** `redari-fan-awb` din Supabase | cererile noi (ecranul arată eroare, nimic chemat) | o cerere în curs poate fi întreruptă în orice punct (rezultat NECUNOSCUT: AWB creat la FAN fără rezultat scris, rând „în curs”) |
| **Comutatorul în cod** (PR cu `TRANSPORT_REAL_ACTIV = false` + testele înapoi pe `false`; testul „comutatorul oprit” din `fanCourierMutanti.test.js` descrie exact comportamentul) → merge → „Deploy edge function (manual)” | cererile noi după publicare: 423 `transport_real_oprit`, ecranul „Transport oprit” | o cerere în curs pe versiunea veche; o solicitare deja trimisă la FAN (AWB-ul creat rămâne creat: se anulează din §11 / selfAWB) |

**Cererile în curs la momentul opririi** (regula L05: ambiguu = necunoscut, nu se repetă):
1. **fără reapăsare** pe nimic; se așteaptă liniștirea ecranului (durata e o estimare, vezi mai sus: nu există un plafon după care „sigur s-a
   terminat”) și NU se închide ecranul ca „să oprească” (închiderea oprește doar afișarea, nu cererea din funcția edge);
2. **verificarea rezultatului în BD** (coordonator, doar citire): `SELECT nr_plic, stare, awb, tarif, tarif_estimat FROM public.red_fan_awb WHERE lot_id = '<uuid lot>';`
   → `generat` / `eroare` = rezultat scris (cererea s-a încheiat); `in_curs` = solicitarea a fost rezervată și poate fi trimisă, fără rezultat scris;
   `necunoscut` = răspuns neconfirmat;
3. **verificarea în contul curierului** (proprietar): selfAWB, contul de TEST, AWB-urile zilei: există un AWB cu numărul plicului la observații?
4. **reconciliere dacă rămâne ambiguu** (`in_curs` / `necunoscut`, sau selfAWB ≠ BD): după 10 minute, caseta „Reconciliere” (§12, primul rând).
   Reconcilierea citește borderoul zilei prin funcția edge (fără cost, dar cere secretele și comutatorul): dacă secretele au fost șterse, proprietarul
   le repune pentru reconciliere și le șterge din nou după, dacă oprirea rămâne. Un AWB găsit se confirmă („Confirmă AWB-ul”) și apoi se anulează (§11)
   dacă nu se vrea transport.
Nimic din evidență nu se șterge și nu se „repară” de mână în BD.

**Ce rămâne în bază după test** (evidență, nu se șterge): rândurile din `red_fan_awb` ale celor două loturi (1 + 3: stări generat / anulat / eroare,
AWB, tarif), `red_fan_loturi` (două rânduri: marcajul TEST, prima aprobare, tirajul fiecăruia), `red_fan_setari.limita_lot` (calendarul din §6: 20
la încheierea Testului 1), evenimentele de tiraj în `red_jurnal`. Plicurile și convocările de pe `TEST-RAZVAN` rămân neatinse (lot de TEST: nimic
scris pe plic). Revenirea migrării (`20261212a_…_ROLLBACK.sql`) **refuză** cu aceste date (doc §7): tabelele rămân.

**Trecerea la Testul 2** (după acceptarea Testului 1 și „da”-ul juridic): PR separat, revizuit, cu `DOAR_PROIECTE_TEST = false` (lotul real
rămâne păzit de marcajul owner-ului și de plafonul pilot), + registrul de automatizări și rândul din `public.automatizari` (doc §10 pasul 5).

## 14. Ce NU se poate verifica fără apelul real și riscul care rămâne la primul apel

**Nu se poate verifica în prealabil** (toate cu pas de oprire mai sus): forma elementului din răspunsul `POST /intern-awb` (referința pe element —
deschisa 11), dacă eticheta tipărește numărul plicului (12) și dacă vine în formatul cerut (17: pe 18.11.2026 a venit A4 la `format=A6`), formele răspunsurilor la urmărire / confirmări / ștergere / borderou (7, 10, 15, 16),
dacă AWB-urile contului de TEST se facturează (3), limita de solicitări pe minut (2), potrivirea adresei firmei cu nomenclatorul FAN (validarea
cu nomenclatorul nu e în cod: un refuz vine ca „respins de FAN” cu câmpurile semnalate), și că apelul din ecran trece de `verify_jwt = true`
(precedent în repo: `sms-trimite`, `polita-citeste`; dacă nu trece, probele din §4 cu `curl` merg oricum, iar soluția e lista `NO_JWT`, PR separat).

**Riscul care rămâne la primul apel și ce îl ține mic:**
- **Cost**: un AWB pe contul de TEST (tariful vine în răspuns; pe factură dacă FAN facturează contul de test). Ținut mic de: plafonul 1 (setat și
  recitit, §6), aprobarea owner-ului pe hash, confirmarea „Se plătesc”, o singură solicitare cu o expediere.
- **Expediere reală creată din greșeală**: dacă secretele ar fi ale contului REAL al firmei, AWB-ul ar fi real (pe borderoul firmei, facturat).
  Ținut mic de: rândul (e) din §0 (login în selfAWB cu aceleași credențiale = contul de TEST), destinatarul = adresa firmei (un plic trimis greșit
  ajunge tot la noi), fără comandă de curier prin API, anularea din §11 înainte de ridicare.
- **Date trimise curierului**: numele deținătorului de test (fictiv), telefonul și adresa firmei, numărul plicului, codul `TEST-RAZVAN`. Nicio
  dată personală a unui terț. Răspunsurile FAN nu se păstrează ca text (doar stări, AWB, tarif, câmpurile semnalate).
- **Dublare**: un „necunoscut” urmat de reapăsare ar face al doilea AWB — de aceea regula din §12 (reconciliere, nu reapăsare); claim-ul din BD
  oprește oricum rândurile deja trimise (doar „aprobat” se rezervă).
- **Proiect greșit**: garda `DOAR_PROIECTE_TEST` + marcajul TEST (imuabil după prima aprobare) → un lot real primește 423 chiar cu comutatorul pornit
  (testat: `fanCourier.test.js`, `fanCourierMutanti.test.js` — 6 mutanți ai gărzii prinși, comportamentul cu comutatorul oprit neschimbat). Rămâne
  riscul din §0: convenția `TEST-` nu e imuabilă — de aceea rândurile (a) și (b) sunt obligatorii.
- **Oprirea de urgență nu e instantanee** (§13): oprește cererile noi, nu una deja începută.
