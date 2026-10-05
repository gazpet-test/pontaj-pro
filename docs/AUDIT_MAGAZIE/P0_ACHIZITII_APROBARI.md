# P0 Achiziții: aprobarea comenzilor peste prag, ținută de server

Stare: **spec, nimic aplicat**. Task #26, claude_context #1585. Ultima verificare live: 05.10.2026.
Urmează din auditul Jakarinos C (`RAPORT_JAKARINOS_C.md`, Achiziții) și din fix-urile UI din #603.

## 1. Ce e azi (live, 05.10.2026)

Regula „peste 2.500 lei comanda se emite doar după ce o aprobă toți aprobatorii” există **doar în UI** (`Achizitii.jsx`, `trimite` / `decideAprobare` / `emiteComanda`). Pe server:

| Obiect | Politică live | Ce permite oricărui cont logat, direct prin API |
|---|---|---|
| `comenzi_furnizor` | `cf_select` true, `cf_write` ALL pentru `auth.uid() IS NOT NULL` | pune `status='emisa'` pe orice comandă, fără aprobări |
| `comenzi_furnizor_aprobari` | `cfa_insert` orice cont logat; `cfa_update` = rândul propriu SAU owner SAU **EXISTS(propria aprobare pe aceeași comandă)**, fără WITH CHECK; `cfa_delete` doar owner | un aprobator poate aproba rândul altui aprobator de pe aceeași comandă; oricine își poate insera un rând „aprobat” |
| `comenzi_furnizor_linii` | `cfl_write` deschis | schimbă cantități / prețuri cât comanda e în aprobare sau după emitere |

Datele (05.10):
- 118 comenzi emise: **117 emise de Kostas**, 1 de Răzvan (12.06). 0 emise peste prag fără aprobări, 0 drafturi cu aprobări, `fara_formular` = 0 comenzi.
- `comenzi_aprobatori`: activ **doar Kostas** (id 3, „Achizitii”). Marilena (id 1, Director Financiar) și Pantea (id 2, Director Departament Execuție) sunt inactivi.
- Aprobări: 86 „aprobat” ale lui Kostas, 1 a Marilenei (12.06). În așteptare: 5 la Kostas, 1 la Marilena.

**Concluzia care contează mai mult decât poarta tehnică:** din iunie, comenzile peste prag le întocmește, le aprobă și le emite aceeași persoană. Poarta pe server oprește un cont străin care ar sări peste flux, dar nu adaugă un al doilea ochi. Fără o decizie la Q1, P0 e doar „încuietoare pe o ușă pe care o deschide același om”.

## 2. Designul propus

### 2.1 Poarta de emitere (trigger)
`fn_cf_poarta_emitere()` — BEFORE INSERT OR UPDATE OF status ON `comenzi_furnizor`, SECDEF, `search_path = public, pg_temp`.

Se declanșează când statusul **intră** într-o stare emisă (`emisa`, `in_tranzit`, `ajunsa`, `receptionata`, `in_stoc`) venind din `draft` / `in_aprobare` / `respinsa` / `anulata` sau la INSERT. Trece dacă:
- **sub prag, calculat pe server**: `sum(cantitate × pret_unitar)` din linii, × 5,0 pentru EUR (aceleași constante ca `PRAG_APROBARE_LEI` / `CURS_EUR_APROX` din UI), total > 0 și < 2.500 lei; **sau**
- **toate aprobările „aprobat”**, cu cel puțin una; **sau**
- excepția `fara_formular` (vezi Q2).

Altfel: `RAISE EXCEPTION` cu mesaj în română („Comanda e peste 2.500 lei și nu are toate aprobările”).
Trecerile între stările emise (`emisa → in_tranzit → …`) și anularea nu sunt atinse.

