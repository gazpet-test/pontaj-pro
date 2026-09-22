# Modulul Administratorului — V1

## Scop și integrare

Panou de citire la `/administrator`: alerte, filtre pe prioritate/sursă, explicația regulii,
referința înregistrării, ultima evaluare și aprobările existente. Încărcare la intrare și
reîmprospătare manuală. Nu rulează AI, nu scrie notificări, nu aprobă și nu închide probleme.

Implementarea pornește de la `main` 224d14b și include ulterior 0d85f64 (worker Ofertare).
Fișiere existente modificate: numai `src/App.jsx` (import, wrapper, meniu, card, rută).
`HomeScada` primește cardul prin lista existentă, fără schimbarea componentei.

## Acces — nu s-au acordat drepturi

- Ruta folosește `ProtectedRoute requireModule="admin_alerte"` prin constanta comună.
- Noua cheie cere intrarea **exactă și explicită**, inclusiv pentru owner. `adminOnly`,
  `can_modify_employees`, rolul și subcheile `admin_alerte.*` nu deschid acest panou.
- La fiecare încărcare se verifică utilizatorul autentificat și se recitesc drepturile/profilul.
- Accesul transversal nu acordă acces la surse: pentru fiecare se verifică separat modulul
  existent; pentru Documente firmă se acceptă și `administrativ.documente`. Owner păstrează
  accesul existent la surse, dar are nevoie de cheia explicită pentru panoul nou.
- Nicio scriere în `user_module_access`; nu sunt incluse granturi SQL sau modificări RLS.
  Răzvan aprobă nominal acordarea înainte de orice intervenție asupra drepturilor.
- `main` încă are DELETE + INSERT în editorul existent de drepturi din App.jsx. Acest PR
  nu îl folosește și nu îl modifică. PR #119 din acest repository privește `profile` din
  Ofertare, nu acel bug de drepturi. Referința corectă trebuie clarificată înaintea acordării.

### Limită de securitate existentă, de revizuit înainte de activare

Inspecția read-only a `pg_policies` arată SELECT permis tuturor utilizatorilor autentificați
pe mai multe surse (inclusiv contracte/GBE). Noua cheie protejează fluxul aplicației,
**nu este o nouă barieră server-side pentru acele tabele deja expuse**. Vederile folosite
`v_hr_autorizatii_status` și `v_gbe_per_contract` au `security_invoker=on`.
O întărire RLS ar afecta modulele existente și necesită analiză/confirmare separată; nu se
schimbă implicit prin acest PR. Nu folosi panoul ca dovadă că protecția server-side a fost rezolvată.

## Surse și reguli V1

| Sursă | Date și reguli |
|---|---|
| Ofertare | `ofertare_licitatii`: stări identificata/analiza/go/in_lucru. Termen apropiat (7 zile), lipsă responsabil/termen. GO/în lucru + termen depășit sau termen ≤3 zile fără responsabil = critic. O singură alertă per licitație. |
| HR | `v_hr_autorizatii_status`: autorizații actuale și vize RSVTI. Expirat = critic, 0–7 zile = apropiat, 8–30 = de urmărit, lipsă dată = date lipsă. Viza este distinctă de valabilitatea autorizației. |
| Flotă | `logistica_documente`, `logistica_active`, `logistica_tipuri_documente`: aceleași praguri; exclude active vândute, deep-sleep și documente ale altor entități. |
| Documente firmă | `documente_firma`: doar active; exclude fără expirare și certificate `se_reemite`, care se obțin la depunere. |
| GBE | Soldurile din `v_gbe_per_contract`, fără recalculare. Urmărește estimarea de recuperare, valabilitatea contului și polițele active. Include polițe fără sold de reținere. Estimarea depășită nu dovedește exigibilitate. |
| Comenzi | Aceeași asociere din `DeAprobatButton`: aprobarea utilizatorului este în așteptare și comanda în aprobare. |
| Transport | Aceiași pași ca în `DeAprobatButton`: Mitrache/owner → submitata; Pușcașu/owner → aprobata_mitrache. Decizia rămâne în fluxul original. |

