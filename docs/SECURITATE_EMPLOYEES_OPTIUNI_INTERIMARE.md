# `employees`: opțiuni de măsură interimară (IBAN / QR-PIN / telefon) — pentru decizia lui Răzvan

> **Doar pregătire, read-only.** Nimic aplicat. Cerința Copilot (verdict pe matrice, §4): „NO-GO pentru lăsarea tuturor IBAN-urilor și QR-PIN-urilor accesibile până după Jilava doar fiindcă există `select('*')`" → măsură interimară **aprobată acum**, cu impactul pe ecrane și pe Jilava prezentat. Degradarea / restricționarea / reemiterea sunt decizia ta, după preview.
> Date: catalog + numărători agregate pe producție (30.09.2026), cod din `src/` și `supabase/functions/` (branch `claude/erp-continuare-x4p5a7`, `d232cf4`). Nicio valoare sensibilă citită.

## 0. Starea de azi (live)

- Politica `employees_select_all_authenticated`: `SELECT … USING (true)`, rol `authenticated`; GRANT la nivel de **tabel** `arwdDxtm` pentru `anon`, `authenticated`, `service_role`; **nicio** restricție pe coloane (`attacl` gol pe toate cele 34 de coloane).
- 172 de rânduri (120 activi): **149 cu IBAN, 120 cu telefon, 1 email**; `cnp`/`adresa`/`data_nasterii` există ca coloane, dar sunt **goale (0)** — CNP-ul real stă în `hr_employees_private` (19, gated corect).
- **QR-PIN valabil** = criteriul real din `fn_qr_lookup_pin` (singura validare, apelată de `qr-alimentare-submit`): `qr_pin = input AND qr_pin_active AND active`. Fără expirare, reutilizabil (doar rate-limit 5 succese/oră per utilaj+PIN). **44 PIN-uri valabile** (49 nenule, toate `qr_pin_active`, 5 la angajați inactivi). 6 cifre.
- Copii ale PIN-urilor: `logistica_qr_submit_log.pin_provided` (879 submituri reușite, 38 PIN-uri distincte) — citibil doar de owner + `role='admin_logistica'` (corect pentru contul fără modul, dar rămâne o copie în clar după orice restricție pe `employees`).
- `fn_qr_lookup_pin` e SECURITY DEFINER, EXECUTE doar `postgres`/`service_role` → **nu** e oracol de PIN din API. Edge-urile QR rulează cu service_role → nu sunt afectate de nicio restricție pentru `authenticated`.

## 1. Inventarul consumatorilor (`from('employees')`, 60 de apeluri)

### 1a. `select('*')` — se strică la orice restricție de coloană fără modificare UI

| Fișier:linie | Coloane | Ecran / flux | Jilava? |
|---|---|---|---|
| `src/App.jsx:1285` | `*, sites(name)` | Pontaj — lista de angajați | nu |
| `src/App.jsx:1848` | `*, sites(name)` | Pontaj/alocări pe șantier | nu |
| `src/App.jsx:2974` | `*` | rapoarte pontaj | nu |
| `src/App.jsx:4367` | `*, sites(name)` | ecran angajați/pontaj | nu |
| `src/App.jsx:4772`, `5104`, `5171` | `*` | exporturi / state pontaj–salarii (folosesc IBAN la stat de plată) | nu |
| `src/App.jsx:6494` | `*, sites(name)` | Admin → Angajați (editare, inclusiv IBAN) | nu |
| `src/App.jsx:8286` | `*, sites(name)` | Salarii (SalariiPage) — IBAN legitim | nu |
| `src/HR.jsx:176` | `*, sites(name)` | HR → lista angajați | nu |
| `src/HR.jsx:316` | `*` | HR (fișă / exporturi) | nu |

Inserturi care întorc rândul: `src/HrAngajatNouWizard.jsx:267` (`insert(...)` — dacă are `.select()`, RETURNING-ul cere SELECT pe coloanele întoarse), `src/App.jsx:6751/6869` (adăugare/import angajați).

### 1b. Coloane explicite — NU ating IBAN/telefon/PIN (neafectate de opțiunile A/B)

`Logistica.jsx:1290, 4392, 5305, 11269` · `TabSemnaturi.jsx:592, 865` · `ImprumuturiEchipamente.jsx:75` · `TabSantiere.jsx:116` · `HomeScada.jsx:14` (count) · `HrFostiAngajati.jsx:79` (`SELECT_FOSTI`, fără IBAN) · `Executie.jsx:465, 1185, 1740, 2945, 2956` · `App.jsx:2331, 3088, 3564, 6603` · `OfertareOrganigrama.jsx:655` · `OfertareNomenclatoare.jsx:221` (count) · `Achizitii.jsx:1628` · `OrganigramaPropuneri.jsx:74` · `CereriInterneProiect.jsx:649` · `Magazie.jsx:499` · `CitesteOricePanel.jsx:190` · `HrPersonalExtern.jsx:86` (are `email`) · `Tichete.jsx:164`.
Edge: `ofertare-triere/index.ts:460` (`name, position, functie`), `ofertare-acoperire/core.ts:249` (`name, functie, position, hire_date`) — ambele cu service_role, neafectate.