### 2.2 Trimiterea în aprobare (RPC)
`fn_cf_trimite_in_aprobare(p_comanda_id bigint)` — SECDEF, EXECUTE doar `authenticated`:
- comanda e în `draft` sau `respinsa`, are linii și total > 0, e peste prag;
- inserează aprobările din `comenzi_aprobatori` activi, `ON CONFLICT DO NOTHING`; refuză dacă lista e goală;
- pune `status = 'in_aprobare'` și notează cine a trimis (`trimisa_de`, `trimisa_la` — coloane noi);
- regula din Q1 (dacă e aleasă): expeditorul nu poate fi aprobator pe propria comandă.

INSERT direct în `comenzi_furnizor_aprobari` se ia de la `authenticated` (rămâne doar prin RPC). UI-ul `trimite` trece pe RPC în același PR.

### 2.3 Decizia
- `cfa_update` devine: **doar rândul propriu** (`profile_id = auth.uid()`), cu WITH CHECK identic. Dispare clauza „EXISTS(propria aprobare pe aceeași comandă)”.
- `REVOKE UPDATE` pe tabel de la `authenticated` + `GRANT UPDATE (status, comentariu)` — restul coloanelor (profil, comandă, rol) nu se mai pot schimba din API.
- Trigger pe `comenzi_furnizor_aprobari`: statusul trece doar din `in_asteptare` în `aprobat` / `respins`, iar `decis_la = now()` se pune pe server (nu din ceasul clientului).
- Emiterea rămâne pe client (PDF-ul cu semnături se generează în browser); poarta 2.1 o lasă să treacă doar când toate aprobările sunt „aprobat”.

### 2.4 Ce NU intră în P0 (rămâne P1)
- Înghețarea cantităților / prețurilor din `comenzi_furnizor_linii` după `in_aprobare` (azi se pot schimba după ce s-a aprobat).
- `cf_write` legat de accesul pe modulul Achiziții (azi orice cont logat).
- Achiziții #1, #2, #3, #6, #7 din audit (tranzacționale).

## 3. Livrare
1. Răspunsurile la Q1–Q3 (mai jos).
2. Migrare `2026101xa_achizitii_poarta_aprobare.sql` cu gardă (precondiție md5 pe `pg_policies` pentru cele 3 tabele + amprenta funcțiilor), revenire în `supabase/revenire/`, harness pe PG17 local (`scripts/test_achizitii_aprobare.sh`): emitere sub/peste prag, aprobare pe rândul altuia, insert aprobare direct, dublă trimitere, EUR, comandă fără linii, `fara_formular`.
3. PR UI: `trimite` pe RPC; mesajul de eroare al porții afișat în toast.
4. Copilot (diff + SQL efectiv) → „aplica” de la Răzvan → **migrarea și merge-ul UI în aceeași fereastră** (RPC-ul trebuie să existe înainte ca UI-ul nou să ajungă live; UI-ul vechi face INSERT direct, deci după migrare trimiterea din UI-ul vechi pică până la deploy — ~3 min).
5. Gate 0e + `get_advisors` după aplicare.

## 4. Întrebări pentru Răzvan

**Q1 — Cine aprobă peste 2.500 lei?** (azi: doar Kostas, care și întocmește comenzile)
- **A.** Rămâne Kostas singur. Poarta pe server oprește doar conturile străine.
- **B.** Se reactivează un al doilea aprobator (Marilena și/sau Pantea) și trebuie să aprobe toți. Mai lent: fiecare comandă peste prag așteaptă încă un om.
- **C. (recomand)** Regula „cine trimite comanda nu o poate aproba”, plus un aprobator independent activ (de ales: Marilena, Pantea sau tu). Kostas rămâne aprobator pentru comenzile trimise de alții.

**Q2 — Comenzile „fără formular”** (din Cereri interne, emise direct, fără prețuri; 0 folosiri până azi)
- **A. (recomand)** Rămân scutite, dar `fara_formular` nu se mai poate bifa după creare (altfel devine portiță).
- **B.** Cer aprobare ca toate celelalte.

**Q3 — Owner-ul poate forța emiterea?**
- **A. (recomand)** Nu. Dacă vrei să aprobi, te pui în lista de aprobatori.
- **B.** Da, owner-ul poate emite orice comandă, cu motiv obligatoriu în observații.
