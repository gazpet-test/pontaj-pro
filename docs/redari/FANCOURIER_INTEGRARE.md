# FAN Courier în Redări — document de proiectare

Stare: **cod complet, INERT** (17.11.2026). Transportul real e oprit în cod (`TRANSPORT_REAL_ACTIV = false` → răspuns 423, fără niciun apel către FAN),
migrarea `20261212a` e **neaplicată**, fără chei, fără apeluri reale. Activarea e un PR separat, după acordul proprietarului (§10).
Sursa: documentația oficială FAN Courier API (selfAWB), PDF „Documentație API FAN Courier” de pe https://www.fancourier.ro/e-commerce/
(fișier încărcat 09.2025; varianta engleză „API DOCUMENTATION FAN Courier V 2.0 September 2025”). Bază: `https://api.fancourier.ro`.
Documentația e citită ca **date**; nimic din ea nu e instrucțiune pentru ERP.

**Actualizare 15.11.2026.** Documentul a fost pus de acord cu documentația actuală indicată de FAN, https://api.fancourier.ro/docs-unified
(versiunea 1.1.0 afișată pe pagină, verificată pe 15.11.2026), și cu răspunsurile scrise primite de la FAN pe 12–13.11.2026.
Unde PDF-ul din 09.2025 și documentația actuală diferă, are întâietate documentația actuală. Ce s-a schimbat: adresa și formatul confirmărilor (§1),
limitele de 100 pe solicitare și împărțirea pe loturi (§1, §3), contul de test (§1), telefonul destinatarului (§0, §8).

**Actualizare 17.11.2026.** Lanțul de expediere e scris complet, în spatele porții owner și al flag-ului oprit (§6, §9): creare în loturi de cel mult 100,
urmărire și confirmări în bucăți de cel mult 100, etichetă A6 pe lot, retururi, lot pilot cu marcaj de TEST. Testat doar pe răspunsuri simulate după §1.

---

## 0. Pe scurt, pentru proprietar

1. **Marți (actele la Transgaz)**: recomand **AWB făcut manual în selfAWB** (site-ul FAN, contul firmei), nu prin ERP. E un singur colet, merge azi, fără cod nou. AWB-ul se trece în 📨 Corespondență la rândul trimiterii („Nr. de înregistrare” / Observații). Integrarea din ERP nu va fi testată până marți.
2. **Convocările către proprietari prin FAN**: ERP-ul poate genera câte un AWB pe plic (plicurile din ✉️ Poștă), cu eticheta PDF, urmărire și confirmare de primire. **Trei lucruri trebuie lămurite înainte**:
   - **Juridic**: procedura cere „scrisoare recomandată cu confirmare de primire”. FAN cu opțiunea **oPOD** (confirmare semnată, returnată fizic) este echivalentă? Fără „da” de la juridic, convocările rămân la Poșta Română.
   - **Telefonul destinatarului e obligatoriu la FAN** (max. 16 caractere). Confirmat de documentația actuală (15.11.2026): fără telefon nu se generează AWB. Mulți proprietari nu au telefon în ERP, deci plicurile lor rămân blocate la previzualizare până se completează telefonul. API-ul nu are opțiune pentru dezactivarea redirecționării livrării: se stabilește cu Vânzări FAN, iar pe 13.11.2026 FAN a acceptat o excepție prin care o dezactivează ei.
   - **Adresele trebuie să se potrivească cu nomenclatorul FAN** (județ / localitate). ERP-ul verifică înainte și arată ce nu se potrivește.
3. **Bani**: fiecare AWB generat costă (tariful vine în răspuns). De aceea generarea se face **doar după aprobarea ta în ERP**, pe lot. Primele loturi au un **plafon mic** (20 de plicuri, se schimbă din ERP) și se marchează **TEST** sau **real** înainte de aprobare.
4. **Ce îmi trebuie de la tine** (doar numele, valorile le pui tu în Supabase → Edge Functions → Secrets): `FAN_SELFAWB_USERNAME`, `FAN_SELFAWB_PASSWORD`, `FAN_CLIENT_ID` (ID-ul punctului de lucru din selfAWB). Plus: contractul FAN e activ pe API? (FAN cere contract semnat; credențialele selfAWB se cer la selfawb@fancourier.ro.)

---

## 1. Endpoint-uri folosite (din documentația oficială)