Pragurile sunt regulile panoului V1, nu rescrieri ale alertelor existente. Termenele calendaristice
sunt comparate în Europe/Bucharest; pentru depunere se verifică și ora exactă.
Nu se atribuie automat persoanelor responsabilitatea rezolvării; când nu există legătura în sursă,
se afișează „Responsabil de confirmat”. Nu se deduce impactul între module.

## Erori și completitudine

Sursele sunt independente. O eroare, accesul refuzat sau o citire incompletă nu produc o stare
verde. Contoarele includ numai sursele evaluate și rămân globale când se filtrează lista.
Citire paginată stabil pe ID, 500 rânduri/pagină, count exact; schimbarea count-ului sau depășirea
a 20.000 rânduri oprește evaluarea acelei surse. Timeout 30 secunde, cereri anulate la ieșire,
rezultatele vechi nu sunt afișate după schimbarea utilizatorului sau reîncărcare.

„Evaluată” confirmă citirea datelor vizibile, nu completitudinea evidenței de business.
Un răspuns gol filtrat de RLS nu poate dovedi că firma nu are probleme. Dispariția unei alerte
nu este salvată ca rezolvare. Nu există istoric, snooze sau atribuire în V1.

## Navigare și limite

Comanda furnizor se deschide prin deep-link-ul existent `/achizitii?id=…`.
Flota, GBE și transporturile deschid tab-urile existente. HR, documentele firmei și licitațiile
deschid modulul; referința/ID-ul este afișat pentru identificare. Nu se inventează parametri URL
pe care modulele actuale nu îi interpretează, și nu se modifică fișierele la care lucrează Maestru.
Deschiderea directă a fiecărei fișe rămâne o îmbunătățire coordonată ulterior.

Nu sunt integrate Execuție, Pontaj, Salarii, Magazie, CTC, acoperirea cerințelor sau indicatori AI.
Nu s-au adăugat biblioteci, tabele, RPC-uri, cronuri sau Edge Functions.

## Verificare și livrare

- 21 teste dedicate: acces, zero query fără drept, date calendaristice, excluderi, RSVTI,
  GBE estimat, polițe, pași de aprobare, paginare și erori.
- `TZ=UTC npm test`: 340/340 trecute inclusiv după actualizarea la 0d85f64. Două teste Service preexistente folosesc
  data locală convertită la ISO și eșuează în Europe/Bucharest; fișierele Service nu sunt modificate.
- `npm run build`: trecut, cu avertismentele existente despre bundle și importuri mixte.
- CI dedicat pe PR: toate testele în UTC și build, fără secrete sau deploy explicit.
- Toate cele 11 proiecții noi (inclusiv relațiile comenzilor) au fost acceptate prin
  PostgREST real: HEAD / select / count exact, HTTP 200, rol anonim, 0 rânduri vizibile.
  Aceasta validează forma API, NU rezultatele sau drepturile contului autentificat al lui Răzvan.
- Componenta React reală a fost verificată în Chromium cu date fictive și client izolat:
  desktop 1280 px, mobil 360 px fără overflow, filtre, detalii, refresh, link comandă,
  sursă cu eroare (6/7 evaluate), lipsă acces (zero query-uri); fără erori JavaScript.
  Testul autentificat pe date reale și navigarea până la fișa finală se fac la review,
  după acordarea nominală a dreptului, nu prin crearea unor conturi sau sesiuni noi aici.
- Un singur PR, fără merge automat. Răzvan îl verifică înainte de integrare.
- După merge aprobat: re-upload `App.jsx` în Project Knowledge și fișierele noi relevante.

Rollback: revert al PR-ului; nu există migrare sau date de restaurat. Eventualele drepturi
acordate ulterior sunt o operație separată, nominal aprobată.
