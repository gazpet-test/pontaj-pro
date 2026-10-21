# E3 — designul intrării API de confirmare (`fn_izo_doc_confirma`) — pentru review ÎNAINTE de cod

Decizia Razvan 21.10.2026: Q-E3-2 = A. Janeta confirmă recepția din UI, printr-o intrare API nouă, cu rolul verificat în corp. Designul trece prin review Copilot + Jakarinos înainte de cod. Context: `docs/izometrie/E3_PLAN.md`, registrul E2a (`20261102a`) și suprafața lui privilegiată (`docs/izometrie/E2A_SUPRAFATA_PRIVILEGIATA.md`, `E2A_INVENTAR_CITIRI.md`). Răspunsurile la celelalte întrebări:
- Q-E3-1: tabelele noi au prefixul `izo_*`.
- Q-E3-3: neconformitatea dă carantină (bucată nedisponibilă), nu doar refuz.
- Q-E3-4: toleranțele sunt ±10 mm la lungime și ±0,5° la unghi; peste ele, doar avertisment.
- Q-E3-5: `lungime_mm` = lungimea măsurată, dacă există, altfel cea de pe document.
- Q-E3-6: la curbă, serie = bend number, șarjă = heat, codul complet în `atribute`.

## 1. Ce se schimbă față de E2a (lărgirea suprafeței)

În E2a, registrul se scrie DOAR din sesiuni `postgres` directe (N3: `session_user = postgres` în cele 4 intrări writer), adică doar din sesiunea de chat.

E3 adaugă **două intrări apelabile din API**, ambele SECURITY DEFINER, cu owner-ul `izo_registru_writer`, deci în aceeași frontieră ca restul registrului:

| Funcție | Ce face | Cine |
|---|---|---|
| `fn_izo_doc_confirma(p_doc_id bigint, p_versiune timestamptz, p_hash_doc text)` | documentul de intrare `draft` → `confirmat`; creează bucățile (`sosit` / `carantina`) și evenimentul `intrare_aviz` | gestionarul proiectului + depozitului documentului, sau owner-ul |
| `fn_izo_doc_pv(p_doc_id bigint, p_versiune timestamptz, p_pv_nr text, p_pv_data date)` | pune PV-ul pe un document confirmat; bucățile `sosit` ale documentului → `receptionat` | aceiași |

**Totul în rest rămâne exclusiv `postgres`** (N3, neschimbat):
- activarea / dezactivarea nivelului (`fn_izo_seteaza_nivel`, `fn_izo_activeaza_si_importa`);
- importul soldului (`fn_izo_import_sold_initial`) și storno-ul (`fn_izo_import_storno`);
- atribuirile (`izo_atribuiri`, scrise doar de postgres);
- anularea unui document confirmat (storno pe evenimentul lui);
- orice corecție pe o bucată existentă.

**Draftul** (antetul + rândurile documentului) NU e registru. Se scrie prin `fn_izo_doc_salveaza` (DEFINER, owner `postgres`, CAS pe `updated_at`, ca la bonul RPC). Fără DML direct din API pe tabelele draftului: REVOKE pentru anon / authenticated / service_role. Verificarea rolului e aceeași ca la confirmare. Draftul nu atinge `magazie_bucati`.

## 2. Cine poate apela și cum se verifică (în corp, la fiecare apel)

1. `auth.uid() IS NOT NULL` → altfel 42501.
2. Documentul se citește `FOR UPDATE`. De pe document se iau `proiect_id` și `depozit_id`, nu din argumente (nu există argumente de proiect / depozit).
3. **Rolul:**
   - `EXISTS izo_atribuiri(proiect_id = doc.proiect_id, profile_id = auth.uid(), rol = 'gestionar', depozit_id = doc.depozit_id, activ)`, SAU `profiles.is_owner` pentru `auth.uid()`;
   - altfel: 42501 „doar gestionarul depozitului documentului”.
   - Atribuirea fără depozit (gestionar pe tot proiectul) e acceptată doar dacă design-ul E2a o permite deja pentru gestionar (de confirmat la review). Propunerea mea: o cer explicit pe depozit.
4. **Proiectul:** `fn_izo_nivel(doc.proiect_id) = 'stoc'` (sau mai sus), altfel refuz. Un proiect `off` nu are registru.
5. **Depozitul:** `doc.depozit_id` aparține site-ului proiectului (aceeași verificare ca la import).
6. **Sesiunea:** **nu** se cere `session_user = postgres` (excepția de la N3, motivul acestui review). Se cere în schimb:
   - `session_user IN ('authenticator', 'postgres')`, adică o cerere PostgREST sau administrarea;
   - `current_setting('request.jwt.claims', true)` cu `sub = auth.uid()`;
   - apelul să NU vină dintr-un wrapper. Poarta de wrapper-e din `fn_izo_porti_lipsa` se extinde la `fn_izo_doc_confirma` / `fn_izo_doc_pv`: orice funcție din afara registrului care le numește → activarea e refuzată, iar porțile cad pe proiectele active.
   - Limită asumată: un DEFINER `postgres` creat prin DDL le-ar putea chema; aceeași limită ca la E2a (controlul e procesul de migrare).