| Scop | Metodă și cale | Note |
|---|---|---|
| Autentificare | `POST /login?username=&password=` | întoarce `token` + `expiresAt`, valabil 24h; Bearer pe toate apelurile; nu se cere token la fiecare apel. Parametrii sunt în query string → nu se loghează niciodată URL-ul. |
| Servicii | `GET /reports/services` | „Standard” (id 1) pentru plicuri. |
| Opțiuni serviciu | `GET /reports/service-options?clientId=&service=` | opțiuni relevante: **B = oPOD** (confirmare semnată, fizic, 1–3 zile lucrătoare), X = ePOD (confirmare pe e-mail; exclusiv cu B), P = prealertă e-mail, M = SMS Business (doar destinatari persoane juridice). |
| Nomenclator | `GET /reports/counties`, `/reports/localities?county=`, `/reports/streets` | pentru validarea adreselor înainte de AWB (nefolosit încă în cod: verificarea e doar de completitudine, §9). |
| Tarif estimat | `GET /reports/awb/internal-tariff` | gratuit; cost fără TVA + TVA + total. **Nefolosit în cod**: câmpurile răspunsului nu sunt în acest document (§8, deschisă 8). |
| **Generare AWB** | `POST /intern-awb` | corp: `clientId` + `shipments[]` (câte un `info` + `recipient` pe AWB), **1…100 de expedieri pe solicitare**. Telefonul destinatarului e obligatoriu. Răspuns: `awbNumber`, `tariff`, `vat`, `errors` pe fiecare element. **Plătit.** |
| Etichetă | `GET /awb/label?clientId=&awbs[]=&pdf=1&format=A4\|A5\|A6` | PDF (sau HTML/ZPL); mai multe AWB-uri într-un apel. ERP-ul cere **mereu `format=A6`** (§6). |
| Ștergere AWB | `DELETE /awb?clientId=&awb=` | doar de pe borderoul zilei, înainte de ridicare. |
| Comandă curier | `POST /order` | **AWB-ul singur nu cheamă curierul.** O comandă pe punct de lucru pe zi; interval ≥ 2h; în afara Bucureștiului L–V 09–17, S 09–14. **Manual în selfAWB** în această livrare: câmpurile corpului nu sunt în acest document (§8, deschisă 9). |
| Anulare comandă | `DELETE /order?clientId=&id=` | |
| Borderou zi | `GET /reports/awb?clientId=&date=YYYY-MM-DD&perPage=&page=` | reconciliere după un rezultat ambiguu (vezi §5). |
| Urmărire | `GET /reports/awb/tracking?clientId=&awb[]=` | **maximum 100 de AWB-uri pe solicitare** (documentația actuală; confirmat și în scris de asistența IT a FAN pe 12.11.2026). Evenimente + `confirmation.name/date` + `returnAwbNumber` + `oPODAwbNumber`. |
| Lista stărilor de urmărire | `GET /reports/awb-events` | lista completă a codurilor de eveniment (indicată de FAN pe 12.11.2026). Se citește de aici, nu se ține pe de rost. |
| Confirmări (dovada de livrare) | `GET /reports/awb/confirmations?clientId=&awb[]=&language=` | `awb[]` obligatoriu, **1…100 de AWB-uri**; `clientId` obligatoriu; `language` opțional (`ro` / `en`). Răspuns **JSON, o listă** → dovada pentru AR. Forma veche din PDF-ul 09.2025 (`GET /reports/get-awb-confirmations`, arhivă ZIP) nu se mai folosește. |

Autentificarea e neschimbată în documentația actuală: utilizator + parolă + ID de client; codul de acces e valabil 24 de ore.

Coduri de eveniment folosite (din `GET /reports/awb-events`): **C0** ridicat de curier, **S2** livrat, S3/S11 avizat, S4/S10/S19/S20/S25/S27/S28/S42 adresă greșită/incompletă,
S5 mutat, S6 refuz, S16/S33/S43 retur, S30 nu răspunde la telefon, S50 confirmare refuzată. Lista de mai sus vine din PDF-ul 09.2025; înainte de activare se compară cu răspunsul actual al `/reports/awb-events` (acțiunea „evenimente”, §10 pasul 6).

**Limite pe solicitare** (documentația actuală): 100 de expedieri la creare, 100 de AWB-uri la urmărire, 100 la confirmări. **Nicio limită de solicitări pe minut nu e documentată**; FAN a fost întrebat pe 15.11.2026, fără răspuns încă (§8).

**Mediu de test**: documentația actuală arată la Login credențiale generale de test, iar FAN ne-a indicat un cont general de test. Credențialele nu se scriu în repo. **Rămâne de verificat** dacă AWB-urile create cu acel cont sunt reale / au cost (§8). Până la un răspuns, regula rămâne cea prudentă: orice `POST /intern-awb` se tratează ca AWB real, cu cost. De aceea transportul e **oprit în cod** (răspuns 423) și rămâne oprit.

---

## 2. Datele din ERP → câmpurile FAN

Un **plic** (`red_plicuri`) = **un AWB** (un plic, aceeași persoană, toate convocările ei din UAT — regula serverului). Lotul de plicuire (`red_loturi_plicuire`, PV semnat de 2 colegi) = unitatea de aprobare.

| FAN | Din ERP | Observații |
|---|---|---|
| `clientId` | secret `FAN_CLIENT_ID` | punctul de lucru Gazpet din selfAWB. |
| `info.service` | „Standard” | constantă configurabilă. |
| `info.packages` | `{ parcel: 0, envelope: 1 }` | |
| `info.weight` | 1 (kg, minimul uzual) | de confirmat cu FAN pentru plicuri. |
| `info.dimensions` | 1×24×32 cm (plic C4) | obligatoriu în API. |
| `info.payment` | „sender” | plătește Gazpet. |
| `info.options` | `["B"]` (oPOD) | dacă juridicul cere confirmare semnată fizic. |
| `info.content` / `info.observation` | `nr_plic` (ex. `PL-TST-0001`, 11 caractere) | **fără nume / date personale** în câmpurile libere; `nr_plic` servește la reconciliere și e **referința de pe etichetă** (§12). Limita `content`: 255 de caractere; limita `observation` nu e în acest document (11 caractere sunt sub orice limită uzuală). Dacă A6 tipărește câmpul: de verificat la Testul 1 (§11). |
| `info.costCenter` | codul proiectului (ex. `LOT1-PRUNISOR-JUPA`) | evidență pe factură. |
| `recipient.name`, `contactPerson` | `red_plicuri.destinatar_nume` | max. 50 caractere → tăierea se arată ca eroare, nu se face tacit. |
| `recipient.phone` | `red_detinatori_contact.telefon` | **obligatoriu, max. 16**; lipsă = blocaj până la decizia din §0. |
| `recipient.address.county` | `adresa_judet` | verificat cu `/reports/counties`. |
| `recipient.address.locality` | `adresa_sat` dacă există, altfel `adresa_comuna` | verificat cu `/reports/localities`. |
| `recipient.address.street` (+`streetNo`) | `adresa_strada` | în ERP strada și numărul sunt un singur câmp; se trimite tot în `street`. |
| `recipient.address.zipCode` | `cod_postal` | 6 cifre sau gol. |

