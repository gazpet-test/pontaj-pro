# Diurne — salvarea atomică a plății (PR #547, migrarea `20260930h`)

Răspuns la blocantele reviewer-ului (Copilot NO-GO #546): salvarea plății de diurne trebuie să fie **atomică, serializată,
idempotentă**, să **refuze suprapunerile per angajat** și să fie **legată de versiunea datelor aprobate**; fișierul BT
trebuie să iasă din **plata salvată**, nu dintr-un recalcul.

> Migrarea **NU este aplicată** pe proiectul live. Se aplică după închiderea plăților din septembrie 2026, cu GO Copilot + „da” explicit.

## Ce s-a schimbat

| Strat | Înainte | Acum |
|---|---|---|
| Salvare (App.jsx `savePayment`) | INSERT plată → INSERT detalii → DELETE compensator la eroare | UN apel `supabase.rpc('diurna_salveaza_plata', args)` (`salveazaPlataDiurne` din `diurneFlux.js`) |
| Concurență | două tab-uri puteau salva amândouă | `pg_advisory_xact_lock(hashtext('diurna_payments'))` — un singur scriitor, ceilalți așteaptă COMMIT-ul |
| Retry | risc de dublură | `idempotency_key` (UUID generat O DATĂ la afișarea confirmării, refolosit la retry) → `inserted:false` + același id |
| Suprapunere | doar pre-check în UI | trigger `trg_diurna_detalii_fara_suprapunere` (23P01) pe fiecare detaliu, sub orice cale de scriere |
| Versiunea datelor | niciuna | `p_amprenta` (sha256) recalculată de server sub lock; nepotrivire ⇒ `P0002`, nimic salvat |
| Detalii | `days, amount` | + `zile_diurna, zile_salariu, suma_salariu, defalcare_luni` (reconciliere fără recalcul) |
| Plată | — | + `baza_calcul` {amprenta, tarif, month_start, month_end, employee_ids_count, versiune_formula, verificat_server_la} |
| BT (`exportBancaDiurne`) | recalcul din pontaj + fallback IBAN firmă hardcodat | citește plata cu `period_from=df AND period_to=dt` (0 → „salvează întâi”, >1 → oprire), detaliile ei, IBAN-urile din `employees`, `iban_firma` din settings (**fără fallback**) |

## Semnătura RPC

```sql
public.diurna_salveaza_plata(
  p_period_from date, p_period_to date, p_notes text, p_detalii jsonb, p_idempotency_key uuid,
  p_amprenta text, p_employee_ids integer[], p_month_start date, p_month_end date, p_tarif_text text,
  p_baza_calcul jsonb DEFAULT NULL, p_payment_date date DEFAULT NULL
) RETURNS jsonb   -- {payment_id, inserted, total_employees, total_days, total_amount}
```
Ordinea verificărilor: rol (owner sau `can_access_salarii`, 42501) → interval → perioada în `[p_month_start, p_month_end]` →
cheie → amprentă hex → scop → tarif numeric → detalii nevide → **lock** → idempotență → **amprentă server = client** (P0002)
→ validare detalii (numerice, ≥ 0, angajați unici, din scop) → INSERT plată → INSERT detalii (trigger 23P01) → RETURN.
Orice excepție ⇒ ROLLBACK complet al funcției: nu rămâne plată fără detalii.

## Amprenta canonică (identică pe client și server)

Client: `amprentaHash(snap)` (`src/diurneAlocare.js`). Server: `public.diurna_amprenta_canonica(...)` + `diurna_amprenta_hash(...)`.

```
<linie>\n<linie>…                       -- pontaj_records: employee_id = ANY(p_employee_ids), date BETWEEN p_month_start AND p_month_end,
                                        --   ORDER BY employee_id, date, id; linie = employee_id|YYYY-MM-DD|1/0(diurna IS TRUE)|coalesce(norma,'')
\n#tarif=<p_tarif_text exact ca string-ul clientului, ex. '50'>
\n#legal=<calendar_days.type='legal' în interval, date distincte asc, unite cu ','>
\n#emps=<p_employee_ids sortate numeric, unite cu ','>
hash = encode(sha256(convert_to(canonic,'UTF8')),'hex')
```
Fără rânduri de pontaj ⇒ prima parte e `''` (hash-ul începe cu `\n#tarif=`). Orice modificare de bifă, CO, tarif,
zi legală sau listă de angajați între previzualizare și salvare schimbă hash-ul ⇒ P0002 ⇒ utilizatorul reîncarcă și confirmă din nou.

## Teste

* Client (vitest, fără BD): `npx vitest run src/diurneSalvare.test.js` — payload cu `defalcare_luni`, forma argumentelor RPC,
  BT din rândurile salvate (amount 0 exclus, IBAN firmă lipsă ⇒ throw, IBAN angajat lipsă ⇒ `faraIBAN`), orchestrarea
  `salveazaPlataDiurne` peste un `rpc` mock (succes / `inserted:false` la retry / P0002 propagat fără al doilea apel).
* Server (psql, **doar local**): `supabase/tests/diurna_salveaza_plata.test.sql`.

### Rularea testului SQL local (NU pe live)

```bash
supabase start                                   # sau un Postgres 16 local cu schema proiectului
export PGURI=postgresql://postgres:postgres@127.0.0.1:54322/postgres
psql "$PGURI" -v ON_ERROR_STOP=1 -f supabase/migrations/20260930h_diurna_salveaza_plata.sql   # o dată, local
psql "$PGURI" -v ON_ERROR_STOP=1 -f supabase/tests/diurna_salveaza_plata.test.sql
```
Scriptul rulează în `BEGIN … ROLLBACK` (fixture: `auth.users` + `profiles` cu `can_access_salarii`, 2 angajați, 5 rânduri de
pontaj), simulează identitatea PostgREST (`SET LOCAL ROLE authenticated` + `request.jwt.claims.sub`, ca în
`scripts/pg/test_jakv207_rls.mjs`) și verifică: insert ok · aceeași cheie ⇒ `inserted=false`, fără dublură · suprapunere per
angajat ⇒ 23P01 · amprentă greșită ⇒ P0002 · `amount:'abc'` ⇒ excepție · perioadă în afara lunilor ⇒ refuz · pontaj modificat
după previzualizare ⇒ P0002 · exact o plată în plus, fără orfane · fără `can_access_salarii` ⇒ 42501.
Ultima linie afișată trebuie să fie `TOATE TESTELE AU TRECUT — se face ROLLBACK`. Dacă `employees`/`pontaj_records` au local
coloane NOT NULL suplimentare, ajustează INSERT-urile de fixture (nu logica testelor).

### Scenariul de concurență (două sesiuni, manual)

Terminal A și B, ambele pe baza locală, cu identitatea de mai sus (blocul „identitate PostgREST” din test):

```
A> BEGIN;
A> SELECT public.diurna_salveaza_plata(DATE '2026-09-28', DATE '2026-09-30', 't', '[{"employee_id":E1,"days":1,"amount":50}]', gen_random_uuid(), '<amprenta>', ARRAY[E1,E2], DATE '2026-09-01', DATE '2026-09-30', '50');
   -- întoarce {inserted:true}; tranzacția rămâne deschisă ⇒ lock-ul advisory e ținut
B> BEGIN;
B> SELECT public.diurna_salveaza_plata(... aceleași perioade, ALTĂ cheie, același E1 ...);
   -- B BLOCHEAZĂ la pg_advisory_xact_lock (nu întoarce nimic) cât timp A nu a făcut COMMIT/ROLLBACK
A> COMMIT;
   -- B se deblochează imediat și primește: ERROR 23P01 „angajatul E1 are deja o plată (id …) care se suprapune”
   -- (dacă A ar fi făcut ROLLBACK, B ar fi reușit cu inserted:true — corect: nu există plată salvată)
B> ROLLBACK;   -- apoi curăță plata lui A: DELETE FROM diurna_payment_details WHERE payment_id=…; DELETE FROM diurna_payments WHERE id=…
```
Verificare în timpul blocării, dintr-un al treilea terminal: `SELECT pid, wait_event_type, wait_event FROM pg_stat_activity WHERE wait_event = 'advisory';`.

### Verificare deja făcută (30.09.2026, fără BD live)

Migrarea + scenariile de mai sus au fost rulate pe PGlite (Postgres WASM, în memorie, schemă minimă + stub `auth.uid()`):
migrarea se aplică, hash-ul SQL == hash-ul JS pe același text canonic, insert ok, retry ⇒ `inserted:false`, 23P01, P0002
(amprentă greșită și pontaj modificat), `abc` ⇒ P0001, perioadă în afara lunilor ⇒ refuz, angajat în afara scopului ⇒ refuz,
42501 fără drept, `baza_calcul` și `defalcare_luni` înregistrate, o singură plată cu 2 detalii, rollback-ul se aplică.
Nu s-a rulat pe schema reală (constrângeri NOT NULL / FK-uri locale pot cere ajustări de fixture în testul psql).

## Rollback

`supabase/migrations/20260930h_diurna_salveaza_plata_ROLLBACK.sql` — șterge trigger-ul, funcțiile (ambele semnături) și
indexul de idempotență; coloanele noi rămân (nullable, cu date înregistrate).
