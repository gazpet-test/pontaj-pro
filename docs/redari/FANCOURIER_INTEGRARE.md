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

**Actualizare 17.11.2026, runda 2 (review PR #1118: GO pentru codul inert, NO-GO pentru activare în forma de atunci).** Închise în cod, fiecare cu
test care pica pe forma veche: reconcilierea nu mai propune „lipsă” dacă borderoul are vreun element neînțeles (§5); etichetele și documentele
lotului au ACELAȘI manifest (aceeași mulțime, aceeași ordine) + o pagină de control (§6, §12); ștergerea AWB-ului cere forma de succes
recunoscută (§5); marcajul TEST / real e imuabil după PRIMA aprobare (istoric) și arhiva unui lot de test poartă `TEST_` (§3); ecranul are toate
operațiile procedurii, dezactivate cât transportul e oprit (§3); motivele FAN nu mai intră ca atare în evidență (§4); numele din arhivă se
sortează corect (§6); rezervarea recalculează datele de contact în tranzacția ei, urmărirea nu suprascrie un rezultat mai nou, asocierea
răspunsului se verifică pe referință când există (§5). Migrarea și revenirea sunt în forma livrării L15 v2 (§6, §10).

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
| Ștergere AWB | `DELETE /awb?clientId=&awb=` | doar de pe borderoul zilei, înainte de ridicare. Succes = DOAR forma recunoscută (HTTP 200 + `status: "success"`, fără erori; presupunere de confirmat, §8 deschisă 15); orice altă formă = AWB păstrat, verificare în selfAWB. |
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
   │ 2. DOAR owner-ul: „Marchează TEST” sau „Marchează real” (red_fan_loturi; imuabil după PRIMA aprobare a lotului — istoric:
   │      prima_aprobare_la, pusă de BD și păzită de un trigger; o re-propunere care readuce rândurile la „propus” NU îl redeschide),
   │      apoi „Aprobă” → fn_red_fan_aproba(lot, id-uri, hash-uri): „aprobat”, aprobat_de = auth.uid();
   │      refuză peste plafonul lotului pilot (red_fan_setari.limita_lot, implicit 20; „Schimbă plafonul” în ecran, owner)
   │ 3. „Generează AWB” (owner) → funcția edge redari-fan-awb, acțiunea „genereaza”
   │      → recalculează corpul și hash-ul din datele CURENTE; diferit de cel aprobat = exclus (re-propunere + aprobare nouă)
   │      → bucăți de CEL MULT 100 de expedieri, una după alta, cu pauză 2 s; cel mult 5 solicitări pe apăsat (restul = încă un apăsat)
   │      → pe fiecare bucată: fn_red_fan_claim_lot (aprobat → in_curs, O cheie pe solicitare) ÎNAINTE de POST /intern-awb; claim-ul
   │        recalculează în tranzacția lui amprenta SURSELOR (plicul + contactele tuturor deținătorilor lui) și o compară cu cea citită de
   │        funcția edge: o schimbare între citire și rezervare = refuz, nimic plătit
   │      → rezultatul pe element: „generat” (AWB + tarif) / „eroare” (câmpurile semnalate de FAN, fără textul FAN) / „necunoscut”;
   │        scrise toate odată (fn_red_fan_rezultate, CAS pe cheie). Dacă FAN întoarce referința (observation / content) pe element, ea
   │        trebuie să fie plicul de pe acea poziție, altfel toată bucata = „necunoscut”; fără referință, asocierea e pe poziție (numărată)
   │      → timeout / 5xx / răspuns ambiguu: bucata = „necunoscut”, rularea SE OPREȘTE, fără retry automat
   │ 4. „Etichete A6 (PDF)” (owner) → MANIFESTUL COMUN al lotului (§12): doar plicurile active cu AWB generat / ridicat, în ordinea numărului
   │      de plic, poziția 1…N; GET /awb/label?format=A6 pe părți de cel mult 100 (câte un buton pe parte); prima parte descarcă și PAGINA DE
   │      CONTROL. Același manifest face și „Documente lot (ZIP)” din Loturi (cu prefixul TEST_ pe un lot de test). Ecranul trimite cheia
   │      manifestului văzut; o evidență schimbată între timp = refuz („manifest schimbat”), nimic tipărit
   │ 5. Comanda curierului: în selfAWB (manual), o comandă pe zi, interval ≥ 2 h
   │ 6. „Urmărire” (owner) → GET /reports/awb/tracking în bucăți de ≤ 100 → doar PROPUNERI în evidență (C0 = ridicare propusă,
   │      S2 = livrat, retur cu motiv propus); „Confirmă ridicarea” (owner) → fn_red_fan_ridicat:
   │      lot REAL → red_plicuri.awb + data_expediere = data C0 (pornește termenul de 10 zile); lot de TEST → doar evidența FAN
   │ 7. „Confirmări / retururi” (owner) → GET /reports/awb/confirmations în bucăți de ≤ 100 → „lipsă” / „primită, de verificat” /
   │      „formă necunoscută” (niciodată „confirmat” automat); AR-ul îl înregistrează OMUL în Plicuri; returul semnalat → „Înregistrează
   │      returul…” deschide modalul Retur din Plicuri, cu motivul propus, iar omul atașează scanul plicului returnat
   ├ Reconciliere (owner, caseta „Reconciliere”): ziua borderoului + „Reconciliază” → propuneri pe rând („găsit: AWB …” / „nu apare în
   │      borderoul complet” / „de verificat în selfAWB”); „Confirmă AWB-ul” / „Confirmă absența” DOAR pe primele două; „de verificat” nu
   │      are buton (se verifică în selfAWB). fn_red_fan_reconciliaza scrie decizia omului
   └ Anulare înainte de ridicare (owner, caseta „Anulare AWB”): „Șterge la FAN” (DELETE /awb; doar forma de succes recunoscută marchează
          „anulat”) sau, după verificarea în selfAWB, „Marchează anulat” (fn_red_fan_anulat, cu motiv)
```

Toate butoanele de mai sus (pași + reconciliere, plafon, anulare, lista de evenimente) sunt VIZIBILE în ecran și dezactivate cu „transport oprit”
cât `TRANSPORT_REAL_ACTIV = false`. Fiecare acțiune are generația ei (L24): schimbarea lotului / închiderea ecranului oprește buclele
(propunere, confirmarea ridicării) înaintea apelului următor, iar mesajele / starea nu se mai actualizează pe alt lot.

De ce AWB-ul **nu** se scrie direct pe plic la generare: în ERP `red_plicuri.awb` și `data_expediere` sunt legate prin CHECK (ambele sau niciunul),
iar `data_expediere` declanșează „expediat” pe toate convocările plicului (trigger existent). Un AWB generat dar neridicat nu e expediere.
De aceea AWB-urile FAN stau în tabelul nou `red_fan_awb` până la evenimentul C0, confirmat de om.

Urmărirea (pașii 6–7) se rulează la cerere, de om. Un cron **nu** e în această livrare (nimic nu pornește automat).

**Împărțirea pe loturi de 100.** Lotul de plicuire din ERP (unitatea de aprobare) nu e același lucru cu lotul de solicitare către FAN: un lot de plicuire aprobat
se taie în bucăți de cel mult 100 de expedieri, iar fiecare bucată e o solicitare. Pentru primul val (~1.400 de plicuri): cel puțin 14 solicitări la creare,
cel puțin 14 la fiecare rulare de urmărire și cel puțin 14 la confirmări. Cât timp limita de solicitări pe minut nu e cunoscută, solicitările se trimit pe rând, cu pauză între ele.

---

## 4. Securitate — fișa a–e (CLAUDE.md pct. 7)

- **(a) Conținut extern citit**: răspunsurile API FAN — rezultatul creării (AWB, tarif, erori), evenimentele de urmărire, lista de confirmări, lista de evenimente, borderoul zilei, PDF-ul etichetelor, răspunsul ștergerii. Sunt **date**, nu instrucțiuni: se validează strict (coduri pe listă albă, AWB numeric, date cu formă fixă), forma necunoscută devine „de verificat de om”. **Textele FAN nu se păstrează și nu se afișează ca atare** (runda 2): motivul unui refuz FAN = doar numele câmpurilor semnalate, dintr-o listă albă (câmpurile corpului trimis: `phone`, `county`, `street` …), plus un mesaj local („detaliile în selfAWB”) — valoarea respinsă (telefon, adresă) și mesajul FAN nu ajung în BD și nici în ecran. Singurul text FAN afișat (nestocat) e numele codurilor din lista de evenimente, la comparația cerută de owner. Nimic ireversibil nu pornește dintr-un răspuns FAN: ridicarea (cu efect juridic), AR-ul, returul, reconcilierea și anularea le confirmă omul. Răspunsul confirmărilor nu se stochează (poate conține numele primitorului). Limită declarată: evidența nu conține PII trimise de noi, dar un text scris de om (motivul unei reconcilieri / anulări) e liber — ecranul îl completează cu un text standard, fără date personale.
- **(b) Ce scrie / face**: rânduri în `red_fan_awb`, `red_fan_loturi`, `red_fan_setari` (doar prin RPC-uri `fn_red_fan_*`, fără drept de scriere directă), și, la confirmarea ridicării pe un lot real, `red_plicuri.awb` + `data_expediere` (prin trigger-ele existente, expedierea pe convocări). **Cheltuie bani**: AWB-uri (`POST /intern-awb`). Nu trimite mail/SMS. Nu atinge drepturi. Nu scrie fișiere în storage (eticheta se descarcă direct).
- **(c) Identitate**: JWT-ul omului (anon key + Authorization), RLS normal, **fără service_role**. Credențialele FAN stau doar în Edge Secrets, citite DOAR pe calea reală (după poarta owner și flag), niciodată trimise clientului, logate sau scrise în BD; login-ul are parametrii în query string, deci URL-ul nu se loghează.
- **(d) Cine pornește**: **poarta de ROL în cod** — funcția edge cere owner (`fn_sms_e_owner()` pe `auth.uid()`, nu din corp; JWT-ul singur nu ajunge) pe **toate** acțiunile; RPC-urile cer owner (`fn_red_fan_e_owner()`) pentru marcaj, plafon, aprobare, claim, rezultate, urmărire, confirmări, ridicare, reconciliere, anulare. Propunerea (fără cost, fără FAN) → admin/editor Redări.
- **(e) Confirmare umană**: aprobarea pe lot (marcaj test / real, plafon pilot, hash-ul exact al datelor) e **obligatorie înainte de orice apel plătit**; generarea refuză rândurile al căror hash diferă de cel aprobat, iar rezervarea refuză dacă sursele (contactele) s-au schimbat după citire; fiecare rulare (generare, urmărire, confirmări) e un apăsat de om, cu cel mult 5 solicitări de creare pe apăsat; ridicarea, returul, reconcilierea (rând cu rând) și anularea se confirmă de om. Marcajul TEST / real e imuabil după PRIMA aprobare a lotului (în BD: coloana istorică + trigger), iar ecranul îl blochează la fel.
- Regula tare (a)+(b): citește conținut extern și cheltuie → poartă de rol (owner) + pas de aprobare: **ambele prezente**, plus `TRANSPORT_REAL_ACTIV = false` până la activare.

Lecții review aplicate: L01/L04 (claim atomic cu o cheie pe solicitare, CAS pe stare și cheie), L02 (rezultatele unei solicitări într-un singur RPC; ridicarea = rând FAN + plic în aceeași tranzacție),
L05 (timeout/5xx = „necunoscut”: fără retry automat, rularea se oprește, reconciliere prin borderoul zilei după `nr_plic`, confirmată de om), L06 (ordinea lock-urilor scrisă în migrare),
L08 (identitatea = `auth.uid()`), L09 (lotul citit cu JWT-ul omului; fiecare rând verificat pe lotul lui), L10 (secret propriu FAN, fără fallback), L12 (formă necunoscută = de verificat),
L16 (un singur rând viu pe plic, AWB unic), L17 (ora României), L18 (eroare FAN ≠ gol; tarif necunoscut = NULL, nu 0, nu rotunjit), L22 (pas durabil înainte de apelul plătit), L23 (citiri keyset).

---

## 5. Cazurile urâte

| Caz | Ce face ERP-ul |
|---|---|
| FAN răspunde cu `errors` pe un element | acel rând = „eroare” + câmpurile semnalate (listă albă, fără textul FAN); nimic plătit pe el; celelalte din solicitare rămân cu rezultatul lor. Se corectează adresa și se re-propune (hash nou → aprobare nouă). Plicul respins NU intră în manifestul tipăririi (nici etichetă, nici documente; numit „rămas” pe pagina de control). |
| Timeout / 5xx / rețea după `POST /intern-awb` | **toate** rândurile din acea solicitare = „necunoscut”, rularea se oprește. **Nu** se reîncearcă automat (AWB dublu = cost dublu). „Reconciliază” (owner) citește `GET /reports/awb?date=` și **propune** pe `nr_plic`: găsit → omul confirmă „generat”; „lipsă” se propune DOAR dacă borderoul a fost citit complet (până la pagina goală) ȘI fiecare element din fiecare pagină a fost înțeles (AWB valid + referința într-un câmp cunoscut, fără numărul plicului inclus într-un text mai lung). Un singur element neînțeles (de ex. AWB valid cu referința într-un câmp necunoscut, sau un AWB manual fără observații în aceeași zi) = TOATE rândurile „de verificat în selfAWB”, fără buton de confirmare: altfel omul ar confirma o absență falsă, rândul s-ar re-propune și s-ar plăti al doilea AWB. |
| Același plic: contactul schimbat între citirea funcției edge și rezervare | claim-ul recalculează amprenta surselor în tranzacția lui → refuz, nimic rezervat, nimic plătit; „Generează” din nou după reîncărcare (hash nou = re-propunere + aprobare). O schimbare comisă DUPĂ rezervare nu mai contează: se trimit datele aprobate și verificate la rezervare. |
| Două rulări de urmărire / confirmări în paralel | fiecare rând poartă versiunea citită; BD-ul scrie doar dacă versiunea e aceeași și evenimentul nu e mai vechi decât cel scris; altfel rândul e „depășit” (nescris, numărat în mesaj). |
| Răspunsul de creare poartă referința (observation / content) altui plic decât cel de pe poziție | toată solicitarea = „necunoscut” (asocierea contrazisă), reconciliere. Fără referință în răspuns: asocierea pe poziție, numărată în mesaj („asociate pe poziție: de verificat în selfAWB”) până la confirmarea formei (Testul 1). |
| Rezultatul nu se poate scrie în BD după apelul FAN | rândurile rămân „în curs”, rularea se oprește; după 10 minute se reconciliază ca mai sus. |
| Token expirat (401) | un singur login nou, apoi aceeași solicitare, cu aceeași rezervare (401 e refuz înainte de prelucrare). |
| Refuz 4xx care conține totuși un număr AWB | toată solicitarea = „necunoscut” (AWB-ul poate exista), reconciliere. |
| Adresă care nu e în nomenclator | blocaj la previzualizare (în această livrare: doar completitudinea; nomenclatorul la activare, §9). |
| Telefon lipsă | blocaj la previzualizare: telefonul e obligatoriu la generarea AWB-ului (documentația actuală), fără excepție în API. |
| Mai mult de 100 de expedieri / AWB-uri într-o solicitare | nu se trimite: ERP-ul împarte în loturi de cel mult 100 înainte de apel (creare, urmărire, confirmări, etichete); claim-ul din BD refuză peste 100. |
| Răspuns cu alt număr de elemente decât cel trimis, sau același AWB de două ori | rândurile fără pereche sigură rămân „necunoscut”; asocierea nu se ghicește. |
| Limită de solicitări pe minut (nedocumentată) | solicitările se trimit pe rând, cu pauză; un 429 oprește rularea (rândurile acelei solicitări = „eroare”, se re-propun), care se reia de om, nu automat. |
| Plic deja cu AWB (FAN sau manual) | nu primește al doilea: un singur rând viu pe plic (index unic), claim doar din „aprobat”, plicul trebuie fără AWB și fără expediere. |
| Lot de TEST | marcat înainte de aprobare, imuabil după PRIMA aprobare (istoric, și după o re-propunere); titlul, borderoul CSV și fișierele (etichete, borderou, pagina de control, arhiva documentelor și fișierele din ea) încep cu „LOT DE TEST” / „TEST_”; ridicarea nu scrie pe plic, deci nu apare în registru, PV sau export. |
| Lot peste plafonul pilot | aprobarea se refuză (plicuri deja aprobate + noi > plafon); owner-ul ridică plafonul din ecran („Schimbă plafonul”) după primele loturi. |
| Etichete și documente pe un lot cu plicuri respinse / fără AWB | aceeași mulțime și aceeași ordine (manifestul comun): doar plicurile cu AWB tipăribil, pozițiile 1…N; restul „rămase”, numite pe pagina de control, fără etichetă și fără documente. După o corectură (plicul rămas primește AWB), se retipărește TOT lotul (etichete + documente + pagina de control), iar foile vechi se distrug: pozițiile se pot schimba. |
| Urmărire: eveniment cu cod / dată de formă necunoscută, ultimul cod necunoscut, S50 | „de verificat de om”, nu livrat / retur. |
| Confirmări: răspuns care nu e listă, sau element fără AWB | „formă necunoscută” pe toate AWB-urile cerute; niciodată „confirmat”. |
| Etichetă: răspuns care nu e PDF | eroare afișată (502), nimic descărcat. |
| Redirecționarea livrării de către destinatar | nu se poate opri din API; o dezactivează FAN, prin excepția acceptată pe 13.11.2026. De verificat pe primele AWB-uri că excepția e activă. |
| Plic anulat după AWB | doar înainte de C0: `DELETE /awb`, apoi „anulat” — DOAR la forma de succes recunoscută; 5xx, 200 cu eroare, corp gol sau altă formă = AWB-ul rămâne „generat”, omul verifică în selfAWB, apoi „Marchează anulat”. Până atunci AWB-ul plicului anulat nu se tipărește (manifestul îl numește „de anulat”). După C0: nu se mai anulează din ERP. |
| AWB generat, plic modificat între timp | rândul are hash-ul datelor; generarea compară hash-ul aprobat cu datele curente și exclude rândul. |

---

## 6. Ce conține codul (17.11.2026, inert)

- `supabase/migrations/20261212a_redari_fan_awb.sql` — **NEAPLICATĂ**, în **forma livrării L15 v2** (`docs/LIVRARE_L15_V2.md`, tiparul `20261225a`): garda de livrare legată de nume + tranzacție, plafonul 5000 în forma acceptată de validator (`'5000/session'` + marcajul `'5000:' || txid_current()`; `--plafon-tranzactie-ms 5000` acceptat, 2000 / fără plafon refuzate), garda pasului global „înainte” în aceeași tranzacție (`AMPRENTA_GLOBALA_LIPSA`), amprenta poartei de drept `fn_red_nivel` înainte și după, bugetul de lock de 1 s de la PRIMA încercare (ordine fixă: `red_proiecte` → `red_loturi_plicuire` → `red_plicuri`, SHARE ROW EXCLUSIVE, NOWAIT, subtranzacție pe încercare) și inventarul lock-urilor implicite în comentariul blocului. Coloanele de autor nu mai au cheie străină spre `profiles` (ar fi cerut lock pe `profiles` la aplicare). Lista OBIECTELOR din manifest: `supabase/tests/20261212a_redari_fan_awb.l15.obiecte.tsv` (generată pe PGlite cu pașii reali ai runnerului; manifestul `.l15.tsv` propriu-zis îl generează coordonatorul pe clonă). Tabele: `red_fan_awb` (un rând viu pe plic, stări + urmărire cu versiune + confirmare, fără PII), `red_fan_loturi` (marcajul TEST / real + prima aprobare, trigger de gardă), `red_fan_setari` (plafonul lotului pilot, un rând, implicit 20). RLS: citire admin/editor Redări; scriere doar prin RPC. RPC-uri: `fn_red_fan_setari_seteaza`, `fn_red_fan_lot_marcheaza`, `fn_red_fan_propune`, `fn_red_fan_aproba`, `fn_red_fan_claim_lot` (≤ 100 de rânduri, o cheie, amprenta surselor), `fn_red_fan_rezultate` (toate odată, CAS), `fn_red_fan_reconciliaza`, `fn_red_fan_ridicat` (lot real → plicul expediat; lot de test → doar evidența), `fn_red_fan_urmarire` / `fn_red_fan_confirmari` (versiune, `{scrise, depasite}`), `fn_red_fan_anulat`; interne: `fn_red_fan_e_owner`, `_suma`, `_camp`, `_surse`, `_loturi_garda`. Revenire: `supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql`, în forma revenirilor (prin runner, plafonul 2000, fără amprentă globală — varianta A din `docs/LIVRARE_L15_V2.md` §9): refuză cu orice AWB, lot marcat, setări schimbate, funcție `fn_red_fan_*` în plus sau dependență străină; lock-urile în ordinea căilor aplicației, înaintea verificării „fără date”.
- Probe: `scripts/pglite/test_redari_fan_awb_local.mjs` (validatorul real, aplicarea ca runnerul cu manifest generat + garda finală, comportamentul ca roluri, refuzurile, bugetul de lock, revenirea, 18 mutanți, paritatea JS ↔ SQL a amprentei surselor) și `supabase/tests/20261212a_redari_fan_doua_sesiuni.sh` (două sesiuni reale, pe clonă, §11 — netestat local).
- `supabase/functions/_shared/redariFan.mjs` — funcții pure: corpul `intern-awb`, contactul pe plic, hash-ul, bucățile de ≤ 100, interpretarea răspunsurilor (creare pe element, urmărire, confirmări, evenimente, borderou), data evenimentelor în ora României, căile etichetei (A6) și ale listelor de AWB.
- `supabase/functions/_shared/redariFanTransport.mjs` — calea reală (login, creare, urmărire, confirmări, evenimente, etichete, reconciliere, ștergere), cu toate dependențele injectate.
- `supabase/functions/_shared/redariFanHandler.mjs` + `supabase/functions/redari-fan-awb/index.ts` — poarta owner; `TRANSPORT_REAL_ACTIV = false` → 423 „transport_real_oprit” **înainte** de secrete, BD (în afara lotului) sau rețea. Acțiuni: `genereaza`, `eticheta`, `urmarire`, `confirmari`, `evenimente`, `reconciliaza`, `sterge_awb`.
- `src/redari/fanLot.js` + `src/redari/ui/FanAwbPrevizualizare.jsx` — în ✉️ Poștă, la fiecare lot, „📦 AWB FAN”: previzualizarea pe plic + cei 7 pași + operațiile (reconciliere cu confirmarea pe rând, plafonul pilot, anularea AWB-ului, lista de evenimente, etichetele pe toate părțile), toate dezactivate vizibil cu „transport oprit”; marcajul de TEST în titlu și în fișiere; borderou CSV fără date personale; pagina de control.
- `src/redari/plicuri.js` (`planPachetPlicuire`, `genereazaPaginaControl`, `ordineConvocari`) + buton „Documente lot (ZIP, în ordinea plicurilor)” în Loturi: documentele arhivate (opis + convocări) + pagina de control, într-un singur fișier. Pe un lot FAN (marcat TEST / real) arhiva folosește manifestul comun cu etichetele (`manifestTiparire` din `redariFan.mjs`, aceeași funcție ca funcția edge) și prefixul `TEST_` pe un lot de test; pe un lot de Poștă, toate plicurile active. Numele: poziția plicului pe 4 cifre, documentul pe 3 (opisul = `000`): `0001_PL-ABC-0007_000_opis.docx`, `0001_PL-ABC-0007_001_C-000123.docx` — sortarea alfabetică = ordinea de tipărire (§12).

**Eticheta: A6 fix.** Decizia proprietarului: format A6 (100×150 mm) pentru imprimanta termică. Codul cere mereu `format=A6` (constanta `FORMAT_ETICHETA`), fără alegere în ecran.

**Tipărire pe lot.** Documentația spune că `/awb/label` primește mai multe AWB-uri într-un apel (`awbs[]`) și întoarce un PDF → ERP-ul cere **AWB-urile manifestului, în ordinea pozițiilor**, și descarcă **un fișier** pe parte. Fără librării noi: nu se lipesc PDF-uri în browser (pdf-lib nu e compatibil cu build-ul nostru). Peste 100 de AWB-uri (limita de etichete pe apel nu e documentată; s-a ales prudent aceeași limită de 100) etichetele vin în **părți numerotate** (`_partea01din02`), câte un buton pe parte, cu pozițiile scrise pe buton; cu plafonul pilot (20) lotul încape într-un fișier. Că PDF-ul păstrează ordinea din `awbs[]` e de verificat la Testul 1 (§11).

## 7. Revenire

- Înainte de orice AWB real: se șterge funcția edge, se aplică revenirea prin runner (`--plafon-tranzactie-ms 2000`, comanda e în antetul fișierului; refuză dacă există rânduri FAN, loturi marcate sau setări schimbate), se scoate butonul din UI (revert PR).
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
11. Ordinea elementelor din răspunsul `POST /intern-awb` = ordinea expedierilor trimise? Are fiecare element un identificator al expedierii (referința noastră în `observation` / `content`)? Documentația nu dă un identificator pe element: codul folosește referința DACĂ apare (o referință diferită de plicul de pe poziție = toată solicitarea „necunoscut”) și altfel asociază pe poziție, doar la număr egal de elemente — **presupunere de confirmat pe răspunsul real** (Testul 1); asocierile pe poziție sunt numărate în mesajul generării.
12. Câmpul `observation` (sau `content`) apare tipărit pe eticheta A6? Limita lui de caractere? De confirmat la Testul 1 (altfel numărul plicului se scrie de mână pe plic, §12).
13. Codul de eveniment pentru „destinatar negăsit / necunoscut la adresă”: nu e în lista de lucru; de luat din `/reports/awb-events`. Până atunci, semnalele de adresă propun „adresă incompletă”, iar omul alege motivul final.
14. Limita de AWB-uri pe apel la `/awb/label` și dacă PDF-ul păstrează ordinea din `awbs[]`.
15. Forma răspunsului de succes la `DELETE /awb` (runda 2). Codul acceptă ca „șters” DOAR HTTP 200 + `status: "success"` fără erori (forma generală a răspunsurilor FAN, ca la login); orice altceva păstrează AWB-ul și cere verificarea în selfAWB. De confirmat pe un răspuns real, la Testul 1 (ștergerea unui AWB de test).
16. Formatul elementelor din borderoul zilei (`GET /reports/awb`) — unde stă referința noastră. Un element fără referință într-un câmp cunoscut (de ex. un AWB făcut manual în selfAWB în aceeași zi, fără observații) face reconcilierea zilei „de verificat de om” pentru toate rândurile; recomandare operațională: în zilele cu generare din ERP, AWB-urile manuale primesc o observație.

## 9. De făcut în cod

Făcute pe 17.11.2026 (inerte, testate pe răspunsuri simulate):

1. ✅ **Loturi de cel mult 100 la creare**: `imparteInBucati` + `interpreteazaRaspunsLot` (asociere pe poziție doar la număr egal de elemente, rezultat parțial pe element, „necunoscut” pe toată bucata la timeout/5xx sau formă ambiguă) + `fn_red_fan_claim_lot` / `fn_red_fan_rezultate` (o cheie pe solicitare, toate rezultatele odată). Alegerea între 1 și 100 pe apel: codul acceptă orice mărime 1…100; implicit 100, cu oprire la primul rezultat necunoscut.
2. ✅ **Loturi de cel mult 100 la urmărire și la confirmări**: acțiunile `urmarire` și `confirmari`, `awb[]` în bucăți de cel mult 100.
3. ✅ **Confirmări în format JSON**: `GET /reports/awb/confirmations` cu `clientId`, `awb[]`, `language=ro`; răspunsul nu se stochează, doar starea (deschisă 7).
4. ✅ **Lista de evenimente**: acțiunea `evenimente` compară `GET /reports/awb-events` cu `EVENIMENTE_FAN` (coduri lipsă la FAN / coduri FAN neclasificate). Lista din cod rămâne cea din PDF până la comparația pe răspunsul real (§10 pasul 6).
5. ✅ **Comentariul de sursă** din capul `redariFan.mjs` actualizat (docs-unified 1.1.0 + răspunsurile FAN din 12–13.11.2026).
6. `TRANSPORT_REAL_ACTIV` rămâne `false` (răspuns 423) până la PR-ul de activare, după acordul owner-ului; testul care o cere rămâne.

7. ✅ **Runda 2** (verdictul PR #1118): reconcilierea fără concluzii pe elemente neînțelese, manifestul comun etichete ↔ documente + pagina de control, ștergerea strictă, marcajul imuabil istoric, operațiile în ecran + garda de generație, motivele fără PII, numele din arhivă, amprenta surselor la rezervare, versiunea urmăririi, referința pe element; migrarea și revenirea în forma livrării L15 v2.

Rămase pentru activare (după răspunsuri FAN / juridic): validarea adreselor cu nomenclatorul (`/reports/counties`, `/reports/localities`), tariful estimat (deschisă 8), comanda curierului prin API (deschisă 9), completarea `EVENIMENTE_FAN` după `/reports/awb-events`, confirmarea formelor de răspuns (deschise 10, 11, 15, 16).

## 10. Lista de activare (în ordine; ⚑ = cere acordul proprietarului; fiecare pas are proba lui și cine o face)

1. ⚑ **Juridic**: „da” scris pentru FAN + oPOD ca recomandată cu confirmare de primire (§8 deschisă 1). Fără el, convocările rămân la Poșta Română; FAN se poate folosi doar pentru loturi de TEST.
2. **FAN**: răspunsuri la §8 deschise 2, 3, 4, 6 (limita pe minut, contul de test, plicul, punctul de lucru). Contract activ pe API.
3. **Probele PostgreSQL pe clonă** (coordonatorul, cu 20261212a aplicată pe CLONĂ prin runner): `supabase/tests/20261212a_redari_fan_doua_sesiuni.sh` (§11, „Probele pe clonă”) → cod 0, toate rândurile `OK`; ieșirea întreagă în jurnalul livrării.
4. ⚑ **Migrarea 20261212a**, după procedura `docs/LIVRARE_L15_V2.md` §7 (pașii coordonatorului): citirea pe producție → manifestul `supabase/migrations/20261212a_redari_fan_awb.l15.tsv` generat pe clonă (`scripts/livrare_l15_manifest.sh … --plafon-tranzactie-ms 5000 --iesire …`) și comparat cu lista revizuită `supabase/tests/20261212a_redari_fan_awb.l15.obiecte.tsv` → `l15_compara_liste.sh` = `COMPARABIL` → PR de baseline (manifest + sha256) → review Jakarinos + Fable → recitirea din ziua livrării → proba cu ROLLBACK pe producție (`--compara-cu`, cu acordul owner-ului) → aplicarea de către chat (`livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala … --diferente-globale …`). Lock-urile la aplicare: SHARE ROW EXCLUSIVE pe `red_proiecte`, `red_loturi_plicuire`, `red_plicuri` (opresc doar scrierile Redări, ~1,3–1,6 s estimat). Postcondițiile sunt în migrare (RLS, drepturi pe fiecare rol, funcții, trigger, plafon 20). Revenirea: prin runner, cu 2000 (antetul fișierului de revenire).
5. ⚑ **Secretele** în Supabase → Edge Functions → Secrets (de proprietar): `FAN_SELFAWB_USERNAME`, `FAN_SELFAWB_PASSWORD`, `FAN_CLIENT_ID`. Pentru început: contul de test FAN, dacă FAN confirmă că nu generează AWB-uri plătite.
6. ⚑ **Publicarea funcției** `redari-fan-awb` (de chat), cu flag-ul încă `false`. **Proba 401 / 403 / 423 printr-un apel controlat** (din ecran nu se poate: toate butoanele sunt dezactivate), de pe server, cu acțiunea fără cost `evenimente` și un lot de TEST (`<URL>` = adresa proiectului Supabase, `<ANON>` = cheia publică; JWT-urile se iau din sesiunea contului respectiv și nu se scriu nicăieri):
   ```bash
   corp='{"actiune":"evenimente","lot_id":"<uuid lot TEST-RAZVAN>"}'
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H 'Content-Type: application/json' -d "$corp"                                   # așteptat 401 (fără JWT)
   curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT cont ne-owner, ex. contul de test Claude>" -H 'Content-Type: application/json' -d "$corp"   # așteptat 403 {"cod":"non_owner"}
   curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT owner>" -H 'Content-Type: application/json' -d "$corp"                                 # așteptat 423 {"cod":"transport_real_oprit"}
   ```
   Plus: un `actiune` necunoscut cu JWT-ul owner-ului → 400; jurnalul funcției (Supabase → Edge Functions → Logs) fără apeluri către api.fancourier.ro.
7. ⚑ **PR de activare** (separat, revizuit): `TRANSPORT_REAL_ACTIV = true` și schimbarea testului care cere `false`. Imediat după publicare, owner-ul apasă „Lista de evenimente FAN” (caseta de jos a ecranului) și compară lista; diferențele se pun în `EVENIMENTE_FAN` printr-un PR mic, înainte de prima urmărire reală.
8. ⚑ **Testul 1** (§11), apoi **Testul 2** (§11). Abia după ambele, plafonul pilot se ridică din ecran (caseta „Plafonul lotului pilot” → „Schimbă plafonul”, owner).
9. Registrul de automatizări + rândul din `public.automatizari` (fișa a–e de la §4), la activare (de chat).

## 11. Testele de activare

### Testul 1 — intern, 3 plicuri, unul refuzat

Scop: tot lanțul pe 3 plicuri trimise **la adrese interne**, pe proiectul de test, cu AMBELE respingeri: a plicului 2 **la creare** (FAN refuză
elementul) și a unui plic **la livrare** (destinatarul refuză). Lot marcat **TEST**.

**Înainte (decizii ⚑ ale proprietarului, scrise în jurnalul testului):** (a) **sandbox sau expedieri reale**: contul general de test FAN se
folosește DOAR dacă FAN confirmă în scris că AWB-urile lui nu sunt reale / nu se facturează (§8 deschisă 3); altfel Testul 1 = 3 (+1)
expedieri fizice PLĂTITE, cu acordul explicit pentru cost. Marcajul TEST din ERP NU schimbă contul FAN. (b) **trei adrese interne aprobate**
(colegi care acceptă), completate pe trei deținători de test, cu telefon. (c) documentele celor 3 plicuri arhivate (opis la dosar pe fiecare).

**Oprire imediată** (nu se continuă, se reconciliază / se lămurește, apoi se reia de la pasul în cauză) la: orice rezultat „necunoscut”;
„asociate pe poziție” > 0 fără verificarea în selfAWB a fiecărui AWB ↔ plic; tarif lipsă sau diferit de oferta FAN; referința (numărul
plicului) absentă de pe etichetă; ORICE nepotrivire între pagina de control, etichetă și teancul de documente; „manifest schimbat”.

| Pas | Ce face omul | Ce se verifică |
|---|---|---|
| 1 | În proiectul de test: 3 plicuri, lot de plicuire PP-xxxx, opis atașat pe fiecare. Plicul 2 primește o localitate care NU există în nomenclatorul FAN (ex. un sat inventat), ca FAN să-l respingă la creare | ✉️ Poștă → „📦 AWB FAN”: 3 din 3 plicuri cu toate datele (verificarea ERP e de completitudine); referința pe etichetă = numărul plicului |
| 2 | Admin/editor: „Propune 3 plicuri” | 3 rânduri „propus” |
| 3 | Owner: „Marchează TEST”, apoi „Aprobă” | titlul arată „LOT DE TEST”; 3 „aprobat”; „2a. / 2b.” devin inactive (marcajul nu se mai schimbă nici după o re-propunere) |
| 4 | Owner: „Generează AWB” | O solicitare cu 3 expedieri: 1 și 3 „AWB generat” (AWB + tarif), 2 „respins de FAN” cu câmpul semnalat (fără textul FAN). În selfAWB: 2 AWB-uri, cu numărul plicului la observații. Se notează: ordinea elementelor din răspuns și dacă fiecare element poartă referința (§8 deschisă 11); mesajul „asociate pe poziție” |
| 5 | Owner: „Etichete A6 (PDF)” | `TEST_PP-xxxx_etichete_A6.pdf` cu **2** etichete (PL-…-0001 pe poziția 1, PL-…-0003 pe poziția 2) + `TEST_PP-xxxx_pagina_de_control.docx`: 2 rânduri bifabile + „rămase: PL-…-0002”. Tipărirea pe imprimanta termică e corectă; **numărul plicului apare pe etichetă** (§8 deschisă 12) |
| 6 | Loturi → „Documente lot (ZIP, în ordinea plicurilor)” | `TEST_PP-xxxx_documente_in_ordinea_plicurilor.zip`: `TEST_0000_pagina_de_control.docx`, apoi `TEST_0001_PL-…-0001_000_opis.docx`, `TEST_0001_…_001_C-…`, `TEST_0002_PL-…-0003_000_opis.docx` …; **niciun fișier al plicului 2**; aceeași pagină de control |
| 7 | Verificarea pe pagina de control (§12): pentru fiecare poziție, eticheta = prima pagină (opisul) = teancul; bifa pe rând | toate cele 2 rânduri bifate; plicul 2 rămâne deoparte |
| 8 | (opțional, ⚑ cost) Corectarea plicului 2 (localitatea reală), „Propune”, „Aprobă”, „Generează” → apoi se retipărește TOT lotul (etichete + documente + pagina de control), foile vechi se distrug | manifestul are acum 3 poziții (PL-…-0003 trece pe poziția 3); pagina de control fără „rămase” |
| 9 | Ștergerea unui AWB de test înainte de ridicare (doar dacă se folosește un AWB suplimentar, ⚑ cost): „Anulare AWB” → „Șterge la FAN” | răspunsul real la `DELETE /awb` (se notează forma, §8 deschisă 15): dacă e cea recunoscută → „anulat”; altfel AWB-ul rămâne „generat”, verificare în selfAWB, „Marchează anulat” |
| 10 | Comanda curierului în selfAWB | curierul ridică plicurile tipărite |
| 11 | Owner: „Urmărire”, a doua zi | „ridicat (C0): de confirmat”, cu data C0; „Confirmă ridicarea” → rândurile FAN = „ridicat”; **plicurile din Poștă NU devin expediate** (lot de test) |
| 12 | Colegul destinatar al plicului 3 **refuză** plicul la livrare | „Urmărire” → plicul 3 = „RETUR”, propus „Refuz”; plicul 1 = „livrat (S2)” |
| 13 | Owner: „Confirmări / retururi” | 1: „confirmare primită: de verificat”; 3: „nicio confirmare”. Se notează forma reală a răspunsului (§8 deschisă 7) |
| 14 | Reconcilierea „pe uscat”: caseta „Reconciliere”, ziua generării | fără rânduri „necunoscut” butonul e inactiv; dacă a existat un „necunoscut”: propunerile se compară cu selfAWB înainte de orice confirmare; elementele neînțelese apar ca număr (§8 deschisă 16) |
| 15 | Borderou FAN (CSV) | primul rând „LOT DE TEST”; fără nume / adrese / telefoane |
| 16 | Factura FAN | exact AWB-urile din ERP, tariful = cel din ERP |

### Testul 2 — lot real, 10–20 plicuri dintr-un UAT

Precondiții: Testul 1 trecut, „da” juridic (§10 pasul 1), plafon pilot 20, telefoanele completate pe plicurile alese.

| Pas | Ce face omul | Ce se verifică |
|---|---|---|
| 1 | Lot de plicuire cu 10–20 plicuri dintr-un singur UAT, PV de plicuire semnat, opis la dosar pe fiecare | previzualizarea: toate plicurile cu date complete; cele fără telefon se scot din lot înainte |
| 2 | Admin/editor: „Propune” | N rânduri „propus” |
| 3 | Owner: „Marchează real”, „Aprobă” | N „aprobat”; peste 20 → refuz cu mesajul plafonului |
| 4 | Owner: „Generează AWB” | o solicitare; N AWB-uri; niciun „necunoscut” (altfel: stop, „Reconciliază”, nu reapăsa) |
| 5 | „Etichete A6”, „Documente lot (ZIP, în ordinea plicurilor)” | un PDF cu N etichete, un ZIP cu documentele și ACEEAȘI pagină de control în ambele: aceeași mulțime, aceleași poziții (manifestul comun); „rămase” = 0, altfel stop: plicurile rămase se scot din lot sau se rezolvă înainte de tipărire |
| 6 | Plicuirea și verificarea pe pagina de control (§12) pe fiecare plic, de cei 2 colegi din PV | toate rândurile bifate; niciun plic cu numere diferite |
| 7 | Comanda curierului, ridicarea | „Urmărire” → C0 pe toate; „Confirmă ridicarea” → plicurile devin expediate în Poștă, cu AWB-ul și data C0; termenul de 10 zile se calculează de la data C0 |
| 8 | Zilnic: „Urmărire” + „Confirmări / retururi” | livratele → AR-ul se înregistrează din cartonașul oPOD fizic; retururile → „Înregistrează returul…” cu scanul plicului returnat → apar în PV B la „Demersurile de convocare” (AWB, data expedierii, retur) |
| 9 | Exportul pentru Transgaz | AWB-urile FAN apar ca număr de urmărire, datele de expediere = C0 |
| 10 | Bilanț | cost total = factura FAN; abia apoi se ridică plafonul pilot |

Testul 2 pornește DOAR după Testul 1 acceptat (jurnalul lui, cu formele reale ale răspunsurilor) și după „da”-ul juridic (§10 pasul 1).

### Probele pe clonă (PostgreSQL real, de coordonator; nu se pot rula pe serverul de cod)

`supabase/tests/20261212a_redari_fan_doua_sesiuni.sh` — două sesiuni psql reale, barieră pe lock consultativ, codul fiecărei sesiuni păstrat;
rânduri FAN sintetice pe un lot al proiectului de test, șterse la final (contactele nu se modifică persistent). Rezultatele așteptate:

| Scenariu | Ce face | Rezultat așteptat |
|---|---|---|
| K1 | două rezervări (claim) pe aceleași 2 rânduri; A ține tranzacția 3 s, apoi COMMIT | B așteaptă ≥ 1 s (lock-ul lotului), apoi `P0001`; în BD 2 rânduri `in_curs` cu O SINGURĂ cheie |
| K2 | la fel, A face ROLLBACK | B așteaptă, apoi rezervă el (o cheie) |
| S1 | în aceeași tranzacție: contactul unui deținător al plicului schimbat, apoi claim cu amprenta citită înainte; ROLLBACK | `P0001` „datele de contact … s-au schimbat”, nimic rezervat |
| S2 | A ține necomisă o schimbare de contact; B rezervă | B NU așteaptă și rezervă (schimbarea comisă după rezervare nu contează: se trimit datele aprobate și verificate) |
| U1 | două scrieri de urmărire cu aceeași versiune citită; A ține 3 s | B așteaptă rândul, apoi `{"scrise": 0, "depasite": 1}`; final: datele lui A, versiunea 1 |
| M1 | A aprobă (prima aprobare a lotului), B schimbă marcajul TEST → real | B așteaptă lock-ul lotului, apoi `P0001` |
| R1 | roluri reale: editor ne-owner, viewer, anon, owner pe scriere directă | editor: claim / aprobare / urmărire `42501`; viewer: 0 rânduri (RLS); anon: `42501`; UPDATE direct ca owner: `42501` |

Rulare: `PSQL=/c/Users/Public/pgsql/bin/psql.exe LOT=<uuid> OWNER=<uuid> EDITOR=<uuid> VIEWER=<uuid> bash supabase/tests/20261212a_redari_fan_doua_sesiuni.sh --sistem <system_identifier clonă> -- -h <host> -p <port> -U postgres -d postgres`
→ cod 0. Tot pe clonă (L15 v2): concurența la aplicare după `supabase/tests/l15_aplicare_concurenta.sh` (o variantă pentru 20261212a, cu setul
`red_proiecte` → `red_loturi_plicuire` → `red_plicuri`: L0 control `IDENTIC`, L1 `red_plicuri` ținut ⇒ `BUGET_LOCK` la ~1 s fără așteptare
până la eliberare, L2 eliberat la ~400 ms ⇒ `IDENTIC` cu ≥ 2 încercări) și proba aplicare → revenire → re-aplicare prin runner.

## 12. Ghidul operatorului: verificarea celor trei numere (protecția contra plicului greșit)

Un plic pus în alt plic decât cel cu eticheta lui trimite date personale altei persoane. De aceea etichetele și documentele lotului vin din
ACELAȘI manifest (aceeași mulțime, aceeași ordine, pozițiile 1…N) și sunt însoțite de **pagina de control** (poziție · nr. plic · AWB ·
destinatar mascat · nr. documente · bifă), descărcată odată cu etichetele (prima parte) și pusă prima în arhiva documentelor
(`0000_pagina_de_control.docx`). La plicuire, pentru **fiecare** rând al paginii de control, cei doi colegi din PV verifică:

1. **Eticheta** de pe poziția N din PDF poartă numărul plicului de pe rând (câmpul de observații / referință al AWB-ului, ex. `PL-ABC-0007`).
2. **Prima pagină din plic** (teancul cu prefixul `000N_`) e **opisul** acelui plic („Opis - plicul PL-ABC-0007”).
3. **Opisul față de conținut**: numerele convocărilor din opis = convocările puse în plic (numărul de documente de pe rând = opis + convocări), și numele destinatarului din opis = numele de pe etichetă.

Toate trebuie să se potrivească; altfel plicul nu se închide și se reface. Plicurile „rămase” (fără AWB) nu au etichetă și nici documente în
arhivă: nu se plicuiesc în acest lot. Dacă eticheta A6 nu tipărește observațiile (§8 deschisă 12), numărul plicului se scrie de mână pe plic,
lângă etichetă, înainte de verificare.

### Două puncte NEDECISE de proprietar (opțiuni; nimic implementat în această livrare)

**(a) Numărul plicului și pe prima pagină a convocatorului.** Azi opisul e prima pagină din plic și poartă numărul; convocatorul nu.
- **A1 — rămâne opisul** (azi, fără schimbare): verificarea se face pe opis + pagina de control. Nu cere nimic nou.
- **A2 — câmp nou `{{nr_plic}}` în antetul convocatorului**: cere un PR SEPARAT de șablon (șabloanele DOCX sunt în lucru în #1117, nu se
  ating aici), plus: completarea câmpului la generare (convocatorul se generează ÎNAINTE de plic, deci câmpul ar cere regenerarea convocatorului
  după punerea în plic, sau generarea lui abia la plicuire — schimbare de flux), testele șablonului, și verificarea juridică a antetului.
  Până la decizie, opisul rămâne prima pagină din plic.

**(b) Documentele lotului: arhivă ZIP ordonată sau un PDF unic.**
- **B1 — ZIP ordonat** (azi): fișierele DOCX arhivate, cu numele care se sortează corect (poziție pe 4 cifre, document pe 3), pagina de
  control prima. Tipărirea = deschiderea fișierelor în ordine (sau „tipărește tot” din aplicația de arhivă). Nu cere nimic nou.
- **B2 — un PDF unic**: conversia DOCX → PDF și lipirea nu se pot face în browser cu dependențele de azi (pdf-lib nu merge pe Vercel); ar cere
  o **unealtă nouă pe server** (ex. LibreOffice fără interfață + o coadă de conversie), cu fișa a–e, spațiu de stocare pentru PDF-uri și
  acordul pentru o automatizare nouă. Câștig: o singură comandă de tipărire, aceeași ordine garantată de fișier.