Adresa vine din `red_detinatori_contact` (PII, doar admin/editor). Funcția edge o citește cu JWT-ul omului (RLS), nu cu service_role.
Contactul ales pe plic și corpul trimis se calculează cu **aceeași funcție** în ecran și în funcția edge (`pregatestePlicuriFan`, L19), deci hash-ul aprobat în ecran e același cu cel recalculat la generare.

---

## 3. Fluxul, cu aprobare umană înainte de bani

```
✉️ Poștă → Lot de plicuire PP-0001 (PV semnat) → „📦 AWB FAN”
   │ 1. „Propune” (admin/editor) — doar citiri + hash: rânduri red_fan_awb „propus” (fără cost, fără FAN)
   │ 2. DOAR owner-ul: „Marchează TEST” sau „Marchează real” (red_fan_loturi; imuabil după prima aprobare),
   │      apoi „Aprobă” → fn_red_fan_aproba(lot, id-uri, hash-uri): „aprobat”, aprobat_de = auth.uid();
   │      refuză peste plafonul lotului pilot (red_fan_setari.limita_lot, implicit 20)
   │ 3. „Generează AWB” (owner) → funcția edge redari-fan-awb, acțiunea „genereaza”
   │      → recalculează corpul și hash-ul din datele CURENTE; diferit de cel aprobat = exclus (re-propunere + aprobare nouă)
   │      → bucăți de CEL MULT 100 de expedieri, una după alta, cu pauză 2 s; cel mult 5 solicitări pe apăsat (restul = încă un apăsat)
   │      → pe fiecare bucată: fn_red_fan_claim_lot (aprobat → in_curs, O cheie pe solicitare) ÎNAINTE de POST /intern-awb
   │      → rezultatul pe element: „generat” (AWB + tarif) / „eroare” (motivul FAN) / „necunoscut”; scrise toate odată (fn_red_fan_rezultate, CAS pe cheie)
   │      → timeout / 5xx / răspuns ambiguu: bucata = „necunoscut”, rularea SE OPREȘTE, fără retry automat
   │ 4. „Etichete A6 (PDF)” (owner) → GET /awb/label?format=A6 cu TOATE AWB-urile lotului, în ordinea numărului de plic → UN fișier
   │ 5. Comanda curierului: în selfAWB (manual), o comandă pe zi, interval ≥ 2 h
   │ 6. „Urmărire” (owner) → GET /reports/awb/tracking în bucăți de ≤ 100 → doar PROPUNERI în evidență (C0 = ridicare propusă,
   │      S2 = livrat, retur cu motiv propus); „Confirmă ridicarea” (owner) → fn_red_fan_ridicat:
   │      lot REAL → red_plicuri.awb + data_expediere = data C0 (pornește termenul de 10 zile); lot de TEST → doar evidența FAN
   │ 7. „Confirmări / retururi” (owner) → GET /reports/awb/confirmations în bucăți de ≤ 100 → „lipsă” / „primită, de verificat” /
   │      „formă necunoscută” (niciodată „confirmat” automat); AR-ul îl înregistrează OMUL în Plicuri; returul semnalat → „Înregistrează
   │      returul…” deschide modalul Retur din Plicuri, cu motivul propus, iar omul atașează scanul plicului returnat
   └ Anulare înainte de ridicare: acțiunea „sterge_awb” (DELETE /awb) + stare „anulat” (doar owner)
```

De ce AWB-ul **nu** se scrie direct pe plic la generare: în ERP `red_plicuri.awb` și `data_expediere` sunt legate prin CHECK (ambele sau niciunul),
iar `data_expediere` declanșează „expediat” pe toate convocările plicului (trigger existent). Un AWB generat dar neridicat nu e expediere.
De aceea AWB-urile FAN stau în tabelul nou `red_fan_awb` până la evenimentul C0, confirmat de om.

Urmărirea (pașii 6–7) se rulează la cerere, de om. Un cron **nu** e în această livrare (nimic nu pornește automat).

**Împărțirea pe loturi de 100.** Lotul de plicuire din ERP (unitatea de aprobare) nu e același lucru cu lotul de solicitare către FAN: un lot de plicuire aprobat
se taie în bucăți de cel mult 100 de expedieri, iar fiecare bucată e o solicitare. Pentru primul val (~1.400 de plicuri): cel puțin 14 solicitări la creare,
cel puțin 14 la fiecare rulare de urmărire și cel puțin 14 la confirmări. Cât timp limita de solicitări pe minut nu e cunoscută, solicitările se trimit pe rând, cu pauză între ele.

