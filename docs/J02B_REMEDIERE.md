# J02b — „nu se aplică” / „exceptat” doar cu confirmare umană (DRAFT, NEAPLICAT)

**Stare:** draft pentru după depunerea Jilava (freeze Ofertare până la 02.10.2026, 12:00). Nimic nu e aplicat în BD, nimic nu e mergeuit.
**Branch:** `claude/erp-continuare-x4p5a7-j02b` (fără PR).
**Legătură audit:** S05-02 (FALSE_GREEN critic), extins la matricea PT (legături `exceptat` cu `sursa='ai'`).

## Problema
1. **Poarta de depunere J02** (`fn_gate_depunere`, trigger `trg_gate_depunere` pe `ofertare_licitatii`) consideră o cerință acoperită dacă
   există un rând `ofertare_acoperire.status='nu_se_aplica'`, adică propunerea AI. Nicio decizie umană nu e cerută.
2. **Poarta PT** (`v_ofertare_pt_stare`, consumată de `evalueazaPoarta` din `src/ofertarePoarta.js`) consideră cerința „exceptată” (o scoate din `fara_capitol`)
   pentru orice legătură `ofertare_pt_legaturi.fel='exceptat'`, inclusiv una scrisă de AI (`sursa='ai'`, 79 pe live).
3. **UI**: panoul de acoperire (`OfertareLicitatii.jsx`) scoate din alarmă o eliminatorie cu `ofertare_cerinte.stare='nu_se_aplica'`; matricea PT (`OfertarePropunere.jsx`)
   arată „⊘ exceptată” și filtrul „gata” pentru orice legătură `exceptat`. Nicio decizie nu e legată de versiunea sursei, deci nici nu se invalidează.

## Regula nouă
O cerință se închide ca neaplicabilă/exceptată **doar** printr-o confirmare umană explicită, care poartă:
- **actor**: `auth.uid()` (RPC-ul refuză fără utilizator; nu se poate transmite alt actor);
- **motiv**: obligatoriu, minim 5 caractere;
- **amprenta sursei**: `md5` din textul cerinței, versiune, tip, document/pagină/pasaj sursă, înlocuire/duplicat și identitatea documentului sursă
  (cale, mărime, revizie, `procesat_la`, `pg_column_size(text_extras)`);
- **momentul**: `confirmat_la`.

Confirmarea e validă doar cât amprenta ei e egală cu amprenta **curentă**. Se calculează la citire, deci se **invalidează automat** când textul
cerinței sau documentul sursă se schimbă, fără trigger și fără job. Confirmarea pe o amprentă veche e refuzată (`40001`, „sursa s-a schimbat”).
„Nu se aplică” sau „exceptat” scris de AI rămâne **propunere**: se vede în UI (badge portocaliu), dar cerința rămâne deschisă.
`ofertare_cerinte.stare='nu_se_aplica'` fără confirmare cu amprentă (decizii vechi) **nu mai închide nimic**. Omul trebuie să reconfirme.

