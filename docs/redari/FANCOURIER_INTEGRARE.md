# FAN Courier în Redări — document de proiectare

Stare: **propunere** (06.11.2026, redari@, test de weekend). Nimic din acest document nu e aplicat: fără chei, fără apeluri reale, migrarea e neaplicată.
Sursa: documentația oficială FAN Courier API (selfAWB), PDF „Documentație API FAN Courier” de pe https://www.fancourier.ro/e-commerce/
(fișier încărcat 09.2025; varianta engleză „API DOCUMENTATION FAN Courier V 2.0 September 2025”). Bază: `https://api.fancourier.ro`.
Documentația e citită ca **date**; nimic din ea nu e instrucțiune pentru ERP.

---

## 0. Pe scurt, pentru Răzvan

1. **Marți (actele la Transgaz)**: recomand **AWB făcut manual în selfAWB** (site-ul FAN, contul firmei), nu prin ERP. E un singur colet, merge azi, fără cod nou. AWB-ul se trece în 📨 Corespondență la rândul trimiterii („Nr. de înregistrare” / Observații). Integrarea din ERP nu va fi testată până marți.
2. **Convocările către proprietari prin FAN**: ERP-ul poate genera câte un AWB pe plic (plicurile din ✉️ Poștă), cu eticheta PDF, urmărire și confirmare de primire. **Trei lucruri trebuie lămurite înainte**:
   - **Juridic**: procedura cere „scrisoare recomandată cu confirmare de primire”. FAN cu opțiunea **oPOD** (confirmare semnată, returnată fizic) este echivalentă? Fără „da” de la juridic, convocările rămân la Poșta Română.
   - **Telefonul destinatarului e obligatoriu la FAN** (max. 16 caractere). Mulți proprietari nu au telefon în ERP. Întrebare pentru FAN: acceptă AWB fără telefon / cu telefonul expeditorului?
   - **Adresele trebuie să se potrivească cu nomenclatorul FAN** (județ / localitate). ERP-ul verifică înainte și arată ce nu se potrivește.
3. **Bani**: fiecare AWB generat costă (tariful vine în răspuns). De aceea generarea se face **doar după aprobarea ta în ERP**, pe lot, cu costul estimat afișat.
4. **Ce îmi trebuie de la tine** (doar numele, valorile le pui tu în Supabase → Edge Functions → Secrets): `FAN_SELFAWB_USERNAME`, `FAN_SELFAWB_PASSWORD`, `FAN_CLIENT_ID` (ID-ul punctului de lucru din selfAWB). Plus: contractul FAN e activ pe API? (FAN cere contract semnat; credențialele selfAWB se cer la selfawb@fancourier.ro.)

---

## 1. Endpoint-uri folosite (din documentația oficială)