---

## 4. Securitate — fișa a–e (CLAUDE.md pct. 7)

- **(a) Conținut extern citit**: răspunsurile API FAN — rezultatul creării (AWB, tarif, erori), evenimentele de urmărire, lista de confirmări, lista de evenimente, borderoul zilei, PDF-ul etichetelor. Sunt **date**, nu instrucțiuni: se validează strict (coduri pe listă albă, AWB numeric, date cu formă fixă), forma necunoscută devine „de verificat de om”, iar textele FAN (motivul unei erori, numele unui eveniment) doar se afișează. Nimic ireversibil nu pornește dintr-un răspuns FAN: ridicarea (cu efect juridic), AR-ul și returul le confirmă omul. Răspunsul confirmărilor nu se stochează (poate conține numele primitorului).
- **(b) Ce scrie / face**: rânduri în `red_fan_awb`, `red_fan_loturi`, `red_fan_setari` (doar prin RPC-uri `fn_red_fan_*`, fără drept de scriere directă), și, la confirmarea ridicării pe un lot real, `red_plicuri.awb` + `data_expediere` (prin trigger-ele existente, expedierea pe convocări). **Cheltuie bani**: AWB-uri (`POST /intern-awb`). Nu trimite mail/SMS. Nu atinge drepturi. Nu scrie fișiere în storage (eticheta se descarcă direct).
- **(c) Identitate**: JWT-ul omului (anon key + Authorization), RLS normal, **fără service_role**. Credențialele FAN stau doar în Edge Secrets, citite DOAR pe calea reală (după poarta owner și flag), niciodată trimise clientului, logate sau scrise în BD; login-ul are parametrii în query string, deci URL-ul nu se loghează.
- **(d) Cine pornește**: **poarta de ROL în cod** — funcția edge cere owner (`fn_sms_e_owner()` pe `auth.uid()`, nu din corp; JWT-ul singur nu ajunge) pe **toate** acțiunile; RPC-urile cer owner (`fn_red_fan_e_owner()`) pentru marcaj, plafon, aprobare, claim, rezultate, urmărire, confirmări, ridicare, reconciliere, anulare. Propunerea (fără cost, fără FAN) → admin/editor Redări.
- **(e) Confirmare umană**: aprobarea pe lot (marcaj test / real, plafon pilot, hash-ul exact al datelor) e **obligatorie înainte de orice apel plătit**; generarea refuză rândurile al căror hash diferă de cel aprobat; fiecare rulare (generare, urmărire, confirmări) e un apăsat de om, cu cel mult 5 solicitări de creare pe apăsat; ridicarea și returul se confirmă de om.
- Regula tare (a)+(b): citește conținut extern și cheltuie → poartă de rol (owner) + pas de aprobare: **ambele prezente**, plus `TRANSPORT_REAL_ACTIV = false` până la activare.

Lecții review aplicate: L01/L04 (claim atomic cu o cheie pe solicitare, CAS pe stare și cheie), L02 (rezultatele unei solicitări într-un singur RPC; ridicarea = rând FAN + plic în aceeași tranzacție),
L05 (timeout/5xx = „necunoscut”: fără retry automat, rularea se oprește, reconciliere prin borderoul zilei după `nr_plic`, confirmată de om), L06 (ordinea lock-urilor scrisă în migrare),
L08 (identitatea = `auth.uid()`), L09 (lotul citit cu JWT-ul omului; fiecare rând verificat pe lotul lui), L10 (secret propriu FAN, fără fallback), L12 (formă necunoscută = de verificat),
L16 (un singur rând viu pe plic, AWB unic), L17 (ora României), L18 (eroare FAN ≠ gol; tarif necunoscut = NULL, nu 0, nu rotunjit), L22 (pas durabil înainte de apelul plătit), L23 (citiri keyset).

---

## 5. Cazurile urâte

