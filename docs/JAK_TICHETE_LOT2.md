# JAK_TICHETE_LOT2 — 5 tichete de la colegi (Achiziții, Logistică-Service, Administrativ)

Citește întâi `AGENTS.md` („Când scrii cod"). Fiecare punct e un tichet real; textul colegului e citat.
Reguli: stil existent (inline styles, `G`/`S`, comentarii în română, marchează `// TKT-2026-XXXX`),
fără librării noi (`xlsx-js-style` e deja instalat — vezi cum e importat în `ServiceTab.jsx`), fără TypeScript.
**NU rulezi git, NU aplici migrări, NU deployezi, NU atingi alte fișiere decât cele numite aici.**
Migrările le scrii ca fișiere în `supabase/migrations/` (prefix `20260928j_`) + un `_ROLLBACK.sql` pereche;
le aplic eu după review și după acordul lui Răzvan.
Rulează `npx vite build` la final (trebuie să treacă). Raport în `docs/JAK_TICHETE_LOT2_raport.md`:
ce ai schimbat per tichet (fișier + funcții), ce n-ai putut face și de ce, ce trebuie testat de om.

Schema de mai jos e verificată azi în BD (information_schema) — folosește exact aceste coloane.

---

## A. Achiziții — `src/Achizitii.jsx`

`comenzi_furnizor`: id, numar_comanda, comanda_id, proiect_id, furnizor_contract_id, furnizor_id, persoana_contact,
telefon_contact, livrare_tip ('sediu'|'santier'), livrare_site_id, moneda, status, data_emitere, emisa_de, emisa_la,
pdf_comanda_path, receptie_mp_profile, receptie_mp_la, receptie_achizitii_profile, receptie_achizitii_la, pv_receptie_path,
predare_achizitii_profile, predare_achizitii_la, primire_magazioner_profile, primire_magazioner_la, pv_predare_path,
poza_depozitare_path, observatii, created_at, updated_at, fara_formular, data_livrare_estimata, packing_list_path, este_servicii.
CHECK status: draft, in_aprobare, emisa, in_tranzit, ajunsa, receptionata, in_stoc, **anulata**, respinsa (anulata există deja).
Trigger `trg_cf_sync_cereri` (AFTER UPDATE OF status) recalculează cererea internă legată; comenzile `anulata`
sunt excluse din acoperire, deci anularea readuce automat cererea la „în lucru". Nu-l ocoli, nu-l dubla din UI.

`comenzi_furnizor_linii`: id, comanda_furnizor_id, comanda_linie_id, denumire, um, cantitate, pret_unitar,
termen_livrare, observatii, display_order, created_at, cantitate_primita.

### A1. TKT-2026-0291 — „La modul de achiziție să existe buton de delete și modificare comandă emisă"
Azi (bara „Acțiuni flux", ~linia 1310): „⛔ Anulează" există DOAR pentru `draft` și `in_aprobare` (`actions.anuleaza`);
„🗑 Șterge definitiv" doar pentru owner; după emitere se pot modifica doar repere/termene.
- **Anulare comandă emisă**: arată „⛔ Anulează comanda" și pentru `emisa`, `in_tranzit`, `ajunsa`, DOAR dacă
  `receptie_mp_la` și `receptie_achizitii_la` sunt goale (nimic recepționat) și `ctx.canCreate`. Modal cu **motiv
  obligatoriu** (min. 5 caractere). La confirmare: `status='anulata'` + motivul adăugat în `observatii` cu prefixul
  `[ANULATĂ dd.mm.yyyy de <nume profil>: <motiv>]` (păstrează observațiile vechi dedesubt). Comanda rămâne în Arhivă (e deja
  în `ARHIVA_ST`). Nu șterge fizic nimic, nu șterge PDF-ul emis.
- **Modificare comandă emisă (antet)**: buton „✏️ Modifică datele comenzii" pentru `emisa`/`in_tranzit`/`ajunsa`, aceleași
  condiții. Editabile: persoana_contact, telefon_contact, livrare_tip + livrare_site_id (site doar dacă `santier`),
  data_livrare_estimata, observatii. NU se schimbă numărul, furnizorul, proiectul, moneda, liniile (liniile au deja
  „✏️ Modifică repere"). Salvare cu `update(...).eq('id', c.id)`, toast, `loadAll()`.
- Refolosește componentele/stilurile existente din fișier (vezi editorul de termene `editTermene` ca model).

### A2. TKT-2026-0199 — „comenzi cu mai multe repere… import fișier Excel… o comandă cu 20 repere cu specificații, cantități și prețuri poate dura mai mult de 30 minute"
În formularul de creare/editare comandă (unde se adaugă liniile — caută starea formularului cu liniile și butonul de
adăugare reper): buton „📥 Import repere din Excel".
- Acceptă .xlsx / .xls / .csv; citește prima foaie cu `XLSX.read` + `sheet_to_json({header:1})`.
- Detectează rândul de cap de tabel (primele 10 rânduri) după denumiri, insensibil la diacritice/majuscule/spații:
  denumire ← denumire|articol|produs|material|descriere; um ← um|u.m.|unitate; cantitate ← cantitate|cant|buc|qty;
  pret_unitar ← pret|preț unitar|pu|pret/um; observatii ← observatii|specificatii|detalii. Fără cap recunoscut → eroare clară.
- Numere: acceptă `1.234,56`, `1234,56`, `1234.56`, numere native Excel.
- **Previzualizare** în modal: tabel cu rândurile citite; invalide (fără denumire, cantitate lipsă/≤0/necifrică) marcate roșu
  și excluse. Buton „Adaugă N repere" le ADAUGĂ la liniile existente din formular (nu scrie în BD) — omul corectează și
  salvează normal. Maxim 300 de rânduri.
- Buton „⬇ Șablon Excel" care descarcă un .xlsx cu capul: Denumire | UM | Cantitate | Preț unitar | Observații.

## B. Logistică → Service — `src/ServiceTab.jsx` (DOAR `NewFisaModal` și `GrupAccordion`)

### B1. TKT-2026-0074 — „Pentru mentenanță vreau să rămână default filtrele și uleiul așa cum sunt ele scrise în BD; eu doar completez nr. bucăți și seria dacă se schimbă de la un service la altul; adaug manual doar extra piese schimbate"
Azi `NewFisaModal` (~linia 427) arată itemii preset (`logistica_service_itemi_preset`, grupa „1. Mentenanță Periodică" are
filtrele și uleiurile) NEBIFAȚI; `smartFillMap` (din `logistica_service_intrari` al activului) doar SUGEREAZĂ codul piesei.
„Seria" din tichet = codul piesei (`cod_piesa`).
- Când e ales activul și `tip === 'mentenanta'`: **bifează automat** itemii preset din grupa „1. Mentenanță Periodică" care
  apar în istoricul ACELUI activ (potrivire pe `norm(denumire)`, cum face deja `smartFillMap`), precompletați cu `cod_piesa`
  și `cantitate` din cea mai recentă intrare a activului (fallback `cantitate_default`). Extinde query-ul existent să aducă
  și `cantitate` (tabelul are coloanele: activ_id, denumire, cod_piesa, cantitate, data, fisa_id…).
- Grupa respectivă se deschide automat (`expanded`) ca omul să vadă ce e bifat; mesaj mic „↳ N piese precompletate din
  ultima mentenanță — verifică doar cantitatea și codul". Omul poate debifa, modifica, adăuga extra (fluxul existent).
- Schimbarea activului sau a tipului resetează bifele automate (nu amesteca activul vechi cu cel nou); bifele făcute manual
  de om pentru același activ nu se pierd la re-randare.
- Activ fără istoric → comportamentul de azi (nimic bifat).

## C. Administrativ → Contracte terți — `src/ContracteTertiTab.jsx`

`contracte_terti` (coloane relevante): id, numar_contract, denumire, valoare_lei, valoare_eur, valoare_actuala_lei, categorie,
sens ('incasare'|'plata'), tip_contract, status, partener_text, beneficiar_id, data_semnare, data_termen, observatii…
CHECK `contracte_terti_tip_contract_check`: asociere, subcontractare, prestari_servicii, furnizare_materiale.

### C1. TKT-2026-0077 — „trebuie adăugată opțiune de adăugat Contract de comodat"
- Migrare `20260928j_contracte_comodat.sql`: DROP + ADD CONSTRAINT `contracte_terti_tip_contract_check` cu `comodat` adăugat
  (păstrează valorile existente); rollback-ul o readuce la lista veche (și eșuează explicit dacă există deja rânduri comodat —
  scrie un `DO $$ ... RAISE EXCEPTION` de verificare).
- UI: „Comodat" în selectul de tip/categorie, filtre, etichete/badge-uri (caută toate locurile unde apar `furnizare_materiale`
  și `prestari_servicii` — ex. liniile ~1117 și ~1323). La comodat valoarea contractului e opțională (poate fi 0/gol).

### C2. TKT-2026-0215 — „la + contract nou să existe posibilitate să introducem tarif / serviciu ca alternativă la valoarea contractului"
- Migrare `20260928j_contracte_tarif.sql`: coloane noi opționale `tarif_valoare numeric`, `tarif_unitate text`
  (CHECK în: 'luna','ora','zi','buc','km','mc','ml','mp','alt'), `tarif_moneda text DEFAULT 'RON'` (CHECK 'RON','EUR'),
  `tarif_descriere text`. Rollback = DROP COLUMN.
- Formular: comutator „Valoare totală" / „Tarif (preț pe unitate)". Pe „Tarif": valoare + unitate + monedă + descriere scurtă
  (ex. „abonament mentenanță"). Validare: cel puțin una dintre valoare totală și tarif.
- Listă/detaliu: dacă nu există valoare totală dar există tarif → afișează „500 lei / lună" (în funcția de formatare a valorii
  folosită în listă). Nu schimba calculele existente care folosesc `valoare_lei`.

---
Ordine: A1 → A2 → C1 → C2 → B1. Dacă un punct te blochează, notează în raport și treci la următorul.