### 1c. Fluxuri QR (folosesc `qr_pin`)

| Fișier:linie | Ce face | Cine |
|---|---|---|
| `src/Logistica.jsx:8912`, `9112`, `9125` | citește `qr_pin, qr_pin_active, qr_pin_creat_la` — ecranul de administrare PIN-uri șoferi | admin logistică / owner |
| `src/Logistica.jsx:9104`, `9119` | UPDATE PIN (generare / activare) — scrierea e deja gated (`owner\|can_modify_employees`) | idem |
| edge `qr-alimentare-submit` → `fn_qr_lookup_pin` | validare PIN la alimentare (public, `verify_jwt=false`) | service_role — **neafectat** |
| edge `qr-bon-comun-lookup`, `qr-utilaj-info` | fluxul bon comun / info utilaj (public) | service_role (cod nu e în repo; neinspectat linie cu linie) |

### 1d. Jilava (Ofertare / PT93 / personal F9)

Consumatorii Ofertare citesc **doar** `id, name, functie, position, hire_date` (+ count): `OfertareOrganigrama.jsx:655`, `OfertareNomenclatoare.jsx:221`, edge `ofertare-acoperire` și `ofertare-triere` (service_role). **Niciunul nu citește IBAN, telefon sau PIN și niciunul nu folosește `select('*')`.** Personalul F9 / organigrama PT vine din aceste coloane neutre. Concluzie: o restricție pe coloanele sensibile **nu atinge Jilava** și nu cere excepție la freeze-ul Ofertare (nu se modifică obiecte Ofertare).

## 2. Comportamentul PostgreSQL / PostgREST (sursa, nu test în producție)

1. **Privilegiile pe coloane nu scad un privilegiu pe tabel.** Doc. PostgreSQL, `GRANT`: „granting the privilege at the table level and then revoking it for one column will not do what one might wish: the table-level grant is unaffected by a column-level operation". Deci `REVOKE SELECT (iban) ON employees FROM authenticated` **singur nu face nimic**. Corect: `REVOKE SELECT ON employees FROM authenticated` + `GRANT SELECT (id, name, …coloanele neutre) ON employees TO authenticated`. Precedent în producție: `iot_dispozitive` are GRANT UPDATE pe 3 coloane, dar și UPDATE pe tabel → restricția de coloană e ineficientă.
2. **`SELECT *` cere privilegiu pe toate coloanele.** Fără SELECT pe o coloană, orice interogare care o referă (inclusiv `*`, `RETURNING *`) eșuează cu `ERROR: permission denied for table employees`, SQLSTATE **42501** (verificarea se face în executor pe setul de coloane al RTE; mesajul e la nivel de tabel).
3. **PostgREST**: `select=*` se traduce în `"public"."employees".*` → aceeași eroare 42501, mapată **HTTP 403** pentru un utilizator autentificat (401 pentru anon) — tabelul de erori PostgREST. Ecranul primește eroare, nu listă parțială. La fel `insert(...).select()` (RETURNING).
4. **RLS pe rânduri nu ascunde coloane**: o politică de rând decide *ce rânduri*, nu *ce coloane*.
5. **View `security_invoker`** nu dă acces în plus față de tabelul-sursă; un view neutru fără restricția tabelului nu protejează nimic (Copilot §4). Un view **definer** (fără `security_invoker`) ar da acces fără RLS — contrazice regula CLAUDE.md pct. 4.

## 3. Opțiuni

### A — REVOKE SELECT pe tabel + GRANT pe coloanele neutre (fără `iban`, `qr_pin`, poate `telefon`) de la `authenticated`; acces sensibil prin RPC DEFINER cu poartă
- **Protejează:** IBAN (149), PIN (44 valabile), opțional telefon (120) față de orice cont logat, inclusiv prin REST direct. Scrierea rămâne ca azi.
- **Se strică (fără deploy UI):** cele 12 `select('*')` din §1a → **403** pe: Pontaj (App 1285/1848/2974/4367), exporturi/state (4772/5104/5171), Admin→Angajați (6494), **Salarii (8286)**, HR listă/fișă (HR.jsx 176/316); ecranul PIN-uri (Logistica 8912/9112/9125); posibil wizard angajat nou (RETURNING). Adică pontajul zilnic și HR — **inacceptabil fără deploy**.
- **Varianta A-lite (doar `qr_pin`)** are aceeași problemă: orice `*` cere și coloana `qr_pin` → aceleași ecrane cad.
- **Deploy UI:** DA (înlocuirea `*` cu liste explicite + RPC `fn_employees_sensibil()` pentru HR/salarii/logistică). Supus Q2-B → doar la cererea ta înainte de 02.10 12:00.
- **Freeze Ofertare:** nu. **Reversibil:** da, instant (`GRANT SELECT ON employees TO authenticated`). **Efort:** SQL mic; UI ~12 locuri + 1 RPC + test pe ecrane.

