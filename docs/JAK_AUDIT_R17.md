# JAK — Audit Ofertare R17: lanțul probator al unei cerințe, într-un singur loc (doar UI)

Ramura: `jak/audit-r17` din `origin/claude/erp-continuare-x4p5a7`. Fără push, fără producție, fără migrări, fără SQL nou.
Raport: `docs/JAK_AUDIT_R17_raport.md` (ce ai schimbat, teste, limite).

## Problema (auditul Copilot, R17)
Omul vede cerința și o bifă, dar ca să afle ce o susține reconstruiește mental traseul din 5 locuri:
acoperirea (ofertare_acoperire: status, verificat_pe_scan, reverificare_ceruta, valabil_la_depunere, candidatul ales),
dovezile PT (`ofertare_pt_dovezi` — azi PT nici nu le încarcă pentru inspectare), legăturile cu capitolele
(`ofertare_pt_legaturi`: stare, verificat_la_versiunea, constatare, locator_raspuns), clarificările care o ating,
versiunile cerinței (inlocuita_de / versiune / raspuns_set_id / acoperire_snapshot) și fișierul final din pachet.

## Cerința
În `src/OfertarePropunere.jsx`, la selecția unei cerințe din `MatriceCerinte` (există deja `sel`/`setSel`), un panou
„🔗 Lanțul dovezii” (componentă nouă, ex. `LantProbator`, în fișier nou `src/OfertareLantProbator.jsx`) care arată, în ordine:
1. **Cerința**: textul, sursa (document, pagină, pasaj, `pasaj_verificat`), versiunea; dacă e o versiune nouă — link/rezumat către cea veche (`inlocuita_de` invers) și setul de răspuns care a schimbat-o.
2. **Acoperirea**: fiecare rând — mod, candidat (autorizație / doc firmă / partener / experiență / recomandare / studii), `status`, **verificat pe scan (da/nu, de cine, când)**, `reverificare_ceruta` + motiv, valabil la depunere. Marchează vizibil diferența „propusă de AI” vs „verificată de om” (aceeași regulă ca R06: dovadă = verificat_pe_scan && !reverificare_ceruta).
3. **Dovezile PT** (`ofertare_pt_dovezi` pentru cerință) — citite, nu doar inserate.
4. **Legăturile cu capitole**: capitol, stare, `verificat_la_versiunea` vs versiunea curentă a capitolului (verificat pe versiune veche = semnal), `constatare`, `locator_raspuns`. O legătură `blocata` apare prima, roșu.
5. **Clarificări** care o ating: din `ofertare_clarificari` unde textul/`cantitate_id` o leagă (dacă nu există relație directă, caută după `cerinta_id` dacă apare în câmpurile existente; nu inventa relații — scrie „nicio legătură înregistrată”).
6. **Fișierul final**: dacă ultimul pachet (`ofertare_pt_pachet` + `_fisiere`) conține capitolul legat — nume, sha256 scurt, versiunea sursei.
Lipsa unei verigi se afișează explicit („— lipsă”), nu se ascunde.

Datele se citesc cu `supabase.from(...)` pe tabelele de mai sus (RLS existent); verifică ÎNTÂI numele reale ale coloanelor în `supabase/migrations` / codul existent, nu presupune.
Stil: inline styles cu `G`/`S` ca în fișier. Fără librării noi.

## Teste
- Extrage logica de compunere a lanțului într-o funcție pură (ex. `compuneLant({cerinta, acoperiri, dovezi, legaturi, capitole, clarificari, pachet})`) în `src/ofertareLantProbator.js` și testeaz-o în `src/ofertareLantProbator.test.js`: acoperire propusă ≠ verificată; legătura blocată prima; verificat pe versiune veche semnalat; verigă lipsă = „lipsă” explicit.
- `npx vitest run` + `npx vite build` (dacă mediul Windows le blochează, notează în raport — Claude le rulează).