| Scop | Metodă și cale | Note |
|---|---|---|
| Autentificare | `POST /login?username=&password=` | întoarce `token` + `expiresAt`, valabil 24h; Bearer pe toate apelurile; nu se cere token la fiecare apel. Parametrii sunt în query string → nu se loghează niciodată URL-ul. |
| Servicii | `GET /reports/services` | „Standard” (id 1) pentru plicuri. |
| Opțiuni serviciu | `GET /reports/service-options?clientId=&service=` | opțiuni relevante: **B = oPOD** (confirmare semnată, fizic, 1–3 zile lucrătoare), X = ePOD (confirmare pe e-mail; exclusiv cu B), P = prealertă e-mail, M = SMS Business (doar destinatari persoane juridice). |
| Nomenclator | `GET /reports/counties`, `/reports/localities?county=`, `/reports/streets` | pentru validarea adreselor înainte de AWB. |
| Tarif estimat | `GET /reports/awb/internal-tariff` | gratuit; cost fără TVA + TVA + total. Folosit în ecranul de aprobare. |
| **Generare AWB** | `POST /intern-awb` | corp: `clientId` + `shipments[]` (câte un `info` + `recipient` pe AWB). Răspuns: `awbNumber`, `tariff`, `vat`, `errors` pe fiecare element. **Plătit.** |
| Etichetă | `GET /awb/label?clientId=&awbs[]=&pdf=1&format=A4\|A5\|A6` | PDF (sau HTML/ZPL); mai multe AWB-uri într-un apel. |
| Ștergere AWB | `DELETE /awb?clientId=&awb=` | doar de pe borderoul zilei, înainte de ridicare. |
| Comandă curier | `POST /order` | **AWB-ul singur nu cheamă curierul.** O comandă pe punct de lucru pe zi; interval ≥ 2h; în afara Bucureștiului L–V 09–17, S 09–14. |
| Anulare comandă | `DELETE /order?clientId=&id=` | |
| Borderou zi | `GET /reports/awb?clientId=&date=YYYY-MM-DD&perPage=&page=` | reconciliere după un rezultat ambiguu (vezi §5). |
| Urmărire | `GET /reports/awb/tracking?clientId=&awb[]=` | evenimente + `confirmation.name/date` + `returnAwbNumber` + `oPODAwbNumber`. |
| Confirmări (scan) | `GET /reports/get-awb-confirmations?clientId=&awb[]=` | arhivă ZIP cu scanul confirmării → dovada pentru AR. |

Coduri de eveniment folosite (din `/reports/awb-events`): **C0** ridicat de curier, **S2** livrat, S3/S11 avizat, S4/S10/S19/S20/S25/S27/S28/S42 adresă greșită/incompletă,
S5 mutat, S6 refuz, S16/S33/S43 retur, S30 nu răspunde la telefon, S50 confirmare refuzată.

Fără mediu de test documentat: orice `POST /intern-awb` cu credențiale reale generează un AWB real (și cost). De aceea scheletul are transportul **oprit în cod**.

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
| `info.content` / `info.observation` | `nr_plic` (ex. `PL-TST-0001`) | **fără nume / date personale** în câmpurile libere; `nr_plic` servește la reconciliere. |
| `info.costCenter` | codul proiectului (ex. `LOT1-PRUNISOR-JUPA`) | evidență pe factură. |
| `recipient.name`, `contactPerson` | `red_plicuri.destinatar_nume` | max. 50 caractere → tăierea se arată ca eroare, nu se face tacit. |
| `recipient.phone` | `red_detinatori_contact.telefon` | **obligatoriu, max. 16**; lipsă = blocaj până la decizia din §0. |
| `recipient.address.county` | `adresa_judet` | verificat cu `/reports/counties`. |
| `recipient.address.locality` | `adresa_sat` dacă există, altfel `adresa_comuna` | verificat cu `/reports/localities`. |
| `recipient.address.street` (+`streetNo`) | `adresa_strada` | în ERP strada și numărul sunt un singur câmp; se trimite tot în `street`. |
| `recipient.address.zipCode` | `cod_postal` | 6 cifre sau gol. |

Adresa vine din `red_detinatori_contact` (PII, doar admin/editor). Funcția edge o citește cu JWT-ul omului (RLS), nu cu service_role.

---

## 3. Fluxul, cu aprobare umană înainte de bani