## 3. Cum se combină cu garda E2a

- **Owner `izo_registru_writer`, prima instrucțiune pune marcajul** `izo.registru_tx`, ca la intrările writer. Garda (`trg_magbuc_izo_garda`, `fn_izo_garda_scriitor`) acceptă scrierea doar cu `current_user = writer` + marcaj, deci nimic nu ocolește garda: ea vede o scriere a registrului ca oricare alta.
- **Ordinea lock-urilor** e cea din E2a: rândul documentului (FOR UPDATE) → tabelele (`fn_izo_blocheaza_tabele`, ACCESS SHARE) → advisory 73010 pe proiect (`fn_izo_lock_proiect(proiect, false)`, partajat, ca la recepție). Fără blocaj circular cu activarea (care ia exclusiv) sau cu storno-ul. Testele de cursă cu barieră sunt la §8.
- **Allowlist-ul ACL** (poarta „EXECUTE pe funcțiile registrului doar pentru writer / postgres”) primește o excepție nominală: `authenticated` are EXECUTE DOAR pe `fn_izo_doc_confirma(bigint, timestamptz, text)` și `fn_izo_doc_pv(bigint, timestamptz, text, date)`. Pe semnătura exactă, nu pe nume; `anon` și `service_role` nu au.
- **Porțile** (amprenta definițiilor, `fn_izo_porti_definitii`) includ cele două funcții noi. Orice modificare de corp, ACL sau config schimbă amprenta, iar activarea e refuzată până la o migrare revizuită.
- **Închiderea citirilor (r15):** funcțiile sunt `fn_izo_*`, adică registrul revizuit. Nu întorc rânduri din registru (§4), deci nu deschid nicio citire.

## 4. Ce scrie exact și ce NU poate scrie

**Scrie, într-o singură tranzacție:**
1. **Pe fiecare rând `decizie = primit`:** un INSERT în `magazie_bucati`:
   - `tip_cod` (teava / curba), `stare = 'sosit'`, `provenienta = 'beneficiar'`, `proiect_id` / `depozit_id` = ale documentului;
   - `serie` / `serie_canon`, `sarja`, `lot`, `greutate_kg`;
   - `lungime_aviz_mm` (document) + `lungime_masurata_mm`; `lungime_mm` = măsurat ?? document (Q-E3-5);
   - curbă: `unghi_curba` = unghiul de pe document; unghiul măsurat merge în `atribute.unghi_masurat` + observație;
   - `aviz_intrare_id = doc.id`, `nr_crt_aviz = rand.nr_crt`; `atribute.cod` (curbă), `observatii`.
2. **`decizie = primit_neconform`:** la fel, cu `stare = 'carantina'` (nedisponibilă la montaj) și motivul în `observatii`.
3. **`decizie = refuzat_la_receptie`:** NIMIC în registru. Rândul rămâne pe document, cu motivul.
4. **Un eveniment** `magazie_bucati_evenimente`: `tip = 'intrare_aviz'`, `document_tip = 'aviz'`, `document_id = doc.id`, `aplicat_de = auth.uid()`, cu `hash_doc` și hash-urile scanului în detalii, plus mișcările pe bucăți (ca la import).
5. **Documentul:** `stare = 'confirmat'`, `confirmat_de`, `confirmat_la`, `hash_confirmat = p_hash_doc`, `rand.bucata_id` pentru rândurile primite.

**NU poate scrie (verificat prin construcție și prin teste):**
- bucăți existente: nicio UPDATE / DELETE pe `magazie_bucati`, doar INSERT de bucăți noi ale propriului document;
- alt proiect / alt depozit decât al documentului;
- alte stări decât `sosit` / `carantina` (confirmarea) și `sosit` → `receptionat` (PV, doar pe bucățile documentului, doar din `sosit`);
- `izo_proiect_config`, `izo_atribuiri`, `izo_importuri`, nivelul, alte documente.

`fn_izo_doc_pv`: un UPDATE de stare `sosit` → `receptionat` pe `aviz_intrare_id = doc.id AND stare = 'sosit'` + evenimentul `receptie_pv` + PV-ul pe antet. Nicio altă coloană.

## 5. Idempotența și „documentul modificat după hash”

- **`hash_doc` = sha256 pe forma canonică a documentului:**
  - antetul: câmpurile de identitate și totalurile;
  - rândurile, sortate după `nr_crt`, cu toate câmpurile care ajung în registru și decizia / motivul;
  - calculată pe SERVER de `fn_izo_doc_verifica` (aceeași funcție o recalculează la confirmare).
  - Clientul o primește la „Verifică” și o trimite înapoi la „Confirmă”.
