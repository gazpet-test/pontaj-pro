# FAN Courier în Redări — document de proiectare

Stare: **cod complet; ACTIVARE pentru Testul 1 (PR separat, 18.11.2026)**. Codul inert a intrat pe `main` prin PR #1118 (17.11.2026); migrarea
`20261212a` e **aplicată** pe mediul real din 17.11.2026 (146 de obiecte, tabelele goale). PR-ul de activare pune `TRANSPORT_REAL_ACTIV = true`
cu garda **`DOAR_PROIECTE_TEST = true`** (`redariFanHandler.mjs`): calea reală DOAR pe un lot al unui proiect `TEST-…` marcat TEST de owner;
orice alt lot = 423 `transport_real_doar_test`, înainte de secrete și de orice apel. Procedura zilei (singura definiție a ordinii pașilor): `FAN_TEST1_PASI.md`. Plafonul de UN plic
(pasul 4a) și apoi 3 (4b) = setarea `red_fan_setari.limita_lot`, pusă de owner din ecran, nu cod. Testul 2 = PR separat (`DOAR_PROIECTE_TEST = false`).
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

**Actualizare 17.11.2026, runda 3 (re-review PR #1118: GO cu condiții pentru codul inert, NO-GO pentru activare).** Închise în cod, fiecare cu
test care pica pe forma rundei 2: (1) **tirajul** — toate descărcările unui lot (fiecare parte a etichetelor, arhiva documentelor) cer ACEEAȘI cheie
de manifest, fixată în BD la prima descărcare; o descărcare dintr-o stare diferită e refuzată („tirajul s-a schimbat; retipărește tot lotul”), iar
identificatorul scurt al tirajului apare pe pagina de control și în numele fișierelor; pagina de control din etichete și cea din arhivă sunt
identice (§3, §5, §12); (2) urmărirea nu mai șterge un eveniment cunoscut cu un răspuns fără evenimente (§5); (3) scriptul cu două sesiuni e
reparat și are un **fixture sintetic** pentru clona fără date Redări (§11); (4) garanția rezervării e scrisă exact (§5); (5) asocierea pe poziție
rămâne „presupunere neconfirmată”, cu pas blocant în lista de activare (§8 deschisă 11, §10); (6) istoricul livrării la reaplicarea de test și
versiunea migrării, consemnate (§7).

**Actualizare 17.11.2026, runda 4 (re-review PR #1118 pe fdaa0496: GO cu condiții pentru codul inert, NO-GO pentru activare).** Închise în cod,
fiecare cu test care pică pe fdaa0496: (1) **înlocuirea tirajului nu mai lasă să treacă o descărcare începută** — reverificarea FINALĂ a
tirajului după PDF / arhivă, înainte de livrare, plus „Tiraj nou” în trei pași impuși de BD (oprește → 30 s → înlocuiește), cu evidența fiecărui
pas în jurnalul Redări (§5); (2) **urmărirea păstrează faptele** (ridicare, livrare, retur + motiv) peste răspunsurile mai sărace, iar o
corectură care contrazice un fapt devine „de verificat de om” cu ambele valori (§5); (3) documentul consemnează deciziile proprietarului din
17.11.2026 (contul de TEST, numărul plicului pe convocator, arhiva ZIP) și lista de activare în ordinea recenzentului (§10, §11, §12);
(4) fixture-ul verifică precondițiile înaintea oricărei scrieri, fără plasă pentru trigger-ul real (§11); (5) proba de concurență la APLICARE
are profilul acestei migrări (§10, §11).

**Actualizare 17.11.2026, runda 5 (re-review PR #1118 pe 58abaa54: GO cu condiții pentru codul inert, NO-GO pentru activare pe două probleme
de cod).** Închise în cod, fiecare cu test care pică pe 58abaa54: (1) **ceasul opririi** — cele 30 de secunde dinaintea înlocuirii tirajului se
numără de la MOMENTUL EFECTIV al opririi (ceasul BD-ului luat după lock-uri, nu începutul tranzacției), iar durata se verifică tot pe ceasul
efectiv; la fel rezervarea și cele 10 minute ale reconcilierii (§5); (2) **soluționarea contradicțiilor urmăririi** — owner-ul sau un admin
Redări alege explicit, pentru fiecare fapt contrazis, valoarea care rămâne, cu motiv; istoricul rămâne în jurnalul Redări; un răspuns FAN sosit
între timp blochează soluționarea; o contradicție nouă redeschide verificarea (§5, §6); (3) proba L1b a concurenței la aplicare numără doar
eșantioanele luate cât aplicarea chiar așteaptă (§11); (4) proba cu două sesiuni măsoară și durata reală de 30 s pe ceasul serverului (T3b, §11).

**Actualizare 18.11.2026, după PRIMUL AWB real (Testul 1, lot de TEST cu un plic; PR separat, fără migrare).** Ce a arătat proba și ce s-a corectat
în cod, fiecare cu test care pică pe forma de dinainte (2f7fabc1): (1) **tariful** exista în rând, dar nu se vedea → afișat lângă AWB (lei, 2 zecimale,
fără TVA; TVA-ul alături) și ca total pe lot; gol = „tarif necunoscut”, evidențiat (procedura cere oprire); în borderoul CSV (§3, §6); (2) **eticheta
a venit pe pagină A4** deși cererea trimite `format=A6` (parametrul din documentația FAN, §1) → butonul, mesajul și numele fișierului nu mai afirmă A6
(`…_etichete.pdf`), formatul se verifică pe PDF înainte de tipărire; parametrul rămâne cel documentat, nu se ghicește altul (§8, deschisă 17: întrebare
pentru curier); (3) **„1. Propune” rămânea activ** după ce toate plicurile aveau AWB → dezactivat cu motiv când nimic nu e de propus (`starePropunere`:
fără rând FAN viu, sau viu „propus” / „aprobat” pe alt hash); ecranul trimite doar lista de propus (nu mai readuce un rând aprobat la „propus”); RPC-ul
refuza oricum un plic cu AWB (P0001, fără rând dublu); (4) **„2b. Marchează real” era activ** pe lotul nemarcat → dezactivat cât garda „doar TEST” e
pornită (`stareMarcajReal`, aceeași definiție în ecran și în simulatorul procedurii; cu `DOAR_PROIECTE_TEST = false` redevine marcajul obișnuit);
(5) **37 de coduri de eveniment neclasificate** în lista reală `/reports/awb-events` → clasificate DOAR după numele curierului (§1): tranzit, avizat,
contact, „AWB înregistrat” (S98), iar cele cu sens nelimpede rămân „de verificat de om”. Comanda curierului prin API (`POST /order`) rămâne manuală:
analiza a ce lipsește e în raportul livrării (§8, deschisă 9).

**Actualizare 18.11.2026, oPOD (PR separat, cu migrarea `20261227a`, neaplicată).** Primul AWB real a costat **27,16 lei în loc de 13,16**:
codul trimitea mereu `options: ['B']` (oPOD = confirmarea de primire semnată, returnată în original, +14 lei / plic după ofertă), din proiectarea
inițială, deși la întâlnirea cu curierul din 09.11.2026 proprietarul decisese „fără oPOD, confirmarea electronică de pe terminalul curierului”
(gratuită). Decizia proprietarului din 18.11.2026: **oPOD rămâne în cod, ca alegere explicită a owner-ului, pe lot, implicit OPRITĂ**. Ce s-a
schimbat, fiecare cu test care pică pe forma de dinainte (9f6fdada): (1) corpul implicit pleacă **fără opțiuni** (lista goală: expediere Standard,
fără servicii suplimentare; documentația din repo, §1, nu descrie o opțiune pentru confirmarea electronică — ea vine prin urmărire,
`confirmation.name/date`, și prin `/reports/awb/confirmations` —, deci nu se trimite nimic ghicit; X / ePOD rămâne nefolosită); (2) alegerea
oPOD e **pe lot**: `red_fan_loturi.opod` (implicit `false`), scrisă DOAR de owner prin `fn_red_fan_lot_opod`, după marcajul TEST / real și
înainte de PRIMA aprobare, apoi imuabilă (RPC + același trigger ca marcajul, pe orice cale); fiecare schimbare = rând în `red_jurnal`
(`opod_schimbat`); (3) alegerea intră în corp (`options`) și în **hash-ul aprobat** → valoarea folosită la generare e EXACT cea văzută la aprobare
(altă alegere = alt hash = rând exclus de la generare și refuzat de claim; funcția edge citește alegerea lotului cu JWT-ul omului și refuză cu
503 dacă nu o poate citi, 409 dacă lotul nu e marcat); (4) ecranul: bifa „Confirmare de primire în original (oPOD, +14 lei / plic)”, nebifată
implicit, activă doar pentru owner, după marcaj și înainte de prima aprobare; dialogul de aprobare spune dacă oPOD e cerut și costul estimat
suplimentar (din corpurile care se aprobă); rândul plicului arată „oPOD” când corpul îl cere; (5) rândul plicului arată și **ultimul eveniment
de urmărire cu data și ora României** („ridicat de curier (C0) 18.11.2026 17:21”), doar afișare. Specificația fluxului pentru operator
(`FAN_FLUX_OPERATOR_SPEC.md`, alt PR) se aliniază separat.
**Runda 2 (verdictul review-ului pe `0c36cdc0`).** (6) **Fără migrare** (codul publicat înaintea ei): lotul se citește la fel în ecran și în
funcția edge (`citesteLotFan`); dacă coloana `opod` lipsește (42703) se recitește fără ea și alegerea e „neinstalată” (`opod = null`) — marcajul
TEST / real, urmărirea, confirmările, etichetele, reconcilierea și ștergerea merg ca înainte; **doar generarea refuză** (503 „citire neconfirmată”,
nimic trimis, niciun claim) până la aplicare. (7) **Istoricul**: până la 20261227a codul trimitea mereu `B`, deci orice lot cu o aprobare înainte
(hash-uri aprobate / AWB-uri generate cu oPOD) primește la migrare `opod = true` (deducere scrisă în migrare, cu numărătoarea în postcondiții și un
**marcaj de instalare** în `red_jurnal` — `opod_instalat`, cu momentul și lista loturilor deduse); loturile fără nicio aprobare rămân `false`. Pe
rândul unui plic **trimis** ecranul arată „oPOD” după alegerea înghețată a lotului (ce a plecat), nu după corpul reconstruit acum; fără coloană, un
rând trimis poartă „oPOD (expediat înainte de alegerea pe lot: opțiunea B pleca mereu)”. Lotul dedus `true` e deja aprobat, deci alegerea lui nu se
mai schimbă (istoricul nu se falsifică; un lot nou se marchează separat). (8) **Revenirea** deosebește datele preexistente de folosirea de după
aplicare prin marcaj: refuză la orice alegere a owner-ului (`opod_schimbat`), la orice lot aprobat după aplicare (și cu implicitul `false`), la rânduri
aprobate / rezervate / generate după momentul din marcaj și la `opod = true` în afara listei deduse; loturile deduse `true` nu o opresc; scrie
`opod_dezinstalat` (jurnalul nu se șterge). (9) **Cursa „schimbare înaintea unei aprobări întârziate cu hash-ul vechi”** e probată (PGlite + vitest):
BD-ul acceptă aprobarea (nu cunoaște conținutul hash-ului), lotul rămâne pe alegerea nouă, înghețată; la generare rândul e exclus (hash-ul recalculat
cu alegerea lotului ≠ cel aprobat), niciun claim, niciun POST; recuperarea = re-propunere + aprobare nouă; nimic nu pleacă cu altă opțiune decât cea
din hash-ul aprobat. Ce rămâne neprobat fără cont real: acceptarea listei goale `options: []` de către FAN și disponibilitatea confirmării electronice
pe contul contractual — se verifică la primul AWB de după migrare (Testul 1, §11, pasul `verifica-tarif`: tariful fără oPOD trebuie să fie 13,16 lei).
**Runda 3 (verdictul review-ului pe `f4d1fd46`).** (10) **Dovada durabilă a folosirii după aplicare** (L14): re-propunerea unui rând aprobat îi
șterge `aprobat_la` (20261212a), iar pe un lot deja dedus `true` prima aprobare nu spune nimic despre aprobările noi — revenirea ar fi acceptat
„lot vechi → aprobare nouă pe alt plic → re-propunere”. Acum fiecare trecere a unui rând FAN în „aprobat” (RPC, UPDATE sau INSERT direct) scrie prin
trigger (`fn_red_fan_awb_opod_jurnal`, AFTER pe `red_fan_awb`) evenimentul `opod_aprobare` în `red_jurnal` (lotul, alegerea oPOD a lotului în acel
moment, hash-ul aprobat, autorul); nimic nu-l șterge (jurnal append-only), iar revenirea refuză la orice astfel de eveniment (pe conținut, nu pe
timp). Verificările vechi (lot aprobat în afara listei, rânduri după momentul marcajului) rămân ca apărare în adâncime. (11) **Ordinea livrării:
codul se publică ÎNTÂI, apoi se aplică migrarea.** Deducerea istorică („aprobat înainte = a plecat cu B”) e adevărată doar dacă nicio aprobare de
dinaintea aplicării nu s-a făcut cu hash-uri „fără B”; de aceea, cât coloana `opod` lipsește, ecranul nou NU permite propunerea, aprobarea și
generarea („1. Propune” / „2c. Aprobă” / „3. Generează AWB” dezactivate, cu motivul „alegerea oPOD nu e instalată … până la aplicarea ei nu se
propune, nu se aprobă și nu se generează nimic nou”; bifa oPOD „neinstalată”), iar funcția edge nouă refuză generarea (503). Restul — marcaj,
urmărire, confirmări, etichete, reconciliere, ștergere — merge. Coordonatorul verifică în ERP (Ctrl+Shift+R) că butoanele sunt dezactivate cu acel
motiv ÎNAINTE de a aplica migrarea. Ordinea inversă NU e sigură: codul vechi trimite B indiferent de coloană, deci un AWB generat între aplicare și
publicare ar sta pe un lot cu `opod = false` (istoric falsificat). RPC-urile din BD (`fn_red_fan_propune` / `_aproba`, 20261212a) nu pot fi făcute
să refuze „cât coloana lipsește” fără o migrare — adică exact 20261227a —, deci garda există în ecran (singurul client) și în funcția edge (pasul
plătit), nu în BD. (12) Revenirea lui 20261212a: după aplicarea lui 20261227a nu mai trece (marcajele `opod_instalat` / `opod_dezinstalat` rămân
în jurnal, iar ea refuză la orice rând FAN din `red_jurnal` — ca după orice tiraj sau soluționare), deci practic era deja închisă de Testul 1.
**Runda 4 (verdictul review-ului pe `d164c35d`).** (13) **Dovada durabilă pentru ORICE pas FAN de după aplicare, nu doar pentru aprobări.**
Succesiunea reprodusă de recenzent: un plic aprobat ÎNAINTE de migrare (negenerat) → aplicare (lotul dedus `true`) → rezervarea lui
(`fn_red_fan_claim_lot`, urmată de apelul plătit la FAN cu corpul construit din coloana `opod`) → rezultatul „eroare” → revenirea trecea (nicio
trecere nouă în „aprobat”, iar verificarea pe timp citea `updated_at` doar pe „în curs” / „necunoscut”); la fel „necunoscut → reconciliere fără AWB”.
Acum același trigger (`AFTER INSERT OR UPDATE OR DELETE` pe `red_fan_awb`) scrie în `red_jurnal` un eveniment la fiecare pas al ciclului de viață:
`opod_aprobare` la trecerea în „aprobat”, `opod_folosire` la orice altă inserare, ștergere sau schimbare a coloanelor ciclului de viață (stare,
hash, cheia rezervării, AWB, momentele aprobării / generării, lotul, plicul) — propunere, re-propunere, rezervare, rezultat, reconciliere, ridicare,
anulare, ștergere directă — cu lotul, alegerea oPOD a lotului în acel moment, starea veche → nouă, hash-ul și autorul. Scrierile doar de urmărire /
confirmări nu scriu nimic. Revenirea refuză la orice eveniment (pe conținut) și, separat, la orice rând FAN creat sau scris după momentul instalării,
în orice stare (pe timp; inclusiv urmărirea): **revenirea e doar pentru aplicarea NEFOLOSITĂ**; după primul pas FAN pe baza nouă, corectura se face
cu o migrare nouă, nu cu revenirea. (14) Față de 20261131h (pe `main`, #1134): forma ei citește din tabelele FAN doar `red_fan_awb.stare` /
`proiect_id` (CHECK-ul stărilor + trigger-ul pe `red_proiecte`) și nu scrie în ele, deci trigger-ul de jurnal nu se declanșează din ea; ordinea
dintre cele două rămâne liberă, cu manifestele L15 regenerate pe clonă în ordinea efectivă.

---

## 0. Pe scurt, pentru proprietar

1. **Marți (actele la Transgaz)**: recomand **AWB făcut manual în selfAWB** (site-ul FAN, contul firmei), nu prin ERP. E un singur colet, merge azi, fără cod nou. AWB-ul se trece în 📨 Corespondență la rândul trimiterii („Nr. de înregistrare” / Observații). Integrarea din ERP nu va fi testată până marți.
2. **Convocările către proprietari prin FAN**: ERP-ul poate genera câte un AWB pe plic (plicurile din ✉️ Poștă), cu eticheta PDF, urmărire și confirmare de primire. **Trei lucruri trebuie lămurite înainte**:
   - **Juridic**: procedura cere „scrisoare recomandată cu confirmare de primire”. FAN cu opțiunea **oPOD** (confirmare semnată, returnată fizic) este echivalentă? Fără „da” de la juridic, convocările rămân la Poșta Română.
   - **Telefonul destinatarului e obligatoriu la FAN** (max. 16 caractere). Confirmat de documentația actuală (15.11.2026): fără telefon nu se generează AWB. Mulți proprietari nu au telefon în ERP, deci plicurile lor rămân blocate la previzualizare până se completează telefonul. API-ul nu are opțiune pentru dezactivarea redirecționării livrării: se stabilește cu Vânzări FAN, iar pe 13.11.2026 FAN a acceptat o excepție prin care o dezactivează ei.
   - **Adresele trebuie să se potrivească cu nomenclatorul FAN** (județ / localitate). ERP-ul verifică înainte și arată ce nu se potrivește.
3. **Bani**: fiecare AWB generat costă (tariful vine în răspuns și se vede în ecran lângă AWB, cu totalul pe lot; „tarif necunoscut” = oprire). De aceea generarea se face **doar după aprobarea ta în ERP**, pe lot. Primele loturi au un **plafon mic** (20 de plicuri, se schimbă din ERP) și se marchează **TEST** sau **real** înainte de aprobare.
4. **Ce îmi trebuie de la tine** (doar numele, valorile le pui tu în Supabase → Edge Functions → Secrets): `FAN_SELFAWB_USERNAME`, `FAN_SELFAWB_PASSWORD`, `FAN_CLIENT_ID` (ID-ul punctului de lucru din selfAWB). Plus: contractul FAN e activ pe API? (FAN cere contract semnat; credențialele selfAWB se cer la selfawb@fancourier.ro.)

---

## 1. Endpoint-uri folosite (din documentația oficială)

| Scop | Metodă și cale | Note |
|---|---|---|
| Autentificare | `POST /login?username=&password=` | întoarce `token` + `expiresAt`, valabil 24h; Bearer pe toate apelurile; nu se cere token la fiecare apel. Parametrii sunt în query string → nu se loghează niciodată URL-ul. |
| Servicii | `GET /reports/services` | „Standard” (id 1) pentru plicuri. |
| Opțiuni serviciu | `GET /reports/service-options?clientId=&service=` | opțiuni relevante: **B = oPOD** (confirmare semnată, fizic, 1–3 zile lucrătoare; **+14 lei / plic după ofertă; din 18.11.2026 DOAR la cererea owner-ului, pe lot, implicit oprit**), X = ePOD (confirmare pe e-mail; exclusiv cu B; nefolosită), P = prealertă e-mail, M = SMS Business (doar destinatari persoane juridice). Fără opțiuni = expediere Standard; confirmarea electronică de pe terminalul curierului nu e o opțiune de aici (vine prin urmărire și confirmări). |
| Nomenclator | `GET /reports/counties`, `/reports/localities?county=`, `/reports/streets` | pentru validarea adreselor înainte de AWB (nefolosit încă în cod: verificarea e doar de completitudine, §9). |
| Tarif estimat | `GET /reports/awb/internal-tariff` | gratuit; cost fără TVA + TVA + total. **Nefolosit în cod**: câmpurile răspunsului nu sunt în acest document (§8, deschisă 8). |
| **Generare AWB** | `POST /intern-awb` | corp: `clientId` + `shipments[]` (câte un `info` + `recipient` pe AWB), **1…100 de expedieri pe solicitare**. Telefonul destinatarului e obligatoriu. Răspuns: `awbNumber`, `tariff`, `vat`, `errors` pe fiecare element. **Plătit.** |
| Etichetă | `GET /awb/label?clientId=&awbs[]=&pdf=1&format=A4\|A5\|A6` | PDF (sau HTML/ZPL); mai multe AWB-uri într-un apel. ERP-ul cere **mereu `format=A6`** (§6). **18.11.2026**: PDF-ul primit cu `format=A6` a avut pagina A4 (595 × 842 pt) → deschisă 17 (§8); până la răspunsul curierului, butonul / fișierul nu afirmă A6. |
| Ștergere AWB | `DELETE /awb?clientId=&awb=` | doar de pe borderoul zilei, înainte de ridicare. Succes = DOAR forma recunoscută (HTTP 200 + `status: "success"`, fără erori; presupunere de confirmat, §8 deschisă 15); orice altă formă = AWB păstrat, verificare în selfAWB. |
| Comandă curier | `POST /order` | **AWB-ul singur nu cheamă curierul.** O comandă pe punct de lucru pe zi; interval ≥ 2h; în afara Bucureștiului L–V 09–17, S 09–14. **Manual în selfAWB** în această livrare: câmpurile corpului nu sunt în acest document (§8, deschisă 9). |
| Anulare comandă | `DELETE /order?clientId=&id=` | |
| Borderou zi | `GET /reports/awb?clientId=&date=YYYY-MM-DD&perPage=&page=` | reconciliere după un rezultat ambiguu (vezi §5). |
| Urmărire | `GET /reports/awb/tracking?clientId=&awb[]=` | **maximum 100 de AWB-uri pe solicitare** (documentația actuală; confirmat și în scris de asistența IT a FAN pe 12.11.2026). Evenimente + `confirmation.name/date` + `returnAwbNumber` + `oPODAwbNumber`. |
| Lista stărilor de urmărire | `GET /reports/awb-events` | lista completă a codurilor de eveniment (indicată de FAN pe 12.11.2026). Se citește de aici, nu se ține pe de rost. |
| Confirmări (dovada de livrare) | `GET /reports/awb/confirmations?clientId=&awb[]=&language=` | `awb[]` obligatoriu, **1…100 de AWB-uri**; `clientId` obligatoriu; `language` opțional (`ro` / `en`). Răspuns **JSON, o listă** → dovada pentru AR. Forma veche din PDF-ul 09.2025 (`GET /reports/get-awb-confirmations`, arhivă ZIP) nu se mai folosește. |

Autentificarea e neschimbată în documentația actuală: utilizator + parolă + ID de client; codul de acces e valabil 24 de ore.

Coduri de eveniment folosite (din `GET /reports/awb-events`): **C0** ridicat de curier, **S2** livrat, S3/S11 avizat, S4/S10/S19/S20/S25/S27/S28/S42 adresă greșită/incompletă,
S5 mutat, S6 refuz, S16/S33/S43 retur, S30 nu răspunde la telefon, S50 confirmare refuzată. Lista de mai sus vine din PDF-ul 09.2025; la Testul 1 (18.11.2026) s-a comparat cu răspunsul
real al `/reports/awb-events`: niciun cod al nostru lipsă la FAN, **37 de coduri FAN neclasificate**, clasificate apoi în `EVENIMENTE_FAN` DOAR după numele dat de curier
(tabelul cod → nume → clasă → motiv e în raportul livrării din 18.11.2026):
- **tranzit** (mișcarea plicului; nu schimbă faptele): C1 „Shipment taken over for delivery”, H0/H10 „in transit to the destination warehouse”, H1/H11 „unloaded in the destination
  warehouse”, H12/H13/H15 „in the warehouse”, H17 „in the destination warehouse”, H2 „in transit”, H3/H4 „sorted”, S1 „Delivery in process”, S35 „Resent for delivery”;
- **avizat** (lângă S3/S11): S21 „Notified, no contact person”, S22 „Notified, without reimbursement money”, S24 „Notified, without delegacy/ID”;
- **neutru** (contact, lângă S30): S12 „Contacted; further delivery”;
- **inregistrat**: S98 „Registered AWB” — AWB-ul înregistrat la curier, plicul încă neridicat (starea de după generare); ecranul îl arată „AWB înregistrat la curier (plic neridicat
  încă)”, nu „în tranzit”;
- **de_verificat** (sens nelimpede pentru o convocare → ca ultim eveniment, „de verificat de om”; nu se ghicește): S7 „Rejected transportation payment”, S8 „Pick up from local FAN
  Courier”, S9 „Redirected”, S14 „Restricted access to address”, S15 „Collect payment refused / Refused reimbursement”, S37 „Compensated”, S38 „Unsent AWB”, S46 „Shed delivery
  point”, S47 „Shed extern partner”, S49 „Suspended activity”, S54 „Full Locker”, S55 „Box size exceeded”, S56 „Handed over delivery point”, S64 „Absence of customs documents”,
  S65 „On hold”, S67 „Package not found in FANbox”, S69 „Delivery suspended for the address”, S99 „The AWB was deleted from the database”.
Faptele (ridicare C0, livrare S2, retur, refuz, adresă, mutat) sunt neschimbate; o clasă se schimbă doar printr-un PR cu test.

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
| `info.options` | `[]` implicit; `["B"]` (oPOD) DOAR dacă lotul cere oPOD | `red_fan_loturi.opod` (owner, `fn_red_fan_lot_opod`, după marcaj și înainte de prima aprobare; implicit `false` — decizia proprietarului 09.11 + 18.11.2026). Intră în hash-ul aprobat: alegerea de la aprobare e cea trimisă. `configPlicFan({ opod })`, aceeași funcție în ecran și în edge. |
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
   │ 1. „Propune” (admin/editor) — doar citiri + hash: rânduri red_fan_awb „propus” (fără cost, fără FAN); 18.11.2026: se trimit DOAR plicurile
   │      DE PROPUS (fără rând FAN viu, sau viu „propus” / „aprobat” pe alt hash); nimic de propus = buton dezactivat cu motiv (starePropunere)
   │ 2. DOAR owner-ul: „Marchează TEST” sau „Marchează real” (red_fan_loturi; imuabil după PRIMA aprobare a lotului — istoric:
   │      prima_aprobare_la, pusă de BD și păzită de un trigger; o re-propunere care readuce rândurile la „propus” NU îl redeschide),
   │      opțional bifa „Confirmare de primire în original (oPOD, +14 lei / plic)” (18.11.2026: red_fan_loturi.opod, implicit oprit,
   │      fn_red_fan_lot_opod, după marcaj și înainte de prima aprobare, apoi imuabilă ca marcajul; schimbarea = corpuri / hash-uri noi →
   │      plicurile deja propuse se re-propun), apoi „Aprobă” → fn_red_fan_aproba(lot, id-uri, hash-uri): „aprobat”, aprobat_de = auth.uid();
   │      dialogul de aprobare spune dacă oPOD e cerut și costul estimat suplimentar (din corpurile aprobate);
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
   │ 4. „Etichete (PDF)” (owner; până pe 18.11.2026 „Etichete A6”) → MANIFESTUL COMUN al lotului (§12): doar plicurile active cu AWB generat / ridicat, în ordinea numărului
   │      de plic, poziția 1…N; GET /awb/label?format=A6 pe părți de cel mult 100 (câte un buton pe parte); prima parte descarcă și PAGINA DE
   │      CONTROL. Același manifest face și „Documente lot (ZIP)” din Loturi (cu prefixul TEST_ pe un lot de test). Ecranul trimite cheia
   │      manifestului văzut; o evidență schimbată între timp = refuz („manifest schimbat”), nimic tipărit
   │      TIRAJUL (runda 3): prima descărcare (orice parte a etichetelor SAU arhiva) fixează în BD cheia manifestului (fn_red_fan_tiraj,
   │      red_fan_loturi.tiraj_cheie); FIECARE descărcare următoare o cere identică — altă cheie = refuz „tirajul s-a schimbat; retipărește
   │      tot lotul”, nimic descărcat. Runda 4: fiecare descărcare reverifică tirajul DUPĂ ce are fișierul, înainte de livrare; „Tiraj nou”
   │      (owner) = 1. oprește descărcările → 2. după 30 s distruge foile + fișierele → 3. înlocuiește cheia (CAS pe cheia veche; BD-ul refuză
   │      fără oprire / mai devreme); apoi se descarcă din nou TOATE părțile și arhiva. Identificatorul scurt (8 caractere) e pe pagina de control și în nume
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
cât `TRANSPORT_REAL_ACTIV = false`. Cu activarea pentru Testul 1 (`DOAR_PROIECTE_TEST = true`), pe un lot NEmarcat al unui proiect `TEST-…`
singurul buton activ e „2a. Marchează TEST” (owner): propunerea, plafonul și restul vin DUPĂ marcaj — de aceea procedura zilei începe cu marcajul
(`FAN_TEST1_PASI.md` §5). Fiecare acțiune are generația ei (L24): schimbarea lotului / închiderea ecranului oprește buclele
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
- **(c) Identitate**: JWT-ul omului (anon key + Authorization), RLS normal, pentru TOATE citirile și pentru comenzi (clasa A: `fn_red_fan_comanda`, `fn_red_fan_anulare_cere`, `fn_red_fan_retrage` …). **F1 (migrarea `20261228a`, spec `FAN_FLUX_OPERATOR_SPEC.md` §7.3): un al DOILEA client, `service_role`**, construit LENEȘ în `index.ts` și folosit DOAR pentru RPC-urile clasei B — înscrierea faptelor curierului: `fn_red_fan_srv_claim`, `fn_red_fan_srv_rezultate`, `fn_red_fan_srv_urmarire`, `fn_red_fan_srv_confirmari`, `fn_red_fan_srv_reconciliaza`, `fn_red_fan_srv_anuleaza`, `fn_red_fan_srv_intentie_incheie` —, DOAR după poarta omului și cu `p_actor = user.id` din JWT-ul verificat (RPC-ul re-verifică actorul în BD: operator numit sau owner, iar `auth.uid()` trebuie să fie NULL). **De ce e nevoie de el** (CLAUDE.md pct. 7 (c)): aceste RPC-uri au `EXECUTE` **exclusiv** pentru `service_role`, ca un operator (sau orice cont `authenticated`) să NU poată scrie el un AWB, o ridicare sau o anulare chemând RPC-ul direct prin PostgREST — singura alternativă ar fi `EXECUTE authenticated` pe înscriere, adică exact defectul „operatorul poate fabrica fapte ale curierului”. Cu clientul `service_role` nu se citește și nu se scrie nimic direct pe tabele (toate scrierile trec prin RPC-uri DEFINER cu CAS și gărzi). Credențialele FAN stau doar în Edge Secrets, citite DOAR pe calea reală (după poartă, flag, garda „doar TEST” și, pe `trimite`, după RPC-ul comenzii), niciodată trimise clientului, logate sau scrise în BD; login-ul are parametrii în query string, deci URL-ul nu se loghează.
- **(d) Cine pornește**: **poarta de ROL în cod** — F1: funcția edge cere **operator numit sau owner** (`fn_red_fan_e_operator()` pe `auth.uid()`, o singură definiție în BD — lista `red_fan_operatori`, owner-only, cu nivelul Redări admin / editor ca precondiție; nu din corp; JWT-ul singur nu ajunge; cod 403 `non_operator`) pe `trimite`, `eticheta`, `urmarire`, `confirmari`, `evenimente`, `reconciliaza`, `sterge_awb`; calea detaliată `genereaza` cere owner (`fn_sms_e_owner()`), ca până acum. RPC-urile: clasa A (`authenticated`, poarta în corp: operator sau owner; owner pentru lista operatorilor, plafonul zilei, decizia cererilor, setările), clasa B (doar `service_role`, mai sus), clasa C (owner, ca azi: ridicare, reconciliere manuală, `fn_red_fan_anulat`, soluționare — owner sau admin). Propunerea (fără cost, fără FAN) → operator sau owner.
- **(e) Confirmare umană**: F1 — fiecare apăsat pe „Trimite la curier” e o decizie umană cu o singură confirmare; aprobarea e automată DOAR sub **plafonul zilei** (implicit 20, owner; o cerere peste plafon așteaptă ÎNTREAGĂ decizia owner-ului — Q2 A; aprobarea owner-ului nu consumă plafonul), sub plafonul lotului și pe hash-ul exact al datelor; rezervarea refuză dacă sursele (contactele) s-au schimbat după citire; cel mult 5 solicitări de creare pe apăsat; ridicarea (cu efect juridic), returul, absența la reconciliere și soluționarea rămân ale omului (owner / admin); anularea de către operator e în DOI pași (cererea cu motiv din listă, apoi `DELETE` la curier și înscrierea doar după răspunsul lui, clasa B); „găsit” la reconciliere e reverificat în borderou de server înainte de scriere. Marcajul TEST / real și alegerea oPOD (18.11.2026, migrarea `20261227a`) sunt imuabile după PRIMA aprobare a lotului (în BD: coloanele istorice + același trigger), iar ecranul le blochează la fel; oPOD-ul (cost suplimentar) se cere explicit de owner, implicit oprit, și e spus în dialogul de aprobare. Comanda pune marcajul AUTOMAT pe un lot nemarcat (TEST ↔ proiect `TEST-…`) și verifică în BD, sub lock, că hash-urile au fost calculate cu alegerea oPOD a lotului (`p_opod`, RD038). Garda „doar proiecte de TEST” stă ȘI în BD (`red_fan_setari.doar_proiecte_test`, `fn_red_fan_lot_permis`; cade doar la F4).
- Regula tare (a)+(b): citește conținut extern și cheltuie → poartă de rol (operator numit de owner, sau owner) + plafonul zilei / aprobarea owner-ului + garda „doar TEST” în cod ȘI în BD: **toate prezente**.
- **Activarea pentru Testul 1 (18.11.2026)**: `TRANSPORT_REAL_ACTIV = true` + garda `DOAR_PROIECTE_TEST = true` (`transportPermis`, o singură definiție
  pentru funcția edge și ecran, L19): după poarta owner și lotul citit cu JWT-ul omului, funcția edge citește `red_proiecte.cod` și `red_fan_loturi.test`
  (RLS) și răspunde 423 `transport_real_doar_test` dacă proiectul nu începe cu `TEST-` sau lotul nu e marcat TEST — înainte de secrete și de orice
  apel. Un proiect invizibil / fără cod nu e „de test” (423); o eroare de citire = 503 (L18). Secretele = contul de TEST al curierului (procedura).

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
| Același plic: contactul schimbat între citirea funcției edge și rezervare | claim-ul recalculează amprenta surselor în tranzacția lui → refuz, nimic rezervat, nimic plătit; „Generează” din nou după reîncărcare (hash nou = re-propunere + aprobare). **Ce garantează rezervarea (runda 3, exact):** fixează CORPUL APROBAT (hash-ul aprobat de owner), verificat pe sursele văzute la momentul claim-ului; ce pleacă la FAN e acel corp, construit din citirile funcției edge, nimic nu se recitește după claim. Contactele NU se blochează: o modificare comisă după verificare — inclusiv una necomisă în timpul verificării și comisă înaintea COMMIT-ului rezervării — NU schimbă ce pleacă și apare ca diferență (hash nou) la următoarea propunere. NU se garantează „datele sunt actuale la COMMIT / la POST” (proba S2b pe clonă, §11). |
| Două rulări de urmărire / confirmări în paralel | fiecare rând poartă versiunea citită; BD-ul scrie doar dacă versiunea e aceeași și evenimentul nu e mai vechi decât cel scris; altfel rândul e „depășit” (nescris, numărat în mesaj). |
| Urmărire: răspuns FĂRĂ evenimente (`events: []`) pe un AWB cu ridicare / livrare cunoscută (runda 3) | fără cronologie comparabilă, informația cunoscută se PĂSTREAZĂ: se consemnează doar „verificat la” (versiunea + 1), rândul e numărat „păstrat” în mesaj. Cu cronologie: evenimentul nu poate fi mai vechi decât cel scris. Un element fără lista de evenimente (lipsă / `null`) = „de verificat de om”, nu „fără evenimente” (lipsă ≠ gol). |
| Urmărire: răspuns datat mai SĂRAC sau care CONTRAZICE ce se știe (runda 4) | **faptele** — ridicarea (data C0), livrarea (ora S2), returul și motivul lui — se păstrează separat: un răspuns care nu le mai conține nu le șterge (ex. `S6 → S43` dă retur „refuz”; un răspuns ulterior doar cu `S43` păstrează „refuz”), iar starea ține cont de ele (un răspuns parțial „în tranzit” nu coboară un plic livrat / returnat / ridicat). O valoare nouă DIFERITĂ de un fapt cunoscut (altă dată C0, altă oră de livrare, alt motiv de retur) NU îl înlocuiește: intră lângă el (coloanele `*_contrazis`), rândul devine „de verificat de om”, iar ecranul arată AMBELE valori („Urmărire de verificat de om”); livrat ȘI retur deodată = tot contradicție. O ridicare contrazisă nu intră în „Confirmă ridicarea”: omul verifică în selfAWB. Un răspuns neclar (cod necunoscut, S50) rămâne „de verificat”, cu faptele cunoscute afișate lângă el. Regula e o singură dată, în `fn_red_fan_urmarire` + CHECK-ul `red_fan_awb_fapte` (contradicție ⇒ „de verificat”, pe orice cale). **Soluționarea (runda 5):** contradicția NU dispare la un răspuns ulterior aparent „bun” (ex. C0 pe 10.11 → C0 pe 11.11 → C0 pe 10.11 + S30: rămâne „de verificat”). O soluționează doar omul — owner-ul sau un admin Redări — din caseta „Urmărire de verificat de om” („Soluționează…”): vede AMBELE valori ale fiecărui fapt contrazis, alege care rămâne (cea cunoscută sau cea nouă; la „livrat ȘI retur”: livrarea sau returul) și scrie motivul (ce a verificat în selfAWB). BD-ul (`fn_red_fan_urmarire_solutioneaza`) cere poarta de rol în corp, versiunea urmăririi citită în ecran (un răspuns FAN sosit între timp = refuz `RD023`, se reîncarcă și se verifică din nou), alegerile pentru EXACT faptele contrazise și motivul (1–500 de caractere); scrie faptele alese, golește contradicțiile, recalculează starea din fapte (retur > livrat > ridicat) și pune în jurnalul Redări ce era contrazis, ce s-a ales, motivul, cine și când. Un răspuns ulterior care contrazice din nou faptul ales redeschide verificarea. Soluționarea scrie doar evidența FAN, nu plicul (ridicarea / AR-ul / returul pe plic se înregistrează ca de obicei). CHECK-ul `red_fan_awb_contradictii`: o valoare contrazisă stă doar lângă faptul ei și diferă de el. |
| Răspunsul de creare poartă referința (observation / content) altui plic decât cel de pe poziție | toată solicitarea = „necunoscut” (asocierea contrazisă), reconciliere. Fără referință în răspuns: asocierea pe poziție — **presupunere NECONFIRMATĂ**, numărată în mesaj („asociate pe poziție: de verificat în selfAWB”); confirmarea pe primul răspuns real e pas BLOCANT înaintea oricărui lot mai mare de un plic (§10 pasul 4a). |
| Descărcări în momente diferite (o parte a etichetelor azi, arhiva mâine; între ele un plic respins primește AWB) (runda 3) | tirajul: prima descărcare fixează cheia manifestului; orice descărcare următoare dintr-o stare diferită = refuz „tirajul s-a schimbat; retipărește tot lotul”, nimic descărcat. Owner-ul urmează procedura „Tiraj nou” (rândul următor) și se descarcă din nou TOATE părțile + arhiva (identificator nou pe pagină și în nume). Ce NU garantează: că manifestul e încă cel curent la descărcare (o schimbare comisă după verificare apare la următoarea descărcare, ca refuz); cheia arhivei o calculează browserul (BD-ul nu reface manifestul): protejează contra derivei între descărcări, nu contra unui client modificat. |
| Tirajul înlocuit cât o descărcare e ÎN CURS (runda 4; ex. operatorul cere partea a doua pe K1, owner-ul înlocuiește K1 cu K2, cererea se termină după) | **(1) reverificarea FINALĂ**: fiecare descărcare verifică tirajul încă o dată DUPĂ ce are fișierul (funcția edge după PDF-ul FAN; ecranul după arhivă / pagina de control) și ÎNAINTE de livrare — aceeași cheie ȘI același nr., altfel refuz („tiraj_schimbat” / „tiraj_oprit”), nimic livrat. Singură, ea garantează doar că nimic nu se livrează DUPĂ înlocuire; nu serializează (o descărcare care trece reverificarea între distrugerea foilor și înlocuire ar rămâne nedistrusă). **(2) „Tiraj nou” în trei pași, impus de BD**: (a) owner-ul OPREȘTE descărcările tirajului (`fn_red_fan_tiraj_opreste`): cât e oprit, orice descărcare — și reverificarea finală a celor începute — e refuzată (`RD021`); (b) după cel puțin 30 de secunde (BD-ul refuză înlocuirea mai devreme sau fără oprire: `RD022`) se distrug foile ȘI fișierele descărcate ale tirajului; (c) owner-ul înlocuiește tirajul (CAS pe cheia veche; oprirea se șterge). Confirmarea din ecran spune exact acești pași. **Ce garantează (1) + (2), exact (runda 5):** (a) după ce oprirea e comisă, nicio descărcare a tirajului vechi nu mai trece de reverificarea finală; (b) cele 30 de secunde se numără de la **momentul EFECTIV al opririi** — ceasul BD-ului (`clock_timestamp()`) luat de funcția de oprire DUPĂ ce a obținut lock-ul lotului, NU începutul tranzacției ei (o tranzacție care a așteptat lock-ul sau a început mai devreme nu mai poate retrodata oprirea) și NU momentul COMMIT-ului; înlocuirea verifică durata tot pe ceasul efectiv, sub același lock; (c) orice reverificare finală care a trecut s-a încheiat (comis) ÎNAINTEA momentului opririi, pentru că ține același lock al lotului — deci între ultima reverificare trecută și înlocuire au trecut cel puțin 30 de secunde de ceas real. **Ce NU garantează:** că fișierul acelei descărcări a ajuns deja la om (transferul din funcția edge / browser continuă după reverificare și BD-ul nu îl vede). **Ce rămâne procedural:** distrugerea foilor și ștergerea fișierelor o face omul (BD-ul nu le vede); un transfer mai lung de 30 de secunde după reverificare (rețea foarte lentă) nu e acoperit; un client modificat poate sări reverificarea (doar admin / editor Redări au drept). Evidența: fiecare început / oprire / reluare / înlocuire = un rând în `red_jurnal` (cine, când, cheia veche → nouă, numărul tirajului). |
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
| Etichete și documente pe un lot cu plicuri respinse / fără AWB | aceeași mulțime și aceeași ordine (manifestul comun): doar plicurile cu AWB tipăribil, pozițiile 1…N; restul „rămase”, numite pe pagina de control, fără etichetă și fără documente. După o corectură (plicul rămas primește AWB), se retipărește TOT lotul (etichete + documente + pagina de control), iar foile vechi se distrug: pozițiile se pot schimba. Runda 3: retipărirea e IMPUSĂ tehnic — până la „Tiraj nou” orice descărcare e refuzată. |
| Urmărire: eveniment cu cod / dată de formă necunoscută, ultimul cod necunoscut, S50 | „de verificat de om”, nu livrat / retur. |
| Confirmări: răspuns care nu e listă, sau element fără AWB | „formă necunoscută” pe toate AWB-urile cerute; niciodată „confirmat”. |
| Etichetă: răspuns care nu e PDF | eroare afișată (502), nimic descărcat. |
| Redirecționarea livrării de către destinatar | nu se poate opri din API; o dezactivează FAN, prin excepția acceptată pe 13.11.2026. De verificat pe primele AWB-uri că excepția e activă. |
| Plic anulat după AWB | doar înainte de C0: `DELETE /awb`, apoi „anulat” — DOAR la forma de succes recunoscută; 5xx, 200 cu eroare, corp gol sau altă formă = AWB-ul rămâne „generat”, omul verifică în selfAWB, apoi „Marchează anulat”. Până atunci AWB-ul plicului anulat nu se tipărește (manifestul îl numește „de anulat”). După C0: nu se mai anulează din ERP. |
| AWB generat, plic modificat între timp | rândul are hash-ul datelor; generarea compară hash-ul aprobat cu datele curente și exclude rândul. |
| Alegerea oPOD a lotului diferă de cea de la aprobare (18.11.2026) | nu se poate pe căile normale: după PRIMA aprobare RPC-ul și trigger-ul refuză schimbarea. Singura cale: owner-ul schimbă alegerea cât lotul e neaprobat, iar o aprobare întârziată (cu hash-urile vechi, propuse pe cealaltă alegere) e acceptată de BD → lotul rămâne pe alegerea nouă, înghețată, rândurile aprobate au hash-ul vechi; la generare corpul recalculat are alt hash → TOATE rândurile sunt excluse („datele s-au schimbat după aprobare”), niciun claim, niciun POST; recuperarea = re-propunere + aprobare nouă (probat PGlite + vitest, runda 2). Alegerea necitibilă (rând lipsă / coloana lipsă / altă formă) = 409 / 503, nimic trimis (necunoscut ≠ „fără oPOD”). |
| Codul publicat ÎNAINTE de migrarea 20261227a (coloana `opod` lipsă) — ordinea CERUTĂ | citirea lotului (aceeași în ecran și edge) recitește fără coloană, pune `opod = null` și spune că coloana lipsește (`opodInstalat = false`): marcajul, urmărirea, confirmările, etichetele, reconcilierea, ștergerea merg ca înainte; generarea refuză (503, nimic trimis). Ecranul (runda 3): „1. Propune” / „2c. Aprobă” / „3. Generează AWB” dezactivate cu motivul coloanei (nicio aprobare „fără B” înaintea deducerii istorice a migrării); bifa dezactivată „neinstalată”; rândurile trimise poartă „oPOD (expediat înainte de alegerea pe lot…)”. |
| Migrarea 20261227a aplicată ÎNAINTEA publicării codului — ordinea GREȘITĂ | codul vechi (ecran + funcție edge) trimite `B` indiferent de coloană: un AWB generat în fereastra dintre aplicare și publicare ar sta pe un lot cu `opod = false` → ecranul nou l-ar arăta „fără oPOD” (istoric falsificat). Nu se face: coordonatorul verifică întâi că ecranul nou e live (butoanele dezactivate cu motivul coloanei), apoi aplică. |
| Aprobare după aplicare, apoi re-propunere (rândul redevine „propus”, `aprobat_la` șters) | evenimentul `opod_aprobare` scris de trigger la aprobare rămâne în `red_jurnal` → revenirea migrării refuză (runda 3); re-propunerea scrie la rândul ei `opod_folosire` (runda 4) și nu șterge evenimente. |
| Plic aprobat ÎNAINTE de migrare, rezervat (claim) DUPĂ aplicare, rezultat „eroare” (sau „necunoscut” → reconciliere fără AWB) — runda 4 | rezervarea și rezultatul scriu `opod_folosire` în `red_jurnal` (durabil), iar rândul are `updated_at` după momentul instalării → revenirea refuză pe ambele căi; pe forma de dinainte (`d164c35d`) trecea. |

---

## 6. Ce conține codul (17.11.2026, inert)

- `supabase/migrations/20261212a_redari_fan_awb.sql` — **NEAPLICATĂ**, în **forma livrării L15 v2** (`docs/LIVRARE_L15_V2.md`, tiparul `20261225a`): garda de livrare legată de nume + tranzacție, plafonul 5000 în forma acceptată de validator (`'5000/session'` + marcajul `'5000:' || txid_current()`; `--plafon-tranzactie-ms 5000` acceptat, 2000 / fără plafon refuzate), garda pasului global „înainte” în aceeași tranzacție (`AMPRENTA_GLOBALA_LIPSA`), amprenta poartei de drept `fn_red_nivel` înainte și după, bugetul de lock de 1 s de la PRIMA încercare (ordine fixă: `red_proiecte` → `red_loturi_plicuire` → `red_plicuri`, SHARE ROW EXCLUSIVE, NOWAIT, subtranzacție pe încercare) și inventarul lock-urilor implicite în comentariul blocului. Coloanele de autor nu mai au cheie străină spre `profiles` (ar fi cerut lock pe `profiles` la aplicare). Lista OBIECTELOR din manifest: `supabase/tests/20261212a_redari_fan_awb.l15.obiecte.tsv` (generată pe PGlite cu pașii reali ai runnerului; manifestul `.l15.tsv` propriu-zis îl generează coordonatorul pe clonă). Tabele: `red_fan_awb` (un rând viu pe plic, stări + urmărire cu versiune + confirmare, fără PII), `red_fan_loturi` (marcajul TEST / real + prima aprobare, trigger de gardă), `red_fan_setari` (plafonul lotului pilot, un rând, implicit 20). RLS: citire admin/editor Redări; scriere doar prin RPC. RPC-uri: `fn_red_fan_setari_seteaza`, `fn_red_fan_lot_marcheaza`, `fn_red_fan_propune`, `fn_red_fan_aproba`, `fn_red_fan_claim_lot` (≤ 100 de rânduri, o cheie, amprenta surselor), `fn_red_fan_rezultate` (toate odată, CAS), `fn_red_fan_reconciliaza`, `fn_red_fan_ridicat` (lot real → plicul expediat; lot de test → doar evidența), `fn_red_fan_urmarire` (versiune, `{scrise, pastrate, depasite}`; un răspuns fără cronologie nu șterge ce se știe — runda 3) / `fn_red_fan_confirmari` (versiune, `{scrise, depasite}`), `fn_red_fan_anulat`, `fn_red_fan_tiraj` (runda 3: tirajul lotului — admin / editor / owner încep sau verifică, doar owner-ul înlocuiește, CAS pe cheia veche; refuz `RD020`; coloanele `red_fan_loturi.tiraj_cheie / tiraj_nr / tiraj_la / tiraj_de` + CHECK-ul de coerență, scrise doar prin el; runda 4: refuză orice descărcare cât tirajul e OPRIT — `RD021` — și înlocuirea fără oprire de cel puțin 30 s — `RD022`), `fn_red_fan_tiraj_opreste` (runda 4: owner, CAS pe cheia tirajului; oprește / reia descărcările; coloanele `tiraj_oprit_la / tiraj_oprit_de` + CHECK), ambele scriu fiecare schimbare în `red_jurnal` (tabela `red_fan_loturi`, `inregistrare_id` = lotul, cheia veche → nouă, nr., `user_id` = `auth.uid()`; fără date personale); `red_fan_awb` are, de la runda 4, faptele urmăririi păstrate (`retur_cunoscut`) și contradicțiile (`ridicat_contrazis`, `livrat_contrazis`, `retur_contrazis`) + CHECK-ul `red_fan_awb_fapte`; runda 5: `fn_red_fan_urmarire_solutioneaza(p_id, p_versiune, p_alegeri, p_motiv)` (obiect NOU, minim: owner sau admin Redări — poarta în corp —, un rând, CAS pe `versiune_urmarire` → `RD023`, alegerile pentru exact faptele contrazise, motiv obligatoriu, evenimentul `urmarire_solutionata` în `red_jurnal` cu tabela `red_fan_awb`) + CHECK-ul `red_fan_awb_contradictii`; ceasul efectiv (`clock_timestamp()` după lock-uri) la oprirea tirajului, la începutul lui, la rezervare și în comparațiile celor 30 s / 10 minute; interne: `fn_red_fan_e_owner`, `_suma`, `_camp`, `_surse`, `_loturi_garda`. Revenire: `supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql`, în forma revenirilor (prin runner, plafonul 2000, fără amprentă globală — varianta A din `docs/LIVRARE_L15_V2.md` §9): refuză cu orice AWB, lot marcat, setări schimbate, istoric FAN în `red_jurnal` (runda 4: jurnalul e append-only, nu se șterge; runda 5: și soluționările), funcție `fn_red_fan_*` în plus (exact 19) sau dependență străină; lock-urile în ordinea căilor aplicației, înaintea verificării „fără date”. Lista obiectelor din manifest: 146 (runda 4: +10 — 6 coloane, 3 constrângeri, 1 funcție; runda 5: +2 — constrângerea `red_fan_awb_contradictii`, funcția `fn_red_fan_urmarire_solutioneaza`).
- `supabase/migrations/20261227a_redari_fan_opod.sql` (18.11.2026, **NEAPLICATĂ**, forma L15 v2, peste 20261212a aplicată) — `red_fan_loturi.opod boolean NOT NULL DEFAULT false` + deducerea istorică (loturile cu o aprobare înainte = `true`) + marcajul `opod_instalat` în `red_jurnal`; `fn_red_fan_lot_opod(p_lot_id, p_opod)` (owner; după marcaj, înainte de prima aprobare; repetarea = no-op; rând în `red_jurnal` cu `opod_schimbat`); `fn_red_fan_loturi_garda()` înlocuită ca să păzească și `opod` după prima aprobare (același trigger); runda 3: `fn_red_fan_awb_opod_jurnal()` + trigger `trg_red_fan_awb_opod_jurnal` pe `red_fan_awb`: evenimentul `opod_aprobare` la fiecare aprobare; runda 4: trigger-ul e AFTER INSERT OR UPDATE OR DELETE și scrie `opod_folosire` la orice alt pas al ciclului de viață (propunere, rezervare, rezultat, reconciliere, ridicare, anulare, ștergere). Amprentele funcțiilor de care depinde regula (garda veche / nouă, `fn_red_fan_e_owner`, `_lot_marcheaza`, `_aproba`, `_claim_lot`, `_propune`, `fn_red_nivel`) verificate înainte și după; lock-uri: ACCESS EXCLUSIVE pe `red_fan_loturi` (tabel mic) + SHARE ROW EXCLUSIVE pe `red_fan_awb` (trigger-ul + deducerea; citirile trec), NOWAIT, buget 1 s. Lista obiectelor: `supabase/tests/20261227a_redari_fan_opod.l15.obiecte.tsv` (5: coloana, 2 funcții noi, garda schimbată, trigger-ul). Revenire: `supabase/revenire/20261227a_redari_fan_opod_ROLLBACK.sql` (refuză la orice folosire de după aplicare — §7; readuce corpul exact al gărzii din 20261212a, scoate trigger-ul și funcțiile noi). Probe: `scripts/pglite/test_redari_fan_opod_local.mjs`. **Ordinea livrării (runda 3): codul se publică ÎNTÂI (ecranul nou nu propune / aprobă / generează fără coloană, funcția edge refuză generarea), coordonatorul verifică în ERP că butoanele sunt dezactivate cu motivul coloanei, apoi se aplică migrarea.** Ordinea inversă falsifică istoricul (codul vechi trimite `B` pe un lot cu `opod = false`).
- Probe: `scripts/pglite/test_redari_fan_awb_local.mjs` (validatorul real, aplicarea ca runnerul cu manifest generat + garda finală, comportamentul ca roluri, refuzurile, bugetul de lock, revenirea, mutanții, paritatea JS ↔ SQL a amprentei surselor; runda 3: tirajul, urmărirea fără evenimente; runda 4: oprirea / reluarea / înlocuirea tirajului cu jurnalul, cele două reproduceri ale recenzentului cu parserul real, contradicțiile, refuzul revenirii cu istoric în jurnal; `bash -n` pe scripturile de clonă), `supabase/tests/20261212a_redari_fan_doua_sesiuni.sh` (două sesiuni reale, pe clonă, §11 — netestat local) cu fixture-ul sintetic `supabase/tests/20261212a_redari_fan_fixture.sql` (`--cu-fixture`) și profilul `fan` din `supabase/tests/l15_aplicare_concurenta.sh` (concurența la APLICARE, pe clonă).
- `supabase/functions/_shared/redariFan.mjs` — funcții pure: corpul `intern-awb`, contactul pe plic, hash-ul, bucățile de ≤ 100, interpretarea răspunsurilor (creare pe element, urmărire, confirmări, evenimente, borderou), data evenimentelor în ora României, căile etichetei (A6) și ale listelor de AWB.
- `supabase/functions/_shared/redariFanTransport.mjs` — calea reală (login, creare, urmărire, confirmări, evenimente, etichete, reconciliere, ștergere), cu toate dependențele injectate.
- `supabase/functions/_shared/redariFanHandler.mjs` + `supabase/functions/redari-fan-awb/index.ts` — poarta pe acțiune (F1: `trimite`, `eticheta`, `urmarire`, `confirmari`, `evenimente`, `reconciliaza`, `sterge_awb` → operator numit sau owner, `fn_red_fan_e_operator`; `genereaza` → owner); `TRANSPORT_REAL_ACTIV = false` → 423 „transport_real_oprit” **înainte** de secrete, BD (în afara lotului) sau rețea. Al doilea client (`service_role`, leneș) DOAR pentru clasa B (`fn_red_fan_srv_*`), după poarta omului (§4 (c)).
- **F1 — `supabase/migrations/20261228a_redari_fan_operator.sql`** (NEAPLICATĂ; forma L15 v2, baza = 20261212a + 20261227a aplicate — runda 2; revenirea completă în `supabase/revenire/20261228a_redari_fan_operator_ROLLBACK.sql`; obiectele manifestului în `supabase/tests/20261228a_redari_fan_operator.l15.obiecte.tsv`): tabelele `red_fan_operatori`, `red_fan_zi` (+ trigger), `red_fan_zi_consum`, `red_fan_cereri_aprobare`, `red_fan_intentii`; coloanele noi pe `red_fan_awb` (stările `de_aprobat` / `retras`, cererea și confirmarea anulării, `intentie_cheie`, `aprobare_owner_la`, `retras_*`) cu trigger-ul de gardă `fn_red_fan_awb_garda` (marcaj de tranzacție, trei liste de coloane); setările `limita_zi`, `doar_proiecte_test`, `presupunere_429`; view-urile `v_red_fan_plafon_azi`, `v_red_fan_anulari`, `v_red_fan_intentii`; RPC-urile pe clase (A: `fn_red_fan_comanda` în trei faze L → V → M, `fn_red_fan_retrage`, `fn_red_fan_cerere_decide` / `_retrage`, `fn_red_fan_anulare_cere`, `fn_red_fan_operator_seteaza`, setările; B: `fn_red_fan_srv_*`; interne: `fn_red_fan_lot_permis(_valori)`, `fn_red_fan_lot_incheiat`, …). Probe: `scripts/pglite/test_redari_fan_operator_local.mjs` (plafonul zilei P1–P14, intențiile I1–I14, P429, anularea în doi pași cu trigger-ul activ, clasele B / C ca operator, revenirea, 17 mutanți, paritatea gărzii „doar TEST”) și `supabase/tests/20261228a_redari_fan_operator_doua_sesiuni.sh` (două / trei sesiuni pe clonă: P5, I5, E15, E22 a–c cu mutantul `40P01`; netestat local).
- **F1, runda 2 (Jakarinos pe ccbf456e + re-bazarea pe #1135 / oPOD, 19–20.11.2026)**: (1) **baza migrării 20261228a = 20261212a + 20261227a** (21 de funcții `fn_red_fan_*` verificate pe amprentă înainte, 52 după; pe `red_fan_awb` trigger-ul de jurnal al 20261227a, neatins, + garda F1; revenirea lasă 21 de funcții și doar jurnalul oPOD). Ordinea aplicării: 20261212a → 20261227a → 20261228a; revenirea în ordinea inversă (revenirea 20261227a nu se poate rula cât 20261228a e aplicată). (2) **oPOD în butonul unic**: funcția edge citește alegerea lotului (`citesteLotFan`) ÎNAINTEA hash-urilor (lot nemarcat = `false`, implicitul marcajului automat; coloana neinstalată / citire picată = 503, nimic chemat), iar `fn_red_fan_comanda(…, p_opod)` o compară sub lock-ul rândului `red_fan_loturi`: altă alegere = `RD038`, nimic scris; ecranul nu activează butonul fără coloana confirmată (`MESAJ_OPOD_NEINSTALAT_PASI`) și spune costul oPOD în confirmare. (3) **cheia intenției se reconciliază cu BD-ul înaintea oricărui rezultat terminal** (P1 #2): fără niciun plic valid, funcția edge citește cheia exactă (`v_red_fan_intentii`) — absentă = încheiat; încheiată = replay; închisă = `RD034`; în curs = 409 `intentie_neincheiata`, neîncheiat. (4) **registrul local iese doar pe dovada din BD** (P1 #1): după apel, citirea exactă a cheii pornită DUPĂ răspuns (`decizieDupaApel`): stare terminală = iese; cheie absentă = iese doar la un rezultat dovedit (refuz înaintea scrierii); 503 / timeout / citire picată = rămâne; în efectul de lămurire, absența dintr-o listă contează doar dacă citirea ei a pornit la ≥ 10 minute după ULTIMA apăsare cu cheia (`apasat_la`, scris înaintea fiecărui apel, și la „Reia”). (5) **descărcările după invalidare** (P2 #3): foile și pagina de control se descarcă doar cât acțiunea e a lotului / ecranului de acum (generația reverificată după răspuns și după construirea paginii de control). Probe: `src/redari/ui/fanTrimitereDom.test.jsx` (ecranul montat în jsdom, răspuns ambiguu + recitire întârziată + listă veche, 6 mutanți prinși), `src/redari/fanOperator.test.js` (reconcilierea, oPOD, 3 mutanți ai transportului), proba PGlite (RD038, refuzurile bazei fără 20261227a / cu garda veche / fără trigger-ul de jurnal, revenirea cu 21 de funcții, 2 mutanți RD038).
- **F1 — ecranul**: `src/redari/ui/FanTrimitere.jsx` (secțiunea operatorului „📦 Trimite la curier”: lista cu „gata / lipsește …”, plafonul zilei, avertismentul Q2, butonul unic, registrul local al intenției + „Reia trimiterea”, „Verifică la curier” + „Confirmă: găsit”, „Retrage din trimitere”, „Retrage cererea”, „Anulează AWB-ul” cu motiv din listă; pentru owner: „Operatori curier”, „Cereri de aprobare”, plafonul zilei + presupunerea P429, „Lista anulărilor”), legată în `FanAwbPrevizualizare.jsx` (pașii vechi strânși în „Pași detaliați (owner)”); logica pură și mesajele §8.5 într-o singură definiție în `src/redari/fanLot.js` (`stareTrimitere`, `registruIntentii`, `rezultatDovedit`, `mesajTrimitere`, …), probate în `src/redari/fanOperator.test.js`.
- `src/redari/fanLot.js` + `src/redari/ui/FanAwbPrevizualizare.jsx` — în ✉️ Poștă, la fiecare lot, „📦 AWB FAN”: previzualizarea pe plic + cei 7 pași + operațiile (reconciliere cu confirmarea pe rând, plafonul pilot, anularea AWB-ului, lista de evenimente, etichetele pe toate părțile), toate dezactivate vizibil cu „transport oprit”; marcajul de TEST în titlu și în fișiere; borderou CSV fără date personale; pagina de control.
- `src/redari/plicuri.js` (`planPachetPlicuire`, `genereazaPaginaControl`, `ordineConvocari`) + buton „Documente lot (ZIP, în ordinea plicurilor)” în Loturi: documentele arhivate (opis + convocări) + pagina de control, într-o singură ARHIVĂ ZIP pe lot (fișierele rămân separate în ea; conținutul exact: §12, „Decizii”). Pe un lot FAN (marcat TEST / real) arhiva folosește manifestul comun cu etichetele (`manifestTiparire` din `redariFan.mjs`, aceeași funcție ca funcția edge) și prefixul `TEST_` pe un lot de test; pe un lot de Poștă, toate plicurile active. Numele: poziția plicului pe 4 cifre, documentul pe 3 (opisul = `000`): `0001_PL-ABC-0007_000_opis.docx`, `0001_PL-ABC-0007_001_C-000123.docx` — sortarea alfabetică = ordinea de tipărire (§12). Runda 3, pe un lot FAN: arhiva trece prin `pregatestePachetFan` (`src/redari/fanLot.js`: manifestul din evidența recitită → lipsurile ÎNAINTE de tiraj → `fn_red_fan_tiraj` cu cheia acestui manifest), iar pagina de control din etichete și din arhivă vin din ACEEAȘI funcție (`controlLotFan`, aceleași intrări: manifest + plicuri + convocările pe plic + tirajul din BD), cu tirajul în locul datei zilei; numele poartă tirajul: `PP-0001_tiraj-1A2B3C4D_etichete.pdf` (până pe 18.11.2026 cu „_A6” în nume; formatul nu mai e afirmat în nume), `PP-0001_tiraj-1A2B3C4D_pagina_de_control.docx`, `PP-0001_tiraj-1A2B3C4D_documente_in_ordinea_plicurilor.zip` cu `0000_tiraj-1A2B3C4D_pagina_de_control.docx` și `0001_PL-ABC-0007_000_opis_T1A2B3C4D.docx`. Ecranul arată (18.11.2026) tariful fiecărui AWB lângă număr și totalul lotului („Tarif FAN pe lot”), iar borderoul CSV are coloana „Tarif (lei, fără TVA)”.

**Identificatorul tirajului pe ETICHETĂ: nu se poate.** `GET /awb/label` primește doar `clientId`, `awbs[]`, `pdf`, `format` (§1): niciun câmp de text la tipărire; eticheta arată ce s-a trimis la CREAREA AWB-ului (`content` / `observation` = numărul plicului, §2), iar AWB-ul există înaintea tirajului. Identificatorul stă în numele PDF-ului și pe pagina de control, lângă AWB-ul și numărul plicului fiecărei poziții.

**Eticheta: A6 cerut, A4 primit (18.11.2026).** Decizia proprietarului: format A6 (100×150 mm) pentru imprimanta termică. Codul cere mereu `format=A6` (constanta `FORMAT_ETICHETA`,
parametrul din documentația FAN, §1), fără alegere în ecran. La primul AWB real PDF-ul întors a avut pagina A4 (595 × 842 pt, conținutul pe toată pagina). Documentația din
repo nu arată alt parametru pentru A6, deci nu se ghicește unul: întrebarea e pentru curier (§8, deschisă 17). Până la răspuns, butonul („4. Etichete (PDF)”), mesajul și
numele fișierului (`…_etichete.pdf`) nu afirmă formatul, iar omul verifică formatul paginii pe PDF înainte de tipărire (procedura, §8 pasul 2).

**Tipărire pe lot.** Documentația spune că `/awb/label` primește mai multe AWB-uri într-un apel (`awbs[]`) și întoarce un PDF → ERP-ul cere **AWB-urile manifestului, în ordinea pozițiilor**, și descarcă **un fișier** pe parte. Fără librării noi: nu se lipesc PDF-uri în browser (pdf-lib nu e compatibil cu build-ul nostru). Peste 100 de AWB-uri (limita de etichete pe apel nu e documentată; s-a ales prudent aceeași limită de 100) etichetele vin în **părți numerotate** (`_partea01din02`), câte un buton pe parte, cu pozițiile scrise pe buton; cu plafonul pilot (20) lotul încape într-un fișier. Că PDF-ul păstrează ordinea din `awbs[]` e de verificat la Testul 1 (§11).

## 7. Revenire

- Înainte de orice AWB real: se șterge funcția edge, se aplică revenirea prin runner (`--plafon-tranzactie-ms 2000`, comanda e în antetul fișierului; refuză dacă există rânduri FAN, loturi marcate sau setări schimbate), se scoate butonul din UI (revert PR).
- După AWB-uri reale: tabelele rămân (evidență de cost și dovadă); se oprește doar generarea (flag în cod înapoi pe `false` + funcție ștearsă). AWB-urile neridicate se șterg din selfAWB.
- **Istoricul livrării la reaplicarea de TEST după revenire (runda 3; doar pe clonă).** Revenirea DDL nu scoate rândul migrării din istoricul livrărilor: runnerul înregistrează și revenirea ca livrare proprie (`20261212120001 20261212a_redari_fan_awb_ROLLBACK`), iar rândul `20261212120000 20261212a_redari_fan_awb` rămâne. O reaplicare cu același nume / aceeași versiune e refuzată de runner („migrarea e deja înregistrată — refuz”, `scripts/livrare_migrare.sh:352–355`). Pe CLONĂ, coordonatorul șterge explicit AMBELE rânduri din istoric după revenire (cum face proba lui: „istoric sters de pe clona: 20261212120000 …, 20261212120001 …”) și abia apoi reaplică; pe PRODUCȚIE istoricul nu se rescrie niciodată — după o revenire reală, o nouă aplicare se face cu un fișier nou (altă versiune), revizuit ca orice migrare.
- **Revenirea lui 20261227a (oPOD, rundele 2–4)**: refuză la orice folosire de după aplicare (alegeri `opod_schimbat`; ORICE eveniment `opod_aprobare` / `opod_folosire` — fiecare aprobare, propunere, rezervare, rezultat, reconciliere, ridicare, anulare sau ștergere de după aplicare, pe orice lot, durabil, oricare ar fi starea de acum a rândului, rundele 3–4; lot aprobat după aplicare — și cu implicitul `false` —, rânduri FAN create / scrise după momentul din marcajul `opod_instalat`, în orice stare, inclusiv urmărirea, runda 4; `opod = true` în afara listei deduse); loturile deduse `true` din istoric NU o opresc. E doar pentru aplicarea NEFOLOSITĂ: după primul pas FAN, corectura e o migrare nouă. Scoate trigger-ul de jurnal și cele două funcții noi (21 → 19 funcții), scrie `opod_dezinstalat` în jurnal; reaplicarea cere marcajele echilibrate și niciun `opod_aprobare`. Lock-uri: ACCESS EXCLUSIVE pe `red_fan_loturi` și pe `red_fan_awb` (DROP TRIGGER), NOWAIT, buget 1 s. Se face DOAR înaintea revenirii lui 20261212a — care, oricum, refuză cât `red_jurnal` are rânduri FAN (marcajele rămân).
- **Versiunea `20261212120000` e mai VECHE decât migrări deja aplicate** (ex. 20261220120000, 20261222120100 pe clonă). Runnerul analizat nu o blochează: verifică existența numelui / versiunii în istoric, nu o compară cu versiunea maximă aplicată (`scripts/livrare_migrare.sh:352–355`). Se consemnează și se verifică la aplicare că rândul nou apare în istoric cu exact `20261212120000` / `20261212a_redari_fan_awb` (fără conflict exact de nume sau versiune); fără redenumire. Alte unelte (CLI Supabase `db push`) NU se folosesc pentru această livrare: ele ar putea trata o versiune mai veche altfel.

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
8. **Eticheta: A6 pe imprimantă termică** (decizia proprietarului, 17.11.2026). Închide fosta întrebare 5. Decizia rămâne; cum se obține A6 de la curier e deschisa 17 (18.11.2026).
9. **oPOD (confirmarea de primire în original, opțiunea B, +14 lei / plic după ofertă): implicit OPRIT; se cere explicit de owner, pe lot, înainte de prima aprobare** (decizia proprietarului: 09.11.2026 la întâlnirea cu curierul, reconfirmată 18.11.2026 după primul AWB real de 27,16 lei în loc de 13,16). Confirmarea implicită = cea electronică, de pe terminalul curierului (urmărire + `/reports/awb/confirmations`). Întrebarea juridică (deschisa 1) rămâne deschisă pentru loturile REALE: dacă juridicul cere oPOD, owner-ul îl bifează pe lot.

**Deschise**

1. Juridic: FAN + oPOD = „recomandată cu confirmare de primire” pentru convocare (Legea 185/2016 art. 11 alin. 4, plan pct. 4.2)? Termenul de 10 zile curge de la ridicarea de către curier? **Fără răspuns încă.**
2. FAN: există o limită de solicitări pe minut? Nu e documentată; întrebare trimisă pe 15.11.2026, fără răspuns încă. (Codul: pe rând, pauză 2 s, cel mult 5 solicitări de creare pe apăsat.)
3. FAN: AWB-urile create cu contul general de test sunt reale / au cost? De verificat înainte de orice apel de creare cu acel cont. **Decizia proprietarului (17.11.2026): primul test se face pe contul de TEST; costurile se lămuresc pe acel cont** (fără alternativa „trecem pe expedieri plătite”).
4. FAN: greutate și dimensiuni minime pentru plic; tarif contractual pe plic.
5. ~~Etichetă A4 sau A6~~ → închisă: A6 (Lămurite 8).
6. Contul selfAWB: un singur punct de lucru (clientId) pentru Ploiești sau unul per proiect?
7. Câmpurile exacte din răspunsul `GET /reports/awb/confirmations` (ce conține fiecare element al listei și cum se ajunge la imaginea confirmării): de citit pe un răspuns real. Codul: element cu AWB → „primită, de verificat de om”; orice altă formă → „formă necunoscută”.
8. Câmpurile răspunsului `GET /reports/awb/internal-tariff` (tariful estimat afișat la aprobare). Până atunci, aprobarea arată numărul de AWB-uri, nu suma.
9. Câmpurile corpului `POST /order` (comanda curierului). Până atunci, comanda se face manual în selfAWB. Ce se știe (§1): o comandă pe punct de lucru pe zi, interval de
   cel puțin 2 ore, în afara Bucureștiului L–V 09–17, S 09–14; anularea `DELETE /order?clientId=&id=`. Ce lipsește ca să se poată face din platformă (raportul din 18.11.2026):
   câmpurile corpului (punctul de lucru / adresa de ridicare, intervalul orar, data, numărul de plicuri / greutatea, persoana de contact, observații), forma răspunsului
   (identificatorul comenzii, cum se citește starea ei), ce întoarce la a doua comandă în aceeași zi și dacă ridicarea se leagă de AWB-uri sau doar de punctul de lucru.
10. Forma răspunsurilor la urmărire, borderou și login, pe un răspuns real: codul acceptă lista ca `data` / `response` / listă directă și `awbNumber` sau `awb`; orice altceva = de verificat. Data evenimentelor fără fus orar e presupusă ora României.
11. Ordinea elementelor din răspunsul `POST /intern-awb` = ordinea expedierilor trimise? Are fiecare element un identificator al expedierii (referința noastră în `observation` / `content`)? Documentația nu dă un identificator pe element: codul folosește referința DACĂ apare (o referință diferită de plicul de pe poziție = toată solicitarea „necunoscut”) și altfel asociază pe poziție, doar la număr egal de elemente — **PRESUPUNERE NECONFIRMATĂ** (runda 3: rămâne așa în cod, marcată); asocierile pe poziție sunt numărate în mesajul generării. Confirmarea pe primul răspuns real (Testul 1, pașii 4a / 4b) e **pas BLOCANT** în lista de activare (§10 pasul 4a): până atunci niciun lot mai mare de un plic, în afara pasului 4b al Testului 1 (lot de TEST, adrese interne, oprire la orice nepotrivire).
12. Câmpul `observation` (sau `content`) apare tipărit pe eticheta A6? Limita lui de caractere? De confirmat la Testul 1; lipsa lui = OPRIRE la Testul 1 (§11, „Oprire imediată”): eticheta nu se mai poate verifica față de pagina de control (§12). Scrierea de mână a numărului pe plic NU e procedura — ar fi o derogare decisă explicit de proprietar, în jurnalul testului, înainte de a continua.
13. Codul de eveniment pentru „destinatar negăsit / necunoscut la adresă”: nu e în lista de lucru; de luat din `/reports/awb-events`. Până atunci, semnalele de adresă propun „adresă incompletă”, iar omul alege motivul final.
14. Limita de AWB-uri pe apel la `/awb/label` și dacă PDF-ul păstrează ordinea din `awbs[]`.
15. Forma răspunsului de succes la `DELETE /awb` (runda 2). Codul acceptă ca „șters” DOAR HTTP 200 + `status: "success"` fără erori (forma generală a răspunsurilor FAN, ca la login); orice altceva păstrează AWB-ul și cere verificarea în selfAWB. De confirmat pe un răspuns real, la Testul 1 (ștergerea unui AWB de test).
16. Formatul elementelor din borderoul zilei (`GET /reports/awb`) — unde stă referința noastră. Un element fără referință într-un câmp cunoscut (de ex. un AWB făcut manual în selfAWB în aceeași zi, fără observații) face reconcilierea zilei „de verificat de om” pentru toate rândurile; recomandare operațională: în zilele cu generare din ERP, AWB-urile manuale primesc o observație.
17. **Formatul etichetei (18.11.2026, Testul 1):** cererea `GET /awb/label?…&pdf=1&format=A6` (exact parametrul din documentația FAN) a întors un PDF cu pagina A4 (595 × 842 pt), cu conținutul pe toată pagina. Întrebare pentru curier: parametrul `format` e luat în seamă la `pdf=1`? Formatul A6 depinde de o setare a contului / punctului de lucru în selfAWB? Există alt parametru sau altă valoare (ex. `A6` doar pentru HTML / ZPL)? Până la răspuns codul trimite parametrul documentat, iar numele butonului / fișierului nu afirmă A6; nu se încearcă valori ghicite pe cont real (fiecare apel de etichetă e pe un AWB existent, dar un parametru greșit poate întoarce HTML de eroare, tratat ca `eticheta_neconfirmata`). Alte observații ale aceleiași probe, pentru selfAWB: expeditorul de pe etichetă a fost un alt punct de lucru decât sediul (setarea `clientId` / punctul de lucru al contului de TEST), iar tariful nu e tipărit pe etichetă (vine doar în răspunsul creării).

## 9. De făcut în cod

Făcute pe 17.11.2026 (inerte, testate pe răspunsuri simulate):

1. ✅ **Loturi de cel mult 100 la creare**: `imparteInBucati` + `interpreteazaRaspunsLot` (asociere pe poziție doar la număr egal de elemente, rezultat parțial pe element, „necunoscut” pe toată bucata la timeout/5xx sau formă ambiguă) + `fn_red_fan_claim_lot` / `fn_red_fan_rezultate` (o cheie pe solicitare, toate rezultatele odată). Alegerea între 1 și 100 pe apel: codul acceptă orice mărime 1…100; implicit 100, cu oprire la primul rezultat necunoscut.
2. ✅ **Loturi de cel mult 100 la urmărire și la confirmări**: acțiunile `urmarire` și `confirmari`, `awb[]` în bucăți de cel mult 100.
3. ✅ **Confirmări în format JSON**: `GET /reports/awb/confirmations` cu `clientId`, `awb[]`, `language=ro`; răspunsul nu se stochează, doar starea (deschisă 7).
4. ✅ **Lista de evenimente**: acțiunea `evenimente` compară `GET /reports/awb-events` cu `EVENIMENTE_FAN` (coduri lipsă la FAN / coduri FAN neclasificate). Lista din cod rămâne cea din PDF până la comparația pe răspunsul real (§10 pasul 6).
5. ✅ **Comentariul de sursă** din capul `redariFan.mjs` actualizat (docs-unified 1.1.0 + răspunsurile FAN din 12–13.11.2026).
6. ✅ **PR-ul de activare (18.11.2026)**: `TRANSPORT_REAL_ACTIV = true` + `DOAR_PROIECTE_TEST = true` (garda „doar TEST”, §4), ecranul cu același
   motiv pe butoane și banner-ul „TRANSPORT REAL PORNIT pe acest lot de TEST”; teste: proiect real → 423 chiar cu comutatorul pornit, lot nemarcat →
   423, lot de TEST → calea reală (secretele se citesc), 6 mutanți ai gărzii prinși, comportamentul cu comutatorul oprit neschimbat (flag mutat pe
   `false`: 423 `transport_real_oprit` fără nicio citire); proba PGlite: plafonul 1 → 3 → 20 pe aprobare. Procedura: `FAN_TEST1_PASI.md`.
   **Runda 2 a activării** (verdictul Jakarinos pe PR #1130, 18.11.2026; corecții de procedură, fără cod nou în gardă): procedura zilei reordonată
   după ce permite ecranul (marcaj TEST pe lotul gol → plafon 1 + recitire din BD + fără aprobări existente → propunere → aprobare → generare), cu un
   test care parcurge tabelele documentului de la lot gol (`fanProcedura.testutil.js`; documentul vechi și mutanții ordinii din cod PICĂ); opririle
   Testului 1 păstrate în procedură (tarif gol / diferit, referința absentă de pe etichetă; derogarea doar a proprietarului); plafonul 20 cu un singur
   moment (încheierea Testului 1); oprirea de urgență descrisă exact (secretele / funcția / flag-ul opresc cererile NOI, nu una începută; cererile
   în curs: fără reapăsare, BD + selfAWB, reconciliere); lista de control a zilei (§0 din procedură).
   **Runda 3 a activării** (al doilea verdict Jakarinos pe PR #1130, 18.11.2026; tot fără cod nou în gardă): o SINGURĂ definiție a procedurii —
   ordinea pașilor e DOAR în `FAN_TEST1_PASI.md`, iar §11 de aici păstrează criteriile de acceptare (cele două copii ale ordinii ajunseseră să se
   contrazică: plafonul 3 și aprobarea celor trei plicuri înaintea pasului cu UN plic); continuarea cu trei plicuri separată de verificarea
   inițială globală (lot NOU marcat TEST, plafonul 3 recitit, verificările lotului nou cu istoricul primului lot numit explicit, SQL de citire
   propriu); plafonul 20 executat și recitit la încheiere (nu doar anunțat); coloana „Acțiune” (identificator stabil al pasului) și proba completă
   a procedurii (primul plic → lotul de 3 cu istoricul prezent → încheierea; precondițiile fără buton nu pot fi scoase sau mutate; documentul de la
   9fb88b2f pică pe continuare); durata unei cereri scrisă ca estimare, cu ce NU include.

7. ✅ **Runda 2** (verdictul PR #1118): reconcilierea fără concluzii pe elemente neînțelese, manifestul comun etichete ↔ documente + pagina de control, ștergerea strictă, marcajul imuabil istoric, operațiile în ecran + garda de generație, motivele fără PII, numele din arhivă, amprenta surselor la rezervare, versiunea urmăririi, referința pe element; migrarea și revenirea în forma livrării L15 v2.
8. ✅ **Runda 3** (re-review PR #1118): tirajul (o cheie de manifest pentru toate descărcările, `fn_red_fan_tiraj`, „Tiraj nou”), pagina de control identică în etichete și arhivă (cu numărul documentelor și tirajul), reverificarea generației după `await` la etichete (L24), urmărirea fără evenimente nu șterge ce se știe, scriptul cu două sesiuni reparat + fixture sintetic, garanția rezervării scrisă exact.
9. ✅ **Runda 4** (re-review PR #1118 pe fdaa0496): reverificarea finală a tirajului (funcția edge după PDF, ecranul după arhivă / pagina de control), „Tiraj nou” în trei pași impuși de BD (`fn_red_fan_tiraj_opreste`, `RD021` / `RD022`) + evidența în `red_jurnal`, faptele urmăririi păstrate și contradicțiile vizibile (`red_fan_awb_fapte`), fixture-ul cu precondiții (FX001–FX003) fără plasă, profilul `fan` în proba de concurență la aplicare, documentul aliniat la deciziile din 17.11.2026.
10. ✅ **Runda 5** (re-review PR #1118 pe 58abaa54): ceasul efectiv la oprirea tirajului și în comparația celor 30 s (și la rezervare / cele 10 minute ale reconcilierii); soluționarea umană a contradicțiilor urmăririi (`fn_red_fan_urmarire_solutioneaza`, `RD023`, `red_fan_awb_contradictii`, acțiunea din ecran); L1b sincronizat cu așteptarea aplicării; T3a / T3b (ceasul și durata reală pe server) și C1 / C2 (soluționarea concurentă) în proba cu două sesiuni.
11. ✅ **După primul AWB real (18.11.2026, fără migrare)**: tariful și totalul lotului în ecran + în borderoul CSV (`textTarif`, `textTotalTarif`; gol = „tarif necunoscut”, evidențiat); „1. Propune” dezactivat când nimic nu e de propus și lista trimisă = doar plicurile de propus (`starePropunere`); „2b. Marchează real” dezactivat cât `DOAR_PROIECTE_TEST` (`stareMarcajReal`); eticheta fără „A6” în buton / mesaj / nume de fișier (cererea neschimbată: `format=A6`); `EVENIMENTE_FAN` completată cu lista reală (37 de coduri; §1), S98 afișat „AWB înregistrat la curier”, codurile nelimpezi „de verificat de om”. Simulatorul procedurii folosește aceleași funcții (`starePropunere`, `stareMarcajReal`); mutanții noi în `fanCourierMutanti.test.js` (inclusiv forma 2f7fabc1, care trebuie să pice).

Rămase pentru activare (după răspunsuri FAN / juridic): validarea adreselor cu nomenclatorul (`/reports/counties`, `/reports/localities`), tariful estimat (deschisă 8), comanda curierului prin API (deschisă 9), formatul A6 al etichetei (deschisă 17), confirmarea formelor de răspuns (deschise 10, 11, 15, 16).

## 10. Lista de activare (în ordinea recenzentului, runda 3; ⚑ = cere acordul proprietarului; fiecare pas are proba lui și cine o face)

1. **Concurența tirajului, pierderea informației la urmărire, documentul și arhiva aliniate la deciziile proprietarului** — runda 4 a PR #1118 (acest cod: reverificarea finală + „Tiraj nou” în trei pași + jurnalul, §5; faptele urmăririi, §5; §11 / §12 aliniate la deciziile din 17.11.2026); runda 5: ceasul efectiv al opririi, soluționarea contradicțiilor (obiect nou — ⚑ proprietarul e informat), L1b sincronizat, T3 / C1 / C2. Rămâne: review Jakarinos + Fable pe forma finală (runda 5).
2. **Precondițiile fixture-ului, trigger-ul real și dovezile L0 / L1 / L2 pe PostgreSQL** (coordonatorul, cu 20261212a aplicată pe CLONĂ prin runner):
   - pregătirea clonei goale după antetul `supabase/tests/20261212a_redari_fan_fixture.sql` (drepturile lui postgres pe `auth.users`, trigger-ul real; sarea se rezolvă singură), apoi `supabase/tests/20261212a_redari_fan_doua_sesiuni.sh --cu-fixture` (§11, „Probele pe clonă”) → cod 0, toate rândurile `OK` (inclusiv T2 / T2b, runda 4; T3a / T3b / C1 / C2, runda 5 — proba durează ~75 s, din care T3b ~31 s), „curatenie: … fixture-ul sters si verificat”; o precondiție lipsă = cod 26 / 27 / 28 (nimic scris); ieșirea întreagă în jurnalul livrării;
   - concurența la APLICARE: `supabase/tests/l15_aplicare_concurenta.sh --migrare fan …` (profilul `fan`, runda 4: L0, L1 + L1b, L2, F1; rezultatele așteptate în antetul scriptului și în §11) cu 20261212a NEAPLICATĂ pe clonă;
   - ciclul aplicare → revenire → reaplicare prin runner (§7, istoricul pe clonă).
3. ⚑ **Baseline L15 revizuit pentru forma finală, procedura și aprobarea de aplicare; publicarea cu flag-ul `false` și probele reale 401 / 403 / 423.**
   **3a. Migrarea 20261212a**, după procedura `docs/LIVRARE_L15_V2.md` §7 (pașii coordonatorului): citirea pe producție → manifestul `supabase/migrations/20261212a_redari_fan_awb.l15.tsv` generat pe clonă (`scripts/livrare_l15_manifest.sh … --plafon-tranzactie-ms 5000 --iesire …`) și comparat cu lista revizuită `supabase/tests/20261212a_redari_fan_awb.l15.obiecte.tsv` → `l15_compara_liste.sh` = `COMPARABIL` → PR de baseline (manifest + sha256) → review Jakarinos + Fable → recitirea din ziua livrării → proba cu ROLLBACK pe producție (`--compara-cu`, cu acordul owner-ului) → aplicarea de către chat (`livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala … --diferente-globale …`). Lock-urile la aplicare: SHARE ROW EXCLUSIVE pe `red_proiecte`, `red_loturi_plicuire`, `red_plicuri` (opresc doar scrierile Redări, ~1,3–1,6 s estimat). Postcondițiile sunt în migrare (RLS, drepturi pe fiecare rol, cele 19 funcții, trigger, plafon 20). Revenirea: prin runner, cu 2000 (antetul fișierului de revenire).
   **3b. Publicarea funcției** `redari-fan-awb` (de chat), cu flag-ul încă `false`. **Proba 401 / 403 / 423 printr-un apel controlat** (din ecran nu se poate: toate butoanele sunt dezactivate), de pe server, cu acțiunea fără cost `evenimente` și un lot de TEST (`<URL>` = adresa proiectului Supabase, `<ANON>` = cheia publică; JWT-urile se iau din sesiunea contului respectiv și nu se scriu nicăieri):
   ```bash
   corp='{"actiune":"evenimente","lot_id":"<uuid lot TEST-RAZVAN>"}'
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H 'Content-Type: application/json' -d "$corp"                                   # așteptat 401 (fără JWT)
   curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT cont ne-owner, ex. contul de test Claude>" -H 'Content-Type: application/json' -d "$corp"   # așteptat 403 {"cod":"non_owner"}
   curl -s -X POST "<URL>/functions/v1/redari-fan-awb" -H "apikey: <ANON>" -H "Authorization: Bearer <JWT owner>" -H 'Content-Type: application/json' -d "$corp"                                 # așteptat 423 {"cod":"transport_real_oprit"}
   ```
   Plus: un `actiune` necunoscut cu JWT-ul owner-ului → 400; jurnalul funcției (Supabase → Edge Functions → Logs) fără apeluri către api.fancourier.ro.
4. ⚑ **Confirmările FAN pe contul de TEST, costurile și contractele API; PR separat de activare; apoi Testul 1 și pasul 4a.**
   - **FAN**: răspunsuri la §8 deschise 2, 3, 4, 6 (limita pe minut, contul de TEST — **decizia proprietarului din 17.11.2026: primul test se face pe contul de TEST**; întrebarea „se facturează AWB-urile create cu el?” se lămurește PE ACEL CONT, cu FAN, înaintea primului apel de creare —, plicul, punctul de lucru). Contract activ pe API.
   - **Secretele** contului de TEST în Supabase → Edge Functions → Secrets (de proprietar): `FAN_SELFAWB_USERNAME`, `FAN_SELFAWB_PASSWORD`, `FAN_CLIENT_ID`.
   - **PR de activare** (separat, revizuit — 18.11.2026): `TRANSPORT_REAL_ACTIV = true` **cu garda `DOAR_PROIECTE_TEST = true`** (doar proiecte `TEST-…` cu lotul marcat TEST; restul 423) și schimbarea testelor care cereau `false`. **Ordinea pașilor din ecran, verificările din BD și SQL-ul lor sunt DOAR în `FAN_TEST1_PASI.md`** (o singură definiție; acest document nu le repetă). Decizia de plafon (setarea `red_fan_setari.limita_lot`, pusă de owner din ecran și recitită din BD la fiecare schimbare): **1** la primul plic, **3** la lotul de 3, **20** la încheierea Testului 1 (precondiția Testului 2) — momentele exacte sunt în calendarul din procedură (§6). După publicare, owner-ul apasă „Lista de evenimente FAN” (pe lotul de TEST marcat) și compară lista; diferențele se pun în `EVENIMENTE_FAN` printr-un PR mic, înainte de prima urmărire reală. Probele 401 / 403 / 423 se refac pe forma activată (423 = lot nemarcat pe `TEST-RAZVAN` și lot al unui proiect real, `FAN_TEST1_PASI.md` §4).
   - **Testul 1** (§11 = criteriile de acceptare), pe contul de TEST, loturi marcate TEST; pașii zilei, în ordine, cu oprirea la orice formă neașteptată: `FAN_TEST1_PASI.md`.
   - **4a. BLOCANT: confirmarea asocierii răspuns ↔ plic pe primul răspuns real** (§8 deschisă 11), în Testul 1 (pașii 4a / 4b), consemnată în jurnalul testului: (i) poartă fiecare element referința (`observation` / `content`)? (ii) ordinea elementelor = ordinea expedierilor (verificat în selfAWB pe fiecare AWB ↔ numărul plicului din observații, inclusiv pe poziția elementului respins)? Până la confirmare: NICIUN lot mai mare de un plic (în afara pasului 4b al testului), Testul 2 nu pornește. Dacă elementele nu poartă referința și ordinea nu se poate confirma: un PR reduce bucata de creare la UN plic pe solicitare (`imparteInBucati(…, 1)`; codul acceptă 1…100), revizuit înainte de Testul 2.
5. ⚑ **Numai după acceptarea Testului 1 și „da”-ul juridic: Testul 2; ulterior creșterea plafonului.**
   - **Juridic**: „da” scris pentru FAN + oPOD ca recomandată cu confirmare de primire (§8 deschisă 1). Fără el, convocările rămân la Poșta Română; FAN se poate folosi doar pentru loturi de TEST.
   - **PR-ul Testului 2** (separat, revizuit): `DOAR_PROIECTE_TEST = false` (lotul real rămâne păzit de marcajul owner-ului, de plafonul pilot și de aprobarea pe hash).
   - **Testul 2** (§11); abia după el plafonul pilot se ridică din ecran (caseta „Plafonul lotului pilot” → „Schimbă plafonul”, owner).
   - Registrul de automatizări + rândul din `public.automatizari` (fișa a–e de la §4), la activare (de chat).

## 11. Testele de activare

### Testul 1 — intern, 3 plicuri, unul refuzat

Scop: tot lanțul pe 3 plicuri trimise **la adrese interne**, pe proiectul de test, cu AMBELE respingeri: a plicului 2 **la creare** (FAN refuză
elementul) și a unui plic **la livrare** (destinatarul refuză). Lot marcat **TEST**.

**Înainte (scrise în jurnalul testului):** (a) **contul de TEST FAN — DECIS de proprietar (17.11.2026)**: Testul 1 se face pe contul de
TEST; problema costurilor se lămurește PE ACEL CONT (§8 deschisă 3: întrebarea către FAN „se facturează AWB-urile create cu contul de test?”,
răspunsul în scris în jurnal, înaintea primului apel de creare). Dacă răspunsul arată un cost, se oprește și se întreabă proprietarul (decizia
de cont nu se schimbă de aici). Marcajul TEST din ERP NU schimbă contul FAN. (b) **trei adrese interne aprobate**
(colegi care acceptă), completate pe trei deținători de test, cu telefon. (c) documentele celor 3 plicuri arhivate (opis la dosar pe fiecare).

**Oprire imediată** (nu se continuă, se reconciliază / se lămurește, apoi se reia de la pasul în cauză) la: orice rezultat „necunoscut”; „tirajul s-a schimbat” neașteptat (în afara pasului 8);
„asociate pe poziție” > 0 fără verificarea în selfAWB a fiecărui AWB ↔ plic; tarif lipsă sau diferit de oferta FAN; referința (numărul
plicului) absentă de pe etichetă; ORICE nepotrivire între pagina de control, etichetă și teancul de documente; „manifest schimbat”.
O continuare după oricare dintre ele e o **derogare**: o decide DOAR proprietarul, explicit, scrisă în jurnalul testului înainte de pasul următor
(nu coordonatorul, nu „de notat pentru mai târziu”). Procedura zilei: `FAN_TEST1_PASI.md` §12.

**Procedura — ordinea pașilor, butoanele, verificările din BD și SQL-ul lor — e DOAR în `FAN_TEST1_PASI.md`: o singură definiție** (L19; runda 3 a
activării, după ce cele două copii ale ordinii ajunseseră să se contrazică: aici plafonul 3 și aprobarea celor trei plicuri veneau înaintea pasului
cu UN plic). Acest document păstrează DOAR **criteriile de acceptare**: ce trebuie să fie adevărat, în jurnalul testului, la sfârșitul fiecărei faze;
altceva = oprire (mai sus). Coloana „Faza” trimite la secțiunile procedurii; referințele „§” din coloana criteriului sunt la acest document.

| Faza (secțiunea din `FAN_TEST1_PASI.md`) | Criteriul de acceptare |
|---|---|
| Pregătirea (procedura §0–§4) | lista de control §0 bifată (ID-ul proiectului și ale celor două loturi, codul `TEST-RAZVAN`, conținut fictiv; nimeni nu redenumește proiecte și nu schimbă marcaje); secretele = contul de TEST al curierului, confirmat prin login în selfAWB, `clientId`-ul lui, costurile acceptate explicit (§8 deschisă 3); funcția publicată = SHA-ul de pe `main`, forma activată; probele 401 / 403 / 423 / 400 pe versiunea inertă și pe cea activată, cu dovada din trei (codurile + jurnalul funcției + selfAWB fără AWB nou); lotul PP-xxxx cu UN plic (date ale firmei): „1 din 1 plicuri au toate datele”, singurul buton activ „2a. Marchează TEST” |
| **4a — primul plic** (BLOCANT pentru tot ce urmează; procedura §5–§8) | lotul marcat TEST pe lotul gol; plafonul 1 setat ȘI recitit din BD; verificarea inițială globală trecută (zero aprobări / trimiteri în orice lot, exact un lot marcat); O solicitare cu UNA expediere → 1 AWB; ce se poate dovedi despre forma elementului din răspuns fără corpul brut (ERP-ul nu îl afișează și nu îl păstrează): mesajul generării (asociere pe referință sau pe poziție) + selfAWB; forma completă a elementului (§8 deschisă 11) rămâne DESCHISĂ și se lămurește printr-un PR separat, nu în Testul 1; **verdictul 4a în jurnal**: „pe referință” sau „pe poziție, confirmată în selfAWB” (altfel Testul 1 se oprește; PR cu bucata de UN plic, §10 pasul 4a); tariful (afișat în ecran lângă AWB și în total) = cel din selfAWB = oferta FAN; eticheta cu AWB-ul din ERP ȘI numărul plicului tipărit (§8 deschisă 12), formatul paginii notat în jurnal (§8 deschisă 17); pagina de control cu un rând și același tiraj; a doua descărcare = același fișier, același `<ID>` |
| **4b — lotul de 3** (procedura §9) | pornește DOAR cu verdictul 4a confirmat; lot NOU PP-yyyy (3 plicuri; plicul 2 cu o localitate care NU există în nomenclatorul FAN, ca FAN să-l respingă la creare) marcat TEST pe lotul gol; plafonul 3 setat ȘI recitit; verificările lotului NOU trecute (zero rânduri pe el; istoricul lui PP-xxxx exact cel așteptat: un rând generat / anulat, eventual eroare, nimic în curs / necunoscut / aprobat / propus; două loturi marcate); O solicitare cu 3 expedieri: 1 și 3 „AWB generat” (AWB + tarif), 2 „respins de FAN” cu câmpul semnalat, fără textul FAN; în selfAWB 2 AWB-uri cu numărul plicului la observații; **verificarea AWB ↔ plic pe fiecare, inclusiv poziția respinsului, ÎNAINTE de orice tipărire** („asociate pe poziție” > 0 = oprire până atunci; rezultatul în jurnal = §10 pasul 4a); tarifele = selfAWB = oferta; etichete: **2** (PL-…-0001 pe poziția 1, PL-…-0003 pe poziția 2) + pagina de control „tirajul <ID> (nr. 1)” cu 2 rânduri și „rămase: PL-…-0002”; arhiva ZIP cu ACELAȘI `<ID>`, fără fișierele plicului 2, pagina de control IDENTICĂ; verificarea celor trei numere (§12) pe fiecare poziție; plicul 2 rămâne deoparte |
| Tiraj nou (opțional, ⚑ cost; procedura §9, final) | corectarea plicului 2 → „Propune”, „Aprobă”, „Generează” → „Etichete” și „Documente lot” REFUZATE („tirajul s-a schimbat; retipărește tot lotul”, nimic descărcat); „Tiraj nou — 1. Oprește descărcările” → după 30 s foile ȘI fișierele tirajului `<ID>` distruse → „2. Înlocuiește tirajul”; „Înlocuiește” înainte de 30 s sau fără oprire = refuzat; cât e oprit, orice descărcare a tirajului `<ID>` = „descărcările … sunt OPRITE”, nimic descărcat; după înlocuire: tirajul `<ID2>` (nr. 2), 3 poziții (PL-…-0003 trece pe poziția 3), pagina de control fără „rămase”, toate fișierele noi cu `<ID2>` |
| Anularea (procedura §11) | forma reală a răspunsului `DELETE /awb` notată (§8 deschisă 15): forma recunoscută → „anulat” și AWB-ul dispare de pe borderoul selfAWB; altfel AWB-ul rămâne „generat” → verificare în selfAWB → „Marchează anulat” cu motiv; plicurile din Poștă neatinse |
| Comanda curierului și ridicarea (procedura §10) | comanda DOAR manual în selfAWB, cu decizia explicită a proprietarului; a doua zi „Urmărire” → „ridicat (C0): de confirmat” → „Confirmă ridicarea” → rândurile FAN „ridicat”; **plicurile din Poștă NU devin expediate** (lot de test) |
| Livrarea, returul, confirmările (procedura §10) | plicul 1 „livrat (S2)”; colegul destinatar al plicului 3 refuză → „RETUR”, propus „Refuz”; „Confirmări / retururi”: 1 „confirmare primită: de verificat”, 3 „nicio confirmare”; formele reale ale răspunsurilor notate (§8 deschise 7, 10) |
| Reconcilierea „pe uscat”, borderoul, factura | fără rânduri „necunoscut” butonul „Reconciliază” e inactiv; dacă a existat unul, propunerile se compară cu selfAWB înainte de orice confirmare, elementele neînțelese apar ca număr (§8 deschisă 16); borderoul CSV: primul rând „LOT DE TEST”, fără nume / adrese / telefoane; factura FAN = exact AWB-urile din ERP, tarifele = cele din ERP |
| Încheierea Testului 1 (procedura §10, ultimul tabel) | plafonul 20 setat ȘI recitit din BD; jurnalul complet (formele reale ale răspunsurilor, verdictul 4a) predat proprietarului; Testul 2 nu pornește de aici (PR separat, §10 pasul 5) |

### Testul 2 — lot real, 10–20 plicuri dintr-un UAT

Precondiții: Testul 1 trecut, asocierea răspuns ↔ plic CONFIRMATĂ în jurnalul lui (§10 pasul 4a; altfel bucata = 1 plic prin PR), „da” juridic (§10 pasul 5), plafon pilot 20, telefoanele completate pe plicurile alese.

Tabelul de mai jos e rezumatul criteriilor; lista de pași a Testului 2 (ca `FAN_TEST1_PASI.md`, verificată în același simulator față de ecranul fără
garda „doar TEST”) vine în PR-ul Testului 2 — până atunci tabelul NU se execută.

| Pas | Ce face omul | Ce se verifică |
|---|---|---|
| 1 | Lot de plicuire cu 10–20 plicuri dintr-un singur UAT, PV de plicuire semnat, opis la dosar pe fiecare | previzualizarea: toate plicurile cu date complete; cele fără telefon se scot din lot înainte |
| 2 | Admin/editor: „Propune” | N rânduri „propus” |
| 3 | Owner: „Marchează real”, „Aprobă” | N „aprobat”; peste 20 → refuz cu mesajul plafonului |
| 4 | Owner: „Generează AWB” | o solicitare; N AWB-uri; niciun „necunoscut” (altfel: stop, „Reconciliază”, nu reapăsa) |
| 5 | „Etichete (PDF)”, „Documente lot (ZIP, în ordinea plicurilor)” | un PDF cu N etichete (formatul paginii verificat; deschisă 17), un ZIP cu documentele și ACEEAȘI pagină de control în ambele: aceeași mulțime, aceleași poziții (manifestul comun), același identificator de tiraj în toate numele; „rămase” = 0, altfel stop: plicurile rămase se scot din lot sau se rezolvă înainte de tipărire |
| 6 | Plicuirea și verificarea pe pagina de control (§12) pe fiecare plic, de cei 2 colegi din PV | toate rândurile bifate; niciun plic cu numere diferite |
| 7 | Comanda curierului, ridicarea | „Urmărire” → C0 pe toate; „Confirmă ridicarea” → plicurile devin expediate în Poștă, cu AWB-ul și data C0; termenul de 10 zile se calculează de la data C0 |
| 8 | Zilnic: „Urmărire” + „Confirmări / retururi” | livratele → AR-ul se înregistrează de om din confirmarea electronică a curierului (dovada din `/reports/awb/confirmations`, „primită: de verificat de om”) sau, DOAR dacă lotul a cerut oPOD, din cartonașul oPOD fizic; retururile → „Înregistrează returul…” cu scanul plicului returnat → apar în PV B la „Demersurile de convocare” (AWB, data expedierii, retur) |
| 9 | Exportul pentru Transgaz | AWB-urile FAN apar ca număr de urmărire, datele de expediere = C0 |
| 10 | Bilanț | cost total = factura FAN; abia apoi se ridică plafonul pilot |

Testul 2 pornește DOAR după Testul 1 acceptat (jurnalul lui, cu formele reale ale răspunsurilor) și după „da”-ul juridic (§10 pasul 5).

### Probele pe clonă (PostgreSQL real, de coordonator; nu se pot rula pe serverul de cod)

`supabase/tests/20261212a_redari_fan_doua_sesiuni.sh` — două sesiuni psql reale, barieră pe lock consultativ cu chei UNICE pe rulare, codul
AMBELOR procese psql intră în verdict; sesiunea B scrie `R=` (rezultatul), `E=` (SQLSTATE, `00000` = fără eroare) și `M=` (mesajul exact), iar
timpul T0 / T1 se citește în afara tranzacției (după ROLLBACK-ul celei abortate). Rânduri FAN sintetice, notate după identificatori la inserare
și șterse DOAR pe ei la final; curățenia eșuată = cod 3 vizibil, fișierele de diagnostic rămân. Contactul atins de S2b / S2c se restaurează și
se verifică la final.

**Fixture sintetic (runda 3)** — `supabase/tests/20261212a_redari_fan_fixture.sql` (`--cu-fixture` îl creează la început și îl șterge la
final; se poate rula și separat cu `-v actiune=creeaza|sterge`): aceeași gardă `system_identifier`, sesiune postgres fără JWT; cu FK / CHECK /
trigger-ele REALE active creează proiectul de TEST `TEST-FAN-FIXTURE`, UAT `ZFX`, o parcelă, 3 deținători proprietari cu contacte sintetice
valide (`0700000101…103`, „Strada Fictiva nr. 1…3”), câte o convocare poștală activă, 3 plicuri active neexpediate fără AWB în lotul
`PP-9912`, și 3 conturi distincte (owner / editor Redări ne-owner / viewer Redări ne-owner: `auth.users` → trigger-ul real creează profilul,
apoi `user_module_access`; adrese `.invalid`, fără notificări); verifică nivelurile reale (`fn_red_nivel`). Fără contoarele globale de
numerotare (convocări / loturi / plicuri inserate pe căile de mentenanță pe care trigger-ele le permit). La ștergere: doar identificatorii
fixture-ului (plus jurnalele scrise de trigger-ele lor, cu imuabilitatea oprită DOAR în acea tranzacție), apoi verifică dispariția fiecăruia.
**Precondițiile (runda 4)**, verificate ÎNAINTEA oricărei scrieri, fiecare cu codul ei (fixture-ul NU acordă drepturi și NU creează trigger-e):
`FX001` — postgres are SELECT, INSERT și DELETE pe `auth.users` (fiecare verificat separat; scriptul iese cu **26**); `FX002` — sarea cheii
persoanei: un rând nevid în `red_plic_sare` se folosește neatins; tabelul gol (clona verificată prin `system_identifier`) primește o sare
SINTETICĂ marcată (`FIXTURE-FAN-SARE-SINTETICA-…`), ștearsă și verificată la final; altă formă sau o cheie a persoanei NULL = refuz (**27**);
`FX003` — trigger-ul REAL `on_auth_user_created → handle_new_user()` există, e activ (`session_replication_role = origin`) și a creat profilul
fiecărui cont; fără nicio plasă „INSERT în profiles” (**28**). **Pregătirea unei clone goale** (exemple, de un administrator al clonei, fără valori
de producție): `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'auth.users'::regclass;` → ca acel rol:
`GRANT SELECT, INSERT, DELETE ON auth.users TO postgres;`; `SELECT tgname, tgenabled, tgfoid::regprocedure FROM pg_trigger WHERE tgrelid =
'auth.users'::regclass AND NOT tgisinternal;` → `on_auth_user_created | O | handle_new_user()` (lipsă = restaurați schema `auth` cu trigger-ele
ei); sarea: nimic de făcut.

| Scenariu | Ce face | Rezultat așteptat |
|---|---|---|
| K1 | două rezervări (claim) pe aceleași 2 rânduri; A ține tranzacția 3 s, apoi COMMIT | B așteaptă ≥ 1 s (lock-ul lotului), apoi `E=P0001` cu motivul „nu mai sunt aprobate cu aceleasi date”; în BD 2 rânduri `in_curs` cu O SINGURĂ cheie |
| K2 | la fel, A face ROLLBACK | B așteaptă, apoi rezervă el (`E=00000`, o cheie) |
| S1 | în aceeași tranzacție: contactul unui deținător al plicului schimbat, apoi claim cu amprenta citită înainte; ROLLBACK | `E=P0001` „datele de contact / plicul s-au schimbat”, nimic rezervat, contactul neschimbat |
| S2a | A ține NECOMISĂ o schimbare de contact, apoi ROLLBACK; B rezervă | B NU așteaptă și rezervă; contactul neschimbat |
| S2b | A ține necomisă o schimbare de contact, apoi COMMIT (după verificarea lui B); B rezervă | B NU așteaptă și rezervă CORPUL APROBAT (verificat pe datele comise la claim); după COMMIT contactul e cel nou și amprenta surselor de acum DIFERĂ de cea rezervată — diferența apare la următoarea propunere. Asta e garanția declarată (§5): NU „datele actuale la COMMIT / la POST”. Contactul se restaurează |
| S2c | schimbarea de contact COMISĂ înaintea claim-ului (după citirea amprentei) | `E=P0001` „datele de contact …”, nimic rezervat; contactul restaurat |
| U1 | două scrieri de urmărire cu aceeași versiune citită; A ține 3 s | B așteaptă rândul, apoi `{"scrise": 0, "depasite": 1, "pastrate": 0}`; final: datele lui A, versiunea 1 |
| U2 | urmărire „fără evenimente” pe rândul cu C0 cunoscut (runda 3) | `{"scrise": 0, "pastrate": 1}`; C0 și ridicarea propusă rămân, versiunea 2 |
| M1 | A aprobă (prima aprobare a lotului), B schimbă marcajul TEST → real | B așteaptă lock-ul lotului, apoi `E=P0001` „lotul a fost aprobat o data …” |
| T1 | tirajul: A (owner) îl începe cu K1 (deschisă), B (editor) cere K2 (runda 3) | B așteaptă lock-ul lotului, apoi `E=RD020` „tirajul s-a schimbat”; rămâne K1, nr. 1 |
| T2 | (runda 4) tirajul K1 început; A (owner) OPREȘTE descărcările (deschisă 3 s, COMMIT), B (editor) = reverificarea FINALĂ a unei descărcări K1 | B așteaptă lock-ul lotului, apoi `E=RD021` „descarcarile … sunt oprite”, nimic livrat; final: K1, nr. 1, oprit de owner; un rând nou „tiraj_oprit” în `red_jurnal` |
| T2b | la fel, A face ROLLBACK | B așteaptă, apoi trece (`acelasi`, nr. 1); tirajul neoprit, jurnal neschimbat |
| T3a | (runda 5) tirajul K1 început; A (postgres) ține lock-ul lotului 3 s și notează ceasul chiar înaintea COMMIT-ului (`TA`); B (owner) oprește descărcările | B așteaptă (≥ 1 s), apoi oprește; momentul opririi ≥ `TA` și > începutul tranzacției lui B (forma 58abaa54 ar fi dat începutul lui B, înaintea lui `TA`); jurnalul are același moment („la”) |
| T3b | (runda 5) DURATA reală pe ceasul serverului, după T3a: înlocuirea cerută la oprire + 29 s, apoi la oprire + 31 s (pauzele calculate de server) | la + 29 s `E=RD022`, nimic schimbat; la + 31 s „inlocuit”, nr. 2, oprirea ștearsă, jurnal + 1. Durata: ~31 s |
| C1 | (runda 5) rândul P3 cu o contradicție pe ridicare (versiunea 2); A (owner) scrie un răspuns nou al urmăririi (deschisă 3 s, COMMIT); B (owner) soluționează cu versiunea 2 | B așteaptă lock-ul rândului, apoi `E=RD023` „urmarirea s-a schimbat”; final: versiunea 3, tot „de_verificat”, nicio soluționare în jurnal |
| C2 | (runda 5) invers: A soluționează (deschisă 3 s, COMMIT); B scrie un răspuns al urmăririi citit pe versiunea 3 | B așteaptă, apoi `{scrise 0, depasite 1}`; final: „ridicat”, versiunea 4, fără contradicție; un rând `urmarire_solutionata` în jurnal |
| R1 | roluri reale: editor ne-owner, viewer, anon, owner pe scriere directă | editor: claim / aprobare / urmărire `42501`; editor: propunerea legitimă EXECUTATĂ (rândul devine „propus”, `propus_de` = editor; anulată) și începerea tirajului OK; editor: înlocuirea tirajului `42501`; viewer: 0 rânduri (RLS), tirajul `42501`; anon: `42501`; UPDATE direct ca owner, instrucțiune proprie: `42501` |

Rulare (clonă fără date Redări): `PSQL=/c/Users/Public/pgsql/bin/psql.exe bash supabase/tests/20261212a_redari_fan_doua_sesiuni.sh --sistem <system_identifier clonă> --cu-fixture -- -h <host> -p <port> -U postgres -d postgres`
(sau, pe un lot existent al unui proiect `TEST-…`: `LOT=… OWNER=… EDITOR=… VIEWER=…` în mediu, fără `--cu-fixture`)
→ cod 0 (precondiție lipsă: 26 / 27 / 28, nimic scris). Evenimentele de tiraj scrise de probă în `red_jurnal` se șterg în curățenie (după
identificator și lot, cu imuabilitatea oprită DOAR în acea tranzacție) și se verifică dispariția: revenirea refuză cu istoric FAN în jurnal.

**Concurența la APLICARE (runda 4, L15 v2)** — profilul `fan` din `supabase/tests/l15_aplicare_concurenta.sh` (aditiv; uscare / meteo
neschimbate), cu 20261212a NEAPLICATĂ pe clonă; fiecare aplicare e proba cu ROLLBACK a generatorului de manifest (nimic comis):
`PSQL=<psql> bash supabase/tests/l15_aplicare_concurenta.sh --migrare fan --sistem <SIS clonă> --host <H> --port <P>
--user postgres --db postgres --manifest <dosar>/20261212a_redari_fan_awb.l15.tsv --amprenta-globala <GLOBAL al clonei>`

| Pas | Ce face | Rezultat așteptat |
|---|---|---|
| I | inventarul (doar citire) pe `red_proiecte`, `red_loturi_plicuire`, `red_plicuri`: trigger-e, constrângeri, politici | tipărit pentru revizuire |
| L0 | aplicarea fără concurență | cod 0, `IDENTIC`, „lock la … (1 incercari, Y ms …)” cu Y < 100 |
| L1 | H = o SCRIERE în curs pe `red_plicuri` (ROW EXCLUSIVE, 6 s) | cod 1, `BUGET_LOCK` la 900…1500 ms de la prima încercare, H încă activ la final (fără așteptare până la eliberare), nimic comis; observatorul doar-citire: lock parțial (SHARE ROW EXCLUSIVE pe `red_proiecte` / `red_loturi_plicuire`) în cel mult 2 eșantioane, proba activă în ≥ 10 |
| L1b | cât aplicarea AȘTEAPTĂ: un scriitor pe `red_proiecte` + `red_loturi_plicuire` (LOCK ROW EXCLUSIVE, `lock_timeout` 50 ms, anulat la fiecare eșantion) și citirea lui `red_plicuri`. Runda 5: un eșantion se NUMĂRĂ doar dacă, imediat înainte și imediat după el, observatorul vede aplicarea în pauza buclei de lock (`wait_event = PgSleep`, fără SHARE ROW EXCLUSIVE pe `red_plicuri`, H încă ține `red_plicuri`); bariera = prima observare | cel puțin 20 de eșantioane sincronizate; scriitorul blocat în cel mult 2 dintre ele; citirile reușite în toate. Nu dovedește momentele dintre verificări (câteva ms) și încercarea NOWAIT propriu-zisă (microsecunde; lock-urile parțiale se eliberează prin subtranzacție — garanție din construcție) |
| L2 | `red_plicuri` eliberat la ~400 ms după pasul „înainte” | cod 0, `IDENTIC`, k ≥ 2 încercări, Y < 1000 ms |
| F1 | cât aplicarea ȚINE setul (fără H): un cititor și un scriitor așteaptă (bariera din `pg_locks`) momentul în care proba ține SHARE ROW EXCLUSIVE pe `red_plicuri` | cititorul (cele trei tabele) termină în < 200 ms cu lock-ul încă ținut (citirile nu sunt oprite); scriitorul (LOCK `red_plicuri` ROW EXCLUSIVE) primește lock-ul abia după eliberare, în < 5500 ms (scrierile Redări așteaptă cel mult cât ține aplicarea, plafonul 5000); proba cod 0, `IDENTIC` |

Plus proba aplicare → revenire → re-aplicare prin runner (§7).

## 12. Ghidul operatorului: verificarea celor trei numere (protecția contra plicului greșit)

Un plic pus în alt plic decât cel cu eticheta lui trimite date personale altei persoane. De aceea etichetele și documentele lotului vin din
ACELAȘI manifest (aceeași mulțime, aceeași ordine, pozițiile 1…N) și sunt însoțite de **pagina de control** (poziție · nr. plic · AWB ·
destinatar mascat · nr. documente · bifă), descărcată odată cu etichetele (prima parte) și pusă prima în arhiva documentelor
(`0000_tiraj-<ID>_pagina_de_control.docx`) — ACEEAȘI pagină în ambele (runda 3). Toate foile unui tiraj poartă același identificator
(`<ID>`, 8 caractere): în titlul paginii de control și în numele fișierelor (etichete, pagina de control, arhiva și fiecare document din ea).
O foaie cu alt identificator NU se folosește; dacă ERP-ul refuză o descărcare cu „tirajul s-a schimbat”, owner-ul urmează „Tiraj nou”
(runda 4): 1. oprește descărcările; 2. după 30 de secunde se adună și se distrug TOATE foile tirajului început și se șterg fișierele lui
descărcate (inclusiv cele primite chiar după oprire); 3. înlocuiește tirajul; apoi se retipărește tot lotul. Cât descărcările sunt oprite, ERP-ul
refuză orice descărcare a tirajului („descărcările sunt OPRITE”), chiar și pe cele pornite înainte. La plicuire, pentru **fiecare** rând al paginii de control, cei doi colegi din PV verifică:

1. **Eticheta** de pe poziția N din PDF poartă numărul plicului de pe rând (câmpul de observații / referință al AWB-ului, ex. `PL-ABC-0007`).
2. **Prima pagină din plic** (teancul cu prefixul `000N_`) e **opisul** acelui plic („Opis - plicul PL-ABC-0007”).
3. **Opisul față de conținut**: numerele convocărilor din opis = convocările puse în plic (numărul de documente de pe rând = opis + convocări), și numele destinatarului din opis = numele de pe etichetă.

Toate trebuie să se potrivească; altfel plicul nu se închide și se reface. Plicurile „rămase” (fără AWB) nu au etichetă și nici documente în
arhivă: nu se plicuiesc în acest lot. Dacă eticheta nu tipărește numărul plicului (§8 deschisă 12), Testul 1 se OPREȘTE (§11) și verificarea
celor trei numere se reproiectează printr-un PR înainte de orice lot real; scrierea de mână a numărului pe plic NU e procedura (ar fi o derogare
decisă explicit de proprietar, în jurnalul testului).

### Decizii ale proprietarului (17.11.2026)

**(a) Numărul plicului apare și pe convocator — DECIS: un câmp mic în antetul convocatorului.** NU se implementează în această livrare: atinge
șabloanele DOCX ale convocatorului, modificate de altă ramură deschisă; e o **felie separată, după publicarea terminologiei**. Până atunci
opisul rămâne prima pagină din plic și poartă numărul (verificarea de la §12 rămâne cea de azi). Ce va trebui să aducă felia, pe lângă câmp:
- **momentul completării**: convocatorul se generează ÎNAINTE de plic, deci numărul cere fie regenerarea convocatorului după punerea în plic
  (același număr de document), fie generarea lui la plicuire — de ales în felia ei, cu verificarea juridică a antetului;
- **verificarea de versiune a documentelor față de tiraj**: cheia tirajului de azi acoperă DOAR manifestul (poziție, plic, AWB), nu conținutul
  documentelor; cu numărul plicului pe convocator, o regenerare după tipărire schimbă documentul fără să schimbe manifestul. Felia va cere:
  (1) **amprenta documentelor în tiraj** — sha256 pe conținutul fiecărui DOCX din arhivă (opis + convocatoare, în ordinea arhivei), fixată
  la prima descărcare a arhivei lângă cheia manifestului (versiune nouă a cheii, `VERSIUNE_TIRAJ` v2); o arhivă cerută ulterior cu alt
  conținut = refuz „tirajul s-a schimbat” și „Tiraj nou”, ca la manifest; (2) la construirea arhivei, numărul plicului din convocator =
  plicul din manifest pe care îl însoțește (altfel lipsă, nimic descărcat); (3) pe pagina de control, o a patra bifă: numărul de pe convocator =
  rândul. Etichetele nu sunt atinse (nu conțin documente).

**(b) Documentele unui lot se descarcă într-o ARHIVĂ (ZIP) — DECIS** (nu un PDF unic). Ce conține azi arhiva unui lot FAN cu tirajul `<ID>`
(pe un lot de TEST toate numele încep cu `TEST_`), în ordinea în care se sortează:
- `0000_tiraj-<ID>_pagina_de_control.docx` — primul fișier;
- pentru fiecare plic din manifest, în ordinea pozițiilor (`PPPP` = poziția pe 4 cifre): întâi **opisul** — `PPPP_<nr_plic>_000_opis_T<ID>.docx`
  (exemplarul de la dosar, descărcat exact cum e arhivat) —, apoi **fiecare convocator** al plicului, câte un fișier:
  `PPPP_<nr_plic>_NNN_<nr_document>_T<ID>.docx`, cu `NNN` = 001, 002, … în ordinea convocărilor (numărul convocării, apoi numărul documentului).
- Fișierele unui plic sunt **separate** (opisul + fiecare convocator), **grupate și ordonate prin prefixul plicului** (`PPPP_<nr_plic>_`): un plic
  cu două convocări = trei fișiere DOCX. Sortarea alfabetică = ordinea de tipărire. Plicurile „rămase” (fără AWB) nu au fișiere. Pe un lot de
  Poștă (fără FAN): aceleași nume, fără `tiraj-<ID>` / `_T<ID>`, iar pagina de control are data zilei.
- **Un singur document pe plic NU se poate face simplu și sigur cu ce există în repo** (de aceea nicio propunere de implementare aici):
  (1) opisul și convocatoarele din arhivă sunt EXEMPLARELE de la dosar (exemplarul din plic = cel arhivat, fără regenerare); unirea lor ar
  produce un document nou, care nu mai e exemplarul arhivat; (2) sunt DOCX: lipirea în browser (jszip, cum lucrează `src/redari/docx.js`) cere
  contopirea stilurilor, numerotărilor, relațiilor, imaginilor (codul QR al convocatorului), antetelor și subsolurilor pe secțiuni — fragilă și
  fără o verificare automată că rezultatul arată ca originalele; (3) un PDF pe plic cere conversia DOCX → PDF, care nu se poate face în browser
  cu dependențele de azi (pdf-lib nu merge pe Vercel), ci doar cu o unealtă nouă pe server (ex. LibreOffice fără interfață + o coadă), cu fișa
  a–e și acordul pentru o automatizare nouă. Dacă se va cere totuși un fișier pe plic, varianta (3) e singura sigură, ca felie separată, cu
  PDF-ul păstrat lângă exemplarele arhivate și amprenta lui în tiraj.