| Caz | Ce face ERP-ul |
|---|---|
| FAN răspunde cu `errors` pe un element | acel rând = „eroare” + motivul FAN; nimic plătit pe el; celelalte din solicitare rămân cu rezultatul lor. Se corectează adresa și se re-propune (hash nou → aprobare nouă). |
| Timeout / 5xx / rețea după `POST /intern-awb` | **toate** rândurile din acea solicitare = „necunoscut”, rularea se oprește. **Nu** se reîncearcă automat (AWB dublu = cost dublu). „Reconciliază” (owner) citește `GET /reports/awb?date=` și **propune** pe `nr_plic`: găsit → omul confirmă „generat”; negăsit în borderoul citit complet → omul confirmă „eroare”. |
| Rezultatul nu se poate scrie în BD după apelul FAN | rândurile rămân „în curs”, rularea se oprește; după 10 minute se reconciliază ca mai sus. |
| Token expirat (401) | un singur login nou, apoi aceeași solicitare, cu aceeași rezervare (401 e refuz înainte de prelucrare). |
| Refuz 4xx care conține totuși un număr AWB | toată solicitarea = „necunoscut” (AWB-ul poate exista), reconciliere. |
| Adresă care nu e în nomenclator | blocaj la previzualizare (în această livrare: doar completitudinea; nomenclatorul la activare, §9). |
| Telefon lipsă | blocaj la previzualizare: telefonul e obligatoriu la generarea AWB-ului (documentația actuală), fără excepție în API. |
| Mai mult de 100 de expedieri / AWB-uri într-o solicitare | nu se trimite: ERP-ul împarte în loturi de cel mult 100 înainte de apel (creare, urmărire, confirmări, etichete); claim-ul din BD refuză peste 100. |
| Răspuns cu alt număr de elemente decât cel trimis, sau același AWB de două ori | rândurile fără pereche sigură rămân „necunoscut”; asocierea nu se ghicește. |
| Limită de solicitări pe minut (nedocumentată) | solicitările se trimit pe rând, cu pauză; un 429 oprește rularea (rândurile acelei solicitări = „eroare”, se re-propun), care se reia de om, nu automat. |
| Plic deja cu AWB (FAN sau manual) | nu primește al doilea: un singur rând viu pe plic (index unic), claim doar din „aprobat”, plicul trebuie fără AWB și fără expediere. |
| Lot de TEST | marcat înainte de aprobare, imuabil după; titlul, borderoul CSV și fișierele (etichete, borderou) încep cu „LOT DE TEST” / „TEST_”; ridicarea nu scrie pe plic, deci nu apare în registru, PV sau export. |
| Lot peste plafonul pilot | aprobarea se refuză (plicuri deja aprobate + noi > plafon); owner-ul ridică plafonul din setări după primele loturi. |
| Urmărire: eveniment cu cod / dată de formă necunoscută, ultimul cod necunoscut, S50 | „de verificat de om”, nu livrat / retur. |
| Confirmări: răspuns care nu e listă, sau element fără AWB | „formă necunoscută” pe toate AWB-urile cerute; niciodată „confirmat”. |
| Etichetă: răspuns care nu e PDF | eroare afișată (502), nimic descărcat. |
| Redirecționarea livrării de către destinatar | nu se poate opri din API; o dezactivează FAN, prin excepția acceptată pe 13.11.2026. De verificat pe primele AWB-uri că excepția e activă. |
| Plic anulat după AWB | doar înainte de C0: `DELETE /awb`, apoi „anulat”; 5xx la ștergere = AWB-ul rămâne „generat” până la verificarea în selfAWB. După C0: nu se mai anulează din ERP. |
| AWB generat, plic modificat între timp | rândul are hash-ul datelor; generarea compară hash-ul aprobat cu datele curente și exclude rândul. |

---

## 6. Ce conține codul (17.11.2026, inert)

- `supabase/migrations/20261212a_redari_fan_awb.sql` — **NEAPLICATĂ**, probată pe PGlite (`scripts/pglite/test_redari_fan_awb_local.mjs`). Tabele: `red_fan_awb` (un rând pe plic, stări + urmărire + confirmare, fără PII), `red_fan_loturi` (marcajul TEST / real), `red_fan_setari` (plafonul lotului pilot, un rând, implicit 20). RLS: citire admin/editor Redări; scriere doar prin RPC. RPC-uri: `fn_red_fan_setari_seteaza`, `fn_red_fan_lot_marcheaza`, `fn_red_fan_propune`, `fn_red_fan_aproba`, `fn_red_fan_claim_lot` (≤ 100 de rânduri, o cheie), `fn_red_fan_rezultate` (toate odată, CAS), `fn_red_fan_reconciliaza`, `fn_red_fan_ridicat` (lot real → plicul expediat; lot de test → doar evidența), `fn_red_fan_urmarire`, `fn_red_fan_confirmari`, `fn_red_fan_anulat`. Revenire: `supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql` (refuză cu orice rând, lot marcat sau setări schimbate).
- `supabase/functions/_shared/redariFan.mjs` — funcții pure: corpul `intern-awb`, contactul pe plic, hash-ul, bucățile de ≤ 100, interpretarea răspunsurilor (creare pe element, urmărire, confirmări, evenimente, borderou), data evenimentelor în ora României, căile etichetei (A6) și ale listelor de AWB.
- `supabase/functions/_shared/redariFanTransport.mjs` — calea reală (login, creare, urmărire, confirmări, evenimente, etichete, reconciliere, ștergere), cu toate dependențele injectate.
- `supabase/functions/_shared/redariFanHandler.mjs` + `supabase/functions/redari-fan-awb/index.ts` — poarta owner; `TRANSPORT_REAL_ACTIV = false` → 423 „transport_real_oprit” **înainte** de secrete, BD (în afara lotului) sau rețea. Acțiuni: `genereaza`, `eticheta`, `urmarire`, `confirmari`, `evenimente`, `reconciliaza`, `sterge_awb`.
- `src/redari/fanLot.js` + `src/redari/ui/FanAwbPrevizualizare.jsx` — în ✉️ Poștă, la fiecare lot, „📦 AWB FAN”: previzualizarea pe plic + cei 7 pași, toți dezactivați vizibil cu „transport oprit”; marcajul de TEST în titlu și în fișiere; borderou CSV fără date personale.
- `src/redari/plicuri.js` (`planPachetPlicuire`, `ordineConvocari`) + buton „Documente lot (ZIP, în ordinea plicurilor)” în Loturi: documentele arhivate (opis + convocări), într-un singur fișier, în ordinea numărului de plic (§12).

