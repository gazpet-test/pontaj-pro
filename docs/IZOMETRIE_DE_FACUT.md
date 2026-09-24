# Izometrie — modificări de făcut (backlog, 24.09.2026)

Stare: **amânat** — Răzvan, 24.09: „facem când avem o pauză, acum continuăm cu ofertarea”.
Surse: audit agent 24.09 (read-only) + review Copilot 24.09. Copie în `claude_context` (todo „Izometrie: trasabilitate…” + decision „Izometrie: recomandarea Copilot”).
Regulă: pașii care schimbă schema BD cer acordul lui Răzvan înainte (CLAUDE.md pct. 6).

## Situația azi
- Acoperit: țeavă, serie unică, șarjă (text), sudură (cod text pe rândul țevii), km cumulat, PM/PA-UT/UT (text), flux pachet draft → trimis → aprobat (PDF), export Excel Transgaz (CENTRALIZATOR + IZOMETRIE).
- Date: 27 proiecte, 12 tronsoane, 7 pachete, 386 rânduri `executie_tevi` (10 fără serie, 11 fără șarjă; 0 duplicate) → puține date, momentul bun pentru schimbarea schemei.
- Fișiere: `src/Izometrie.jsx`, `src/ImportExcelIzometrie.jsx`, `src/exportCentralizatorXlsx.js`, `src/transgazTemplate.js`, `src/Executie.jsx`.

## Lipsește pentru recepția Transgaz
- Sudor + poanson + autorizație pe sudură (există `hr_autorizatii`, `v_sudori_pentru_oferte`).
- WPS / WPQR pe proiect.
- CND structurat (metodă RT/UT/VT/PA-UT/TOFD, rezultat admis/respins, laborator, buletin).
- Certificat 3.1 ↔ șarjă (există `comenzi_furnizor_documente`).
- Izolație/manșoane + holiday test; jurnal de sudură; carte tehnică.
- Legare cu `executie_probe_presiune` și `executie_faze_determinante` (există, dar separate).

## Corecții înainte de exportul consolidat (Copilot)
- [ ] Sudura = obiect separat, ID stabil; o sudură între 2 pachete există o singură dată.
- [ ] `km_calculat` separat de `km_masurat` (topo, reper, sens, sursă).
- [ ] Upload PDF ≠ aprobare: aprobarea = versiune pachet + document + verificator + dată.
- [ ] Ștergerea ultimului PDF NU readuce pachetul la draft → „dovadă indisponibilă / reverificare”.
- [ ] Import Excel REPLACE atomic (preview/staging + aplicare tranzacțională), nu loturi de 50.
- [ ] Drepturi pe proiect în backend; modificarea unui pachet aprobat → revizie, nu schimbare tăcută.
- [ ] Stare fizică (lansat) separată de starea documentară.
- [ ] RLS: SELECT `USING(true)` → funcție de acces (acum doar `authenticated`, nu anon — nu e scurgere publică).

## Model minim de date (Copilot)
- `executie_tevi` extins: segment_parinte_id, material_origine_id, tip_element, diametru, grosime, marca, km_calculat_start/end, km_masurat_start/end, sursa_topo_id.
- Material de origine/șarjă: țeavă tăiată → segmente; bilanț `origine = segmente + resturi + pierderi`.
- `executie_suduri`: cod_original, cod_normalizat, element_a/capat_a, element_b/capat_b, tip_imbinare, este_legatura_sant, stare.
- `executie_suduri_operatii`: inițială/reparație/refacere, operatie_anterioara_id, data, wps_versiune_id, motiv.
- `executie_suduri_participanti`: operatie, employee, ștampilă, autorizatie_id, rol (mai mulți sudori).
- `executie_controale` (+ legături): metodă, data, executant, procedură, criteriu din sursă, rezultat, buletin_document_id.
- Documente probatorii cu sha256 + verificat_de/la; versiuni/aprobări pachet cu manifest + hash.

## Ordinea de implementare
1. **2A — identitate și integritate**: suduri separate, conexiuni între pachete, revizii/aprobări, import atomic, drepturi backend.
   Test: sudura comună apare pe 2 foi dar o singură dată în evidență; REPLACE eșuat nu alterează pachetul.
2. **2B — trasabilitate**: materiale/segmente/certificate 3.1, sudori/WPS, operații de reparație.
   Test: din sudură ajungi la ambele materiale, certificate, sudori și WPS.
3. **2C — controale**: CND, recontrol, izolații. Test: control respins rămâne în istoric.
4. **3 — vedere consolidată (4 nivele: proiect → tronson → pachet → sudură) + export din snapshot** (verifică XLSX: foi, ordine, zerouri inițiale, formule).
5. Rapid, oricând: panou „gata de recepție” pe pachet (view `security_invoker`: suduri fără sudor/CND/certificat).

## Pilot de acceptare (Copilot)
Două pachete vecine cu: o țeavă tăiată în 2 segmente, o curbă, o sudură de legătură în șanț, o sudură reparată.
Trece dacă: materialul se urmărește până la certificat, sudura comună nu se dublează, reparația nu șterge controlul inițial, modificarea unui pachet aprobat cere reverificare fără a rescrie istoricul.

## Reguli
- Nu fixa procente CND / criterii de acceptare în cod fără sursă (contract, PCC, șablon Transgaz).
- Pontajul nu dovedește cine a sudat — sudorul se consemnează distinct.