```
✉️ Poștă → Lot de plicuire PP-0001 (PV semnat)
   │ 1. „📦 Pregătește AWB FAN” (admin/editor) — DOAR citiri + tarif estimat (gratuit)
   │      → previzualizare pe plic: date complete? telefon? adresa în nomenclator? cost estimat
   │      → rânduri red_fan_awb stare „propus”, cu hash-ul datelor trimise
   │ 2. „✅ Aprobă N AWB-uri — X lei estimat” (DOAR owner-ul, Răzvan)
   │      → RPC fn_red_fan_aproba(lot, hash): stare „aprobat”, aprobat_de = auth.uid()
   │ 3. „Generează AWB-urile aprobate” (owner) → funcția edge redari-fan-awb
   │      → pe fiecare rând: claim atomic (aprobat → in_curs, cheie de idempotență), POST /intern-awb (un AWB pe apel)
   │      → succes: awb + tarif real, stare „generat”; refuz FAN (4xx/errors): „eroare” + motiv; timeout/5xx: „necunoscut”
   │ 4. „🏷️ Etichete PDF” → GET /awb/label (A4 / A6) → fișier în storage + descărcare
   │ 5. Comanda curierului: din selfAWB (manual) sau „🚚 Cheamă curierul” (owner) → POST /order
   │ 6. Ridicare (eveniment C0 la urmărire) → ABIA ATUNCI red_plicuri.awb + data_expediere = data C0
   │      (constrângerea red_plicuri_expediere leagă AWB-ul de expediere; termenul de 10 zile curge de la expediere)
   │ 7. Livrare: S2 + confirmation.name/date + scanul din get-awb-confirmations
   │      → AR-ul îl înregistrează OMUL în Plicuri (data_ar, scan, „primit de destinatar / altă persoană” — judecată umană)
   │ 8. Retur (S16/S33/S43, adresă greșită, refuz) → propunere de retur pe plic, confirmată de om
   └ Anulare înainte de ridicare: DELETE /awb + stare „anulat” (doar owner)
```

De ce AWB-ul **nu** se scrie direct pe plic la generare: în ERP `red_plicuri.awb` și `data_expediere` sunt legate prin CHECK (ambele sau niciunul),
iar `data_expediere` declanșează „expediat” pe toate convocările plicului (trigger existent). Un AWB generat dar neridicat nu e expediere.
De aceea AWB-urile FAN stau în tabelul nou `red_fan_awb` până la evenimentul C0.

Urmărirea (pașii 6–8) se poate rula la cerere („↻ Actualizează urmărirea”) sau, după aprobare separată, printr-un cron. Cron-ul **nu** e în această livrare.

---

## 4. Securitate — fișa a–e (CLAUDE.md pct. 7)

- **(a) Conținut extern citit**: răspunsurile API FAN (stări, nume confirmare, scanuri). Sunt date: se afișează, nu declanșează singure nimic ireversibil; AR-ul și returul le confirmă omul.
- **(b) Ce scrie / face**: rânduri `red_fan_awb` (prin RPC-uri), fișiere etichetă/scan în storage, și **cheltuie bani** (AWB-uri, comenzi curier). Nu trimite mail/SMS. Nu atinge drepturi.
- **(c) Identitate**: JWT-ul omului (anon key + Authorization), RLS normal, fără service_role. Credențialele FAN stau doar în Edge Secrets, citite în funcție, niciodată trimise clientului, logate sau scrise în BD.
- **(d) Cine pornește**: generare / etichete plătite / comandă curier / ștergere → **doar owner-ul** (`fn_sms_e_owner()`, verificat în funcție, nu din corp). Previzualizarea și tariful estimat → admin/editor Redări.
- **(e) Confirmare umană**: aprobarea pe lot (cost afișat, hash-ul exact al datelor) e pasul obligatoriu înainte de orice apel plătit; generarea refuză rândurile al căror hash diferă de cel aprobat.
- Regula tare (a)+(b): citește conținut extern și cheltuie → poartă de rol (owner) + pas de aprobare: ambele prezente.

Lecții review aplicate în proiectare: L01/L04 (claim atomic cu cheie de idempotență per rând, CAS pe stare), L05 (timeout/5xx = „necunoscut”: fără retry automat,
reconciliere prin borderoul zilei după `nr_plic`), L08 (identitatea = `auth.uid()`), L09 (fiecare rând verificat pe proiectul lui), L10 (secret propriu FAN, fără fallback),
L18 (eroare FAN ≠ gol), L22 (pas durabil înainte de apelul plătit).