**Eticheta: A6 fix.** Decizia proprietarului: format A6 (100×150 mm) pentru imprimanta termică. Codul cere mereu `format=A6` (constanta `FORMAT_ETICHETA`), fără alegere în ecran.

**Tipărire pe lot.** Documentația spune că `/awb/label` primește mai multe AWB-uri într-un apel (`awbs[]`) și întoarce un PDF → ERP-ul cere **toate AWB-urile lotului într-un singur apel, în ordinea numărului de plic**, și descarcă **un fișier**. Fără librării noi: nu se lipesc PDF-uri în browser (pdf-lib nu e compatibil cu build-ul nostru). Peste 100 de AWB-uri (limita de etichete pe apel nu e documentată; s-a ales prudent aceeași limită de 100) etichetele vin în **părți numerotate** (`_partea1din2`), tot în ordinea plicurilor; cu plafonul pilot (20) lotul încape într-un fișier. Că PDF-ul păstrează ordinea din `awbs[]` e de verificat la Testul 1 (§11).

## 7. Revenire

- Înainte de orice AWB real: se șterge funcția edge, se aplică ROLLBACK-ul (refuză dacă există rânduri FAN, loturi marcate sau setări schimbate), se scoate butonul din UI (revert PR).
- După AWB-uri reale: tabelele rămân (evidență de cost și dovadă); se oprește doar generarea (flag în cod înapoi pe `false` + funcție ștearsă). AWB-urile neridicate se șterg din selfAWB.

## 8. Întrebări: ce s-a lămurit și ce rămâne deschis

Sursa răspunsurilor: documentația actuală de la https://api.fancourier.ro/docs-unified (versiunea 1.1.0, verificată 15.11.2026) și răspunsurile scrise ale FAN din 12–13.11.2026.

**Lămurite**

1. Telefonul destinatarului: **obligatoriu** la generarea AWB-ului. Plicurile fără telefon rămân blocate la previzualizare.
2. Redirecționarea livrării: API-ul nu are opțiune pentru dezactivare; se stabilește cu Vânzări. FAN a acceptat pe 13.11.2026 o excepție prin care o dezactivează ei.
3. Limite pe solicitare: 100 de expedieri la creare (`POST /intern-awb`), 100 de AWB-uri la urmărire (`GET /reports/awb/tracking`, confirmat și în scris pe 12.11.2026), 100 la confirmări (`GET /reports/awb/confirmations`).
4. Dovada de livrare: `GET /reports/awb/confirmations`, răspuns JSON (o listă), nu arhivă ZIP.
5. Lista completă a stărilor de urmărire: `GET /reports/awb-events` (indicat de FAN pe 12.11.2026).
6. Autentificarea: utilizator + parolă + ID de client; codul de acces e valabil 24 de ore (neschimbat).
7. Mediu de test: există un cont general de test indicat de FAN (credențialele nu stau în repo).
8. **Eticheta: A6 pe imprimantă termică** (decizia proprietarului, 17.11.2026). Închide fosta întrebare 5.

**Deschise**

1. Juridic: FAN + oPOD = „recomandată cu confirmare de primire” pentru convocare (Legea 185/2016 art. 11 alin. 4, plan pct. 4.2)? Termenul de 10 zile curge de la ridicarea de către curier? **Fără răspuns încă.**
2. FAN: există o limită de solicitări pe minut? Nu e documentată; întrebare trimisă pe 15.11.2026, fără răspuns încă. (Codul: pe rând, pauză 2 s, cel mult 5 solicitări de creare pe apăsat.)
3. FAN: AWB-urile create cu contul general de test sunt reale / au cost? De verificat înainte de orice apel de creare cu acel cont.
4. FAN: greutate și dimensiuni minime pentru plic; tarif contractual pe plic.
5. ~~Etichetă A4 sau A6~~ → închisă: A6 (Lămurite 8).
6. Contul selfAWB: un singur punct de lucru (clientId) pentru Ploiești sau unul per proiect?
7. Câmpurile exacte din răspunsul `GET /reports/awb/confirmations` (ce conține fiecare element al listei și cum se ajunge la imaginea confirmării): de citit pe un răspuns real. Codul: element cu AWB → „primită, de verificat de om”; orice altă formă → „formă necunoscută”.
8. Câmpurile răspunsului `GET /reports/awb/internal-tariff` (tariful estimat afișat la aprobare). Până atunci, aprobarea arată numărul de AWB-uri, nu suma.
9. Câmpurile corpului `POST /order` (comanda curierului). Până atunci, comanda se face manual în selfAWB.
10. Forma răspunsurilor la urmărire, borderou și login, pe un răspuns real: codul acceptă lista ca `data` / `response` / listă directă și `awbNumber` sau `awb`; orice altceva = de verificat. Data evenimentelor fără fus orar e presupusă ora României.
11. Ordinea elementelor din răspunsul `POST /intern-awb` = ordinea expedierilor trimise? Codul asociază pe poziție doar când numărul de elemente e egal; de confirmat cu FAN și la Testul 1.
12. Câmpul `observation` (sau `content`) apare tipărit pe eticheta A6? Limita lui de caractere? De confirmat la Testul 1 (altfel numărul plicului se scrie de mână pe plic, §12).
13. Codul de eveniment pentru „destinatar negăsit / necunoscut la adresă”: nu e în lista de lucru; de luat din `/reports/awb-events`. Până atunci, semnalele de adresă propun „adresă incompletă”, iar omul alege motivul final.
14. Limita de AWB-uri pe apel la `/awb/label` și dacă PDF-ul păstrează ordinea din `awbs[]`.