## Obiecte afectate
| Obiect | Schimbare |
|---|---|
| `ofertare_cerinte_na_confirmari` | **NOU**. RLS; SELECT pentru `authenticated` cu `fn_are_acces_ofertare()`; nicio scriere directă (INSERT/UPDATE/DELETE revocate) |
| `ofertare_j02b_rollback_def` | **NOU**. Copia definiției live a `v_ofertare_pt_stare`, pentru rollback exact; RLS, doar `service_role` |
| `fn_ofertare_cerinta_amprenta(bigint)` | **NOU**. SECURITY DEFINER, STABLE; NULL pentru un utilizator fără acces Ofertare (fail-closed) |
| `fn_ofertare_cerinta_na_confirmata(bigint,text)` | **NOU**. SECURITY DEFINER, STABLE |
| `ofertare_confirma_neaplicabil(bigint,text,text,text)` | **NOU**. RPC: actor = `auth.uid()`, acces Ofertare, motiv, tip, cerință activă, `FOR UPDATE`, amprenta văzută = amprenta curentă |
| `ofertare_revoca_neaplicabil(bigint,text)` | **NOU**. RPC: revocare cu motiv, făcută de autor sau de owner; rândul rămâne în istoric |
| `v_ofertare_cerinte_na_stare` | **NOU**. `security_invoker=on`, cu coloana `valida` |
| `fn_gate_depunere()` | **ÎNLOCUIT**, cu pre-verificare `md5(prosrc)=4bddf68c…`: ramura `a.status='nu_se_aplica'` devine `fn_ofertare_cerinta_na_confirmata(c.id,'nu_se_aplica')`, iar mesajul primește contorul „din ele N au doar «nu se aplică» propus de AI”. Restul funcției e identic (derogare owner, pachet, R5, audit) |
| `v_ofertare_pt_stare` | **ÎNLOCUIT**, cu pre-verificare `md5(viewdef)=c77c49b8…`: `exceptata` cere și confirmare `exceptat_pt` validă; coloană nouă la final: `exceptate_propuse_ai` |
| `src/ofertareNeaplicabil.js` (+ test) | **NOU**. Regula JS, fail-closed: fără confirmări (view lipsă sau eroare), nimic nu e închis |
| `src/OfertareLicitatii.jsx` | contoarele din `statisticiAcoperire`; badge „propunere AI — deschisă” / „confirmare invalidată” / „✓ om”; buton „✓ Confirm «nu se aplică»” |
| `src/OfertarePropunere.jsx` | filtrele „gata/fără/capcane/dovadă” și badge-urile folosesc `stareExceptarePT`; buton „✓ Confirm exceptarea” pe rând; excepția în bloc confirmă automat doar când e selectată o singură cerință |
| `src/ofertarePoarta.js` | detaliul rândului „Cerințe fără capitol” arată `exceptate_propuse_ai` |

Toate funcțiile SECURITY DEFINER noi sau schimbate au `SET search_path = public, pg_temp`. Au `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` explicit, apoi GRANT minim:
- `authenticated`: amprenta, helperul (chemat din view-ul security_invoker) și cele două RPC-uri;
- `service_role`: amprenta și helperul;
- `fn_gate_depunere`: rămâne fără `authenticated`.

## Efect estimat după apply (fără confirmări noi)
- Poarta de depunere: cele **1.579** cerințe din raportul de mai jos devin „fără acoperire verificată” (375 eliminatorii). Licitațiile active nu se mai pot depune fără confirmare umană cerință cu cerință sau fără derogarea owner (J05).
- Poarta PT, licitația 93: `exceptate` scade de la 36 la 0, `fara_capitol` crește de la 0 la 24, iar restul de 12 apar ca `dovada_de_verificat`.
  La 5 și la 103: câte 1 cerință. Simulat read-only pe live, înlocuind helperul cu `false`.
- Cele 2 exceptări `sursa='om'` existente și cele 216 `stare='nu_se_aplica'` de om (108 pe licitația 5 și 108 pe 103) trebuie **reconfirmate** cu amprentă.

## Aplicare (după GO Copilot și acordul lui Răzvan, după 02.10)
Runnerul oficial `scripts/livrare_migrare.sh` și validatorul (`scripts/livrare_validator.py`) sunt pe branch-ul `claude/erp-continuare-x4p5a7-sec-rsvti` și **nu sunt încă pe main**.
```bash
python3 scripts/livrare_validator.py supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana.sql   # → OK 35 instrucțiuni
sha256sum supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana.sql
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana.sql \
     --sha256 <sha256 de mai sus> --versiune 20261004000100 --tinta-db postgres --tinta-sistem <system_identifier> \
     --tinta-host <H> --tinta-port <P>
```
Garda de livrare (start + final) refuză orice altă cale: `apply_migration`, `execute_sql`, `psql -f` simplu.
Precondițiile refuză dacă funcția sau view-ul live diferă de analiza din 30.09 (md5), dacă `fn_are_acces_ofertare` s-a schimbat, dacă triggerul lipsește sau dacă obiectele există deja.
**UI-ul se mergeuiește în aceeași fereastră cu apply-ul**, nu înainte: fără view-ul nou UI-ul e fail-closed și ar arăta toate „nu se aplică”/„exceptat” ca deschise.