### B — mutarea coloanelor sensibile în tabel separat (model `hr_employees_private`)
- **Protejează:** la fel ca A, cu RLS pe rând (`owner|can_access_personal_data|salarii` pentru IBAN; `owner|admin_logistica` pentru PIN).
- **Se strică:** UI-ul care citește `emp.iban` / `emp.qr_pin` din `*` primește `undefined` (fără eroare) → Salarii/exporturi fără IBAN, ecranul PIN gol; `fn_qr_lookup_pin` trebuie rescrisă (altfel alimentările QR cad). Ecranele de pontaj **nu** cad.
- **Deploy UI:** DA (Salarii, Admin, HR, Logistica PIN). **Migrare de date** (DML pe 149+49 rânduri, preview→confirm→apply). **Freeze:** nu. **Reversibil:** mai greu (date mutate; rollback = copiere înapoi). **Efort:** cel mai mare — e refactorul, nu interimar.

### C — politică RLS pe rânduri (ex. SELECT doar HR/owner/rândul propriu)
- **Nu rezolvă problema coloanelor** și strică aproape tot: `employees` e citit de ~40 de ecrane (dropdown-uri de nume în Execuție, Logistică, Magazie, Tichete, **Ofertare organigramă**) → liste goale. Atinge Jilava. **Nerecomandat.**

### D — interimar fără schema tabelului: golire/rotire a secretelor, nu a coloanelor
- **D1 – PIN-uri:** reemiterea celor 44 de PIN-uri **după** ce citirea e restrânsă (altfel noile PIN-uri sunt la fel de expuse). Singură, fără A/B, nu protejează nimic. Cost operațional: șoferii primesc PIN nou.
- **D2 – IBAN:** IBAN-ul nu e credențial (nu se poate „roti"); expunerea e de confidențialitate (GDPR), nu de acces. Riscul concret: fraudă de tip „schimbare de cont" — dar scrierea e deja gated (`owner|can_modify_employees`).
- **D3 – A „în două trepte" (recomandarea, vezi §4).**

## 4. Recomandarea (PROPUNERE — decizia e a ta, după preview)

**D3 = A, aplicat împreună cu un deploy UI minim, acum (cu cererea ta explicită pentru Q2-B):**
1. UI: înlocuiește cele 12 `select('*')` cu liste explicite de coloane neutre; ecranele care chiar au nevoie (Salarii 8286, Admin 6494, exporturi state de plată, Logistica PIN 8912/9112/9125) citesc sensibilul printr-un RPC SECURITY DEFINER cu poartă (`owner|can_access_salarii|can_modify_employees` pentru IBAN; `owner|admin_logistica` pentru PIN), `SET search_path = public, pg_temp`, REVOKE de la PUBLIC/anon.
2. **După** ce deploy-ul e verificat live: `REVOKE SELECT ON employees FROM authenticated, anon; GRANT SELECT (<coloane neutre>) ON employees TO authenticated;` (`telefon` — decizia ta: îl folosesc listele de contact?).
3. **Apoi** reemiterea PIN-urilor (D1) — decizia ta, preview cu numărul (44).
- Nu atinge Ofertare/Jilava (consumatorii lor folosesc doar coloane neutre; edge-urile rulează cu service_role). Revenire instantă: un GRANT.
- **Dacă nu vrei deploy înainte de 02.10 12:00:** nu există măsură SQL-only care să protejeze IBAN/PIN fără să rupă Pontajul și HR (vezi A). Singurul pas SQL-only sigur azi e **pregătirea** (RPC-ul, lista de coloane, testul local) + limitarea copiilor (`logistica_qr_submit_log` rămâne owner/admin_logistica). Aceasta e o decizie de risc acceptat pe care trebuie s-o iei explicit, cu data-limită (imediat după 02.10 12:00).

## 5. Ce n-am verificat
- Codul live al `qr-bon-comun-lookup`, `qr-utilaj-info` (nu e în repo) — presupus service_role, neconfirmat linie cu linie.
- Dacă `HrAngajatNouWizard.jsx:267` folosește `.select()` după insert (RETURNING) — de confirmat la implementare.
- Comportamentul PostgREST e din documentație, nu testat (fără PostgREST local); comportamentul PostgreSQL e din documentație (nu s-a rulat nimic pe producție).