## 9. De făcut în cod

Făcute pe 17.11.2026 (inerte, testate pe răspunsuri simulate):

1. ✅ **Loturi de cel mult 100 la creare**: `imparteInBucati` + `interpreteazaRaspunsLot` (asociere pe poziție doar la număr egal de elemente, rezultat parțial pe element, „necunoscut” pe toată bucata la timeout/5xx sau formă ambiguă) + `fn_red_fan_claim_lot` / `fn_red_fan_rezultate` (o cheie pe solicitare, toate rezultatele odată). Alegerea între 1 și 100 pe apel: codul acceptă orice mărime 1…100; implicit 100, cu oprire la primul rezultat necunoscut.
2. ✅ **Loturi de cel mult 100 la urmărire și la confirmări**: acțiunile `urmarire` și `confirmari`, `awb[]` în bucăți de cel mult 100.
3. ✅ **Confirmări în format JSON**: `GET /reports/awb/confirmations` cu `clientId`, `awb[]`, `language=ro`; răspunsul nu se stochează, doar starea (deschisă 7).
4. ✅ **Lista de evenimente**: acțiunea `evenimente` compară `GET /reports/awb-events` cu `EVENIMENTE_FAN` (coduri lipsă la FAN / coduri FAN neclasificate). Lista din cod rămâne cea din PDF până la comparația pe răspunsul real (§10 pasul 6).
5. ✅ **Comentariul de sursă** din capul `redariFan.mjs` actualizat (docs-unified 1.1.0 + răspunsurile FAN din 12–13.11.2026).
6. `TRANSPORT_REAL_ACTIV` rămâne `false` (răspuns 423) până la PR-ul de activare, după acordul owner-ului; testul care o cere rămâne.

Rămase pentru activare (după răspunsuri FAN / juridic): validarea adreselor cu nomenclatorul (`/reports/counties`, `/reports/localities`), tariful estimat (deschisă 8), comanda curierului prin API (deschisă 9), completarea `EVENIMENTE_FAN` după `/reports/awb-events`, migrarea în formatul runnerului de livrare (amprenta L15) dacă chat-ul o cere la aplicare.

## 10. Lista de activare (în ordine; ⚑ = cere acordul proprietarului)

1. ⚑ **Juridic**: „da” scris pentru FAN + oPOD ca recomandată cu confirmare de primire (§8 deschisă 1). Fără el, convocările rămân la Poșta Română; FAN se poate folosi doar pentru loturi de TEST.
2. **FAN**: răspunsuri la §8 deschise 2, 3, 4, 6 (limita pe minut, contul de test, plicul, punctul de lucru). Contract activ pe API.
3. ⚑ **Migrarea 20261212a**: DRY pe clona schemei (apply → revenire → re-apply), review Jakarinos + Fable, aplicare de către chat. Postcondiții: RLS pe cele 3 tabele, fără scriere directă, plafon 20.
4. ⚑ **Secretele** în Supabase → Edge Functions → Secrets (de proprietar): `FAN_SELFAWB_USERNAME`, `FAN_SELFAWB_PASSWORD`, `FAN_CLIENT_ID`. Pentru început: contul de test FAN, dacă FAN confirmă că nu generează AWB-uri plătite.
5. ⚑ **Publicarea funcției** `redari-fan-awb` (de chat), cu flag-ul încă `false`: un apel din ecran trebuie să întoarcă „Transport oprit” (423), iar un cont non-owner 403.
6. ⚑ **PR de activare** (separat, revizuit): `TRANSPORT_REAL_ACTIV = true` și schimbarea testului care cere `false`. Imediat după publicare, owner-ul rulează acțiunea „evenimente” și compară lista; diferențele se pun în `EVENIMENTE_FAN` printr-un PR mic, înainte de prima urmărire reală.
7. ⚑ **Testul 1** (§11), apoi **Testul 2** (§11). Abia după ambele, plafonul pilot se ridică (setarea din ecran, owner).
8. Registrul de automatizări + rândul din `public.automatizari` (fișa a–e de la §4), la activare (de chat).

## 11. Testele de activare

### Testul 1 — intern, 3 plicuri, unul refuzat

Scop: tot lanțul pe 3 plicuri trimise **la adrese interne** (colegi care acceptă să primească, pe proiectul de test), unul dintre ele refuzat intenționat la livrare. Lot marcat **TEST**.