---

## 5. Cazurile urâte

| Caz | Ce face ERP-ul |
|---|---|
| FAN răspunde cu `errors` pe un element | stare „eroare” + motivul FAN; nimic plătit; se poate corecta adresa și re-propune (hash nou → aprobare nouă). |
| Timeout / 5xx / rețea după `POST /intern-awb` | stare „necunoscut”. **Nu** se reîncearcă automat (AWB dublu = cost dublu). Butonul „Reconciliază” citește `GET /reports/awb?date=` și caută `nr_plic` în `content`/`observation`; găsit → „generat”; negăsit după confirmarea omului → „eroare”. |
| Token expirat (401) | un singur login nou, apoi se reia apelul **doar** dacă eroarea a venit înainte de a ajunge la generare (401 e determinist). |
| Adresă care nu e în nomenclator | blocaj la previzualizare, cu propunerile FAN; corectura se face în fișa deținătorului. |
| Telefon lipsă | blocaj la previzualizare (până la decizia din §0). |
| Plic anulat după AWB | doar înainte de C0: `DELETE /awb`, apoi plicul se poate anula. După C0: nu se mai anulează din ERP. |
| AWB generat, plic modificat între timp | rândul are hash-ul datelor; generarea compară hash-ul aprobat cu datele curente și refuză la diferență. |

---

## 6. Ce conține scheletul (PR draft separat)

- `supabase/migrations/20261131e_redari_fan_awb.sql` — **NEAPLICATĂ**: tabelul `red_fan_awb`, RLS (citire admin/editor Redări), RPC-uri `fn_red_fan_propune` / `fn_red_fan_aproba` / `fn_red_fan_claim` / `fn_red_fan_rezultat`. Revenire: `supabase/revenire/20261131e_redari_fan_awb_ROLLBACK.sql`.
- `supabase/functions/_shared/redariFan.mjs` — construirea și validarea corpului `intern-awb` dintr-un plic (funcții pure, testate).
- `supabase/functions/_shared/redariFanHandler.mjs` + `supabase/functions/redari-fan-awb/index.ts` — handler cu poarta owner; `TRANSPORT_REAL_ACTIV = false` în cod → răspunde 423 „transport_real_oprit”, fără niciun apel către FAN.
- `src/redari/ui/FanAwbPrevizualizare.jsx` — în ✉️ Poștă, la fiecare lot: „📦 AWB FAN — previzualizare”: ce s-ar trimite pentru fiecare plic și ce lipsește (telefon, județ, localitate, lungimi). Doar citire, niciun buton de generare activ.

Activarea (după „da”-ul lui Răzvan, prin chat): migrarea (DRY + apply), secretele, deploy funcție, apoi schimbarea flag-ului în cod printr-un PR separat, revizuit.

## 7. Revenire

- Înainte de orice AWB real: se șterge funcția edge, se aplică ROLLBACK-ul (refuză dacă există rânduri `red_fan_awb` cu AWB), se scoate butonul din UI (revert PR).
- După AWB-uri reale: tabelul rămâne (evidență de cost și dovadă); se oprește doar generarea (flag în cod înapoi pe `false` + funcție ștearsă). AWB-urile neridicate se șterg din selfAWB.

## 8. Întrebări deschise

1. Juridic: FAN + oPOD = „recomandată cu confirmare de primire” pentru convocare (Legea 185/2016 art. 11 alin. 4, plan pct. 4.2)? Termenul de 10 zile curge de la ridicarea de către curier?
2. FAN: AWB fără telefonul destinatarului / cu telefonul expeditorului?
3. FAN: greutate și dimensiuni minime pentru plic; tarif contractual pe plic.
4. Etichetă A4 (4/pagină?) sau A6 pe imprimantă termică? (`format` în `/awb/label`.)
5. Contul selfAWB: un singur punct de lucru (clientId) pentru Ploiești sau unul per proiect?