Test SQL (BEGIN…ROLLBACK, pe o bază cu schema producției: Supabase branch sau clonă, **nu** pe producție fără GO):
`psql "$PGURI" -X -v ON_ERROR_STOP=1 -f supabase/tests/j02b_na_confirmare_test.sql`. Scriptul acoperă:
- T1: AI-only e neconfirmat;
- T2: ACL;
- T3: fără actor ⇒ refuz;
- T4: motiv, tip sau amprentă stale ⇒ refuz;
- T5: confirmarea închide cerința, iar INSERT-ul direct e refuzat;
- T6: schimbarea sursei ⇒ confirmarea se invalidează;
- T7: poarta de depunere blochează și mesajul numără cerințele AI-only;
- T8: exceptarea AI nu scade `fara_capitol`, confirmarea umană da.

## Rollback
Fișierul `supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana_ROLLBACK.sql` (marcaj de livrare `20261004b_ofertare_j02b_rollback`, același runner):
- reface `fn_gate_depunere` exact (postcondiție `md5(prosrc)=4bddf68c…`, verificat local);
- reface `v_ofertare_pt_stare` din copia salvată de migrare (postcondiție `md5=c77c49b8…`, `security_invoker=on`, ACL-ul de pe live, inclusiv `anon ALL` cum e acum);
- șterge obiectele noi;
- dacă există confirmări umane, tabelul **nu se șterge**: se redenumește în `ofertare_cerinte_na_confirmari_arhiva_j02b`, fără acces din aplicație.

## Raport READ-ONLY: cerințe închise doar de AI pe licitații active
Interogarea stă în `docs/J02B_RAPORT_READONLY.sql`. E doar SELECT și se poate rula și înainte, și după migrare. Licitație activă = status diferit de câștigată, pierdută sau abandonată.

Rezultat live, 30.09.2026:

| cale | licitație | status | cerințe | eliminatorii | cu `stare` de om fără amprentă |
|---|---|---|---|---|---|
| gate_nsa_ai | 3 | in_lucru | 60 | 60 | 0 |
| gate_nsa_ai | 5 | in_lucru | 336 | 107 | 108 |
| gate_nsa_ai | 15 | go | 629 | 74 | 0 |
| gate_nsa_ai | 93 (Jilava) | in_lucru | 218 | 27 | 0 |
| gate_nsa_ai | 103 (clonă Domnești) | in_lucru | 336 | 107 | 108 |
| pt_exceptat_ai | 93 (Jilava) | in_lucru | 36 | 0 | — |

Total: **1.579** cerințe închise în poarta de depunere doar de „nu se aplică” AI (375 eliminatorii) și **36** cerințe PT închise doar de „exceptat” AI (toate pe licitația 93).

## Incertitudini
- Amprenta documentului nu e un hash de conținut: în `ofertare_documente_atribuire` nu există coloană sha. O schimbare de conținut fără schimbare de cale, mărime, revizie, `procesat_la` sau mărime a textului nu ar invalida confirmarea. Hash-ul real vine cu J04 (#524).
- Testul SQL și migrarea **n-au rulat** pe o bază reală. Pre-verificările md5 cer obiectele exacte din producție. Au fost verificate read-only pe live:
  - ambele fragmente de înlocuire din view apar exact o dată;
  - view-ul rescris se parsează și dă aceleași cifre cu helperul = `true`;
  - expresia amprentei rulează;
  - reversul funcției dă exact md5-ul live.
- „Confirmare în bloc NO-GO” (verdictul pe #529) a fost aplicat și aici: excepția pe mai multe cerințe creează doar propuneri, iar fiecare rând se confirmă separat.
- Documentul de incident din 29–30.09 nu a fost găsit în repo și nici în `claude_context`. Specificația s-a luat din cerința reviewerului și din S05-02.