| Pas | Ce face omul | Ce se verifică |
|---|---|---|
| 1 | În proiectul de test: 3 plicuri, lot de plicuire PP-xxxx, opis atașat pe fiecare | ✉️ Poștă → „📦 AWB FAN”: 3 din 3 plicuri cu toate datele; referința pe etichetă = numărul plicului |
| 2 | Admin/editor: „Propune 3 plicuri” | 3 rânduri „propus” |
| 3 | Owner: „Marchează TEST”, apoi „Aprobă” | titlul arată „LOT DE TEST”; 3 „aprobat”; marcajul nu mai poate fi schimbat |
| 4 | Owner: „Generează AWB” | O solicitare cu 3 expedieri; 3 „AWB generat”, fiecare cu AWB și tarif. În selfAWB: 3 AWB-uri, cu numărul plicului la observații; **ordinea AWB-urilor din răspuns = ordinea plicurilor** (§8 deschisă 11) |
| 5 | Owner: „Etichete A6 (PDF)” | Un fișier `TEST_PP-xxxx_etichete_A6.pdf`, 3 etichete, în ordinea PL-…-0001, 0002, 0003; se tipărește corect pe imprimanta termică; **numărul plicului apare pe etichetă** (§8 deschisă 12) |
| 6 | Verificarea celor trei numere pe fiecare plic (§12), lipirea etichetelor | etichetă = opis (pagina 1) = opisul cu convocările din plic |
| 7 | Comanda curierului în selfAWB | curierul ridică cele 3 plicuri |
| 8 | Owner: „Urmărire”, a doua zi | 3 × „ridicat (C0): de confirmat”, cu data C0; „Confirmă ridicarea (3)” → rândurile FAN = „ridicat”; **plicurile din Poștă NU devin expediate** (lot de test) |
| 9 | Colegul destinatar al plicului 2 **refuză** plicul la livrare | „Urmărire” → plicul 2 = „RETUR”, propus „Refuz”; plicurile 1 și 3 = „livrat (S2)” |
| 10 | Owner: „Confirmări / retururi” | 1 și 3: „confirmare primită: de verificat”; 2: „nicio confirmare”. Se notează în raport forma reală a răspunsului (§8 deschisă 7) |
| 11 | Borderou FAN (CSV) | primul rând „LOT DE TEST”; fără nume / adrese / telefoane |
| 12 | Factura FAN | 3 AWB-uri, tariful = cel din ERP |

### Testul 2 — lot real, 10–20 plicuri dintr-un UAT

Precondiții: Testul 1 trecut, „da” juridic (§10 pasul 1), plafon pilot 20, telefoanele completate pe plicurile alese.

| Pas | Ce face omul | Ce se verifică |
|---|---|---|
| 1 | Lot de plicuire cu 10–20 plicuri dintr-un singur UAT, PV de plicuire semnat, opis la dosar pe fiecare | previzualizarea: toate plicurile cu date complete; cele fără telefon se scot din lot înainte |
| 2 | Admin/editor: „Propune” | N rânduri „propus” |
| 3 | Owner: „Marchează real”, „Aprobă” | N „aprobat”; peste 20 → refuz cu mesajul plafonului |
| 4 | Owner: „Generează AWB” | o solicitare; N AWB-uri; niciun „necunoscut” (altfel: stop, „Reconciliază”, nu reapăsa) |
| 5 | „Etichete A6”, „Documente lot (ZIP, în ordinea plicurilor)” | un PDF cu N etichete și un ZIP cu documentele, **în aceeași ordine a plicurilor** |
| 6 | Plicuirea și verificarea celor trei numere (§12) pe fiecare plic, de cei 2 colegi din PV | niciun plic cu numere diferite |
| 7 | Comanda curierului, ridicarea | „Urmărire” → C0 pe toate; „Confirmă ridicarea” → plicurile devin expediate în Poștă, cu AWB-ul și data C0; termenul de 10 zile se calculează de la data C0 |
| 8 | Zilnic: „Urmărire” + „Confirmări / retururi” | livratele → AR-ul se înregistrează din cartonașul oPOD fizic; retururile → „Înregistrează returul…” cu scanul plicului returnat → apar în PV B la „Demersurile de convocare” (AWB, data expedierii, retur) |
| 9 | Exportul pentru Transgaz | AWB-urile FAN apar ca număr de urmărire, datele de expediere = C0 |
| 10 | Bilanț | cost total = factura FAN; abia apoi se ridică plafonul pilot |

## 12. Ghidul operatorului: verificarea celor trei numere (protecția contra plicului greșit)

Un plic pus în alt plic decât cel cu eticheta lui trimite date personale altei persoane. De aceea, la plicuire, pentru **fiecare** plic, cei doi colegi din PV verifică:

1. **Numărul de pe etichetă** (câmpul de observații / referință al AWB-ului, ex. `PL-ABC-0007`).
2. **Numărul de pe prima pagină din plic**: prima pagină e **opisul** („Opis - plicul PL-ABC-0007”). În pachetul ZIP pe lot, opisul fiecărui plic vine primul.
3. **Opisul față de conținut**: numerele convocărilor din opis = convocările puse în plic, și numele destinatarului din opis = numele de pe etichetă.

Toate trei trebuie să fie identice; dacă unul diferă, plicul nu se închide și se reface. Dacă eticheta A6 nu tipărește observațiile (§8 deschisă 12), numărul plicului se scrie de mână pe plic, lângă etichetă, înainte de verificare.

Numărul plicului nu e tipărit pe convocator: șabloanele DOCX nu se schimbă în această livrare. Variante (decizie separată): **A** — opisul ca primă pagină (azi, fără cod nou în șabloane); **B** — un câmp nou cu numărul plicului în antetul convocatorului (schimbare de șablon, PR separat).