- **La confirmare** (sub FOR UPDATE pe document):
  - starea `draft`, `updated_at = p_versiune` și hash-ul recalculat = `p_hash_doc` → se confirmă;
  - hash diferit sau versiune diferită → refuz 40001 „documentul s-a modificat după verificare — verifică din nou”;
  - starea `confirmat` cu `hash_confirmat = p_hash_doc` → **idempotent**: întoarce rezultatul inițial (bucățile, evenimentul), fără a scrie ceva (retry după răspuns pierdut);
  - starea `confirmat` cu alt hash → refuz;
  - starea `anulat` → refuz.
- **Unicitatea:**
  - `UNIQUE (furnizor, nr_document, data_document)` pe documente;
  - un singur eveniment `intrare_aviz` per document (UNIQUE parțial);
  - seriile: coliziunea canonică cu registrul e blocantă (conflict de decis), ca la import.

## 6. Atomicitatea și verificările (recalculate la confirmare, nu luate de la client)

**Blocante**, care opresc toată confirmarea, nimic scris:
- Σ m și Σ kg (aviz țeavă) sau Σ bucăți / pachete / net (listă curbe) ≠ totalurile documentului, cu rândurile refuzate incluse;
- un rând `refuzat_la_receptie` / `primit_neconform` fără motiv;
- o serie lipsă, o serie dublă în document sau o coliziune canonică cu registrul (țeavă: `serie_canon`; curbă: serie + șarjă + unghi);
- perete / diametru lipsă (țeavă: din specificație sau câmp; curbă: wall thickness);
- un document fără niciun rând.

**Avertismente** (nu blochează, se salvează pe document):
- formatul `999AA99999`;
- caracterele ușor de confundat;
- diferența măsurat ↔ document peste ±10 mm sau ±0,5° (Q-E3-4);
- un scan dublat.

## 7. Auditul

- **Pe eveniment** (append-only, garda E2a): `aplicat_de = auth.uid()`, `aplicat_la`, `hash_doc`, `sha256_original` / `sha256_pdf` ale scanului (marcate „declarat de client” până la E9), `document_id`.
- **Pe document:** `confirmat_de` / `confirmat_la` / `hash_confirmat`, `pv_pus_de` / `pv_pus_la`.
- **Scanul:** bucket-ul `avize`, căi uuid. DELETE-ul e permis doar cât documentul e `draft`; după confirmare, ștergerea e refuzată (politica storage, testată pe branch-ul PG17).

## 8. Testele (negative întâi)

**Harness PG16 + branch PG17 + PostgREST real** (anon / authenticated cu JWT de test):
1. Alt utilizator: authenticated fără atribuire → 42501; gestionar pe alt depozit al aceluiași proiect → 42501; gestionar pe alt proiect → 42501.
2. Alt proiect: confirmarea nu poate atinge alt proiect sau depozit (nu există argumente; testul verifică că bucățile sunt doar pe proiectul / depozitul documentului).
3. Documentul modificat după hash: verifică → UPDATE pe un rând (prin `fn_izo_doc_salveaza`) → confirmare cu hash-ul vechi → 40001, nimic scris.
4. Dubla confirmare: retry cu același hash → idempotent (aceleași bucăți, un singur eveniment). Două confirmări concurente cu barieră → una scrie, cealaltă așteaptă și întoarce idempotent.
5. PostgREST:
   - anon → 401 pe ambele RPC-uri și pe tabelele draftului;
   - authenticated fără atribuire → 42501;
   - authenticated nu poate face INSERT / UPDATE direct în `magazie_bucati` / `magazie_bucati_evenimente` / tabelele draftului.
6. Wrapper-ul: o funcție din afara registrului care cheamă `fn_izo_doc_confirma` → porțile lipsesc (activarea refuzată).
7. Proiect `off` → refuz; depozitul de pe alt site → refuz.
8. Atomicitatea: un document cu o coliziune de serie la rândul 14 din 15 → nimic scris; sume care nu bat → nimic scris.
9. Curse cu barieră: confirmare ↔ activare / dezactivare a proiectului; confirmare ↔ storno pe același proiect; confirmare ↔ editarea draftului (antetul întâi, apoi rândurile).
10. Revenirea: scoate funcțiile și tabelele doar fără date; cu documente confirmate → refuz (storno + decizie), ca la E2a.

Datele de test: cele 3 documente din `pv_test`. Ținta e aceeași ca la importul de test: 40 disponibile / 259,73 m (lungimea de pe document) sau 259,70 m (măsurat), + 1 curbă în carantină.

## 9. Întrebări pentru review

1. Gestionarul fără depozit pe atribuire (tot proiectul): îl acceptăm la confirmare? Propun NU (atribuirea e pe depozit).
2. Owner-ul `izo_registru_writer` pentru intrările API (marcajul + garda neschimbată), sau un rol separat `izo_receptie_writer` cu drepturi doar INSERT + UPDATE de stare? Propun același writer: o singură frontieră, o singură gardă, porțile existente.
3. Excepția de la N3 pe `session_user IN ('authenticator', 'postgres')` + JWT `sub`: e suficientă împreună cu poarta pe wrapper-e?
