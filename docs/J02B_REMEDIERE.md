# J02b — „nu se aplică” / „exceptat” doar cu confirmare umană (DRAFT, NEAPLICAT)

**Stare:** draft, runda 2 (după NO-GO Copilot r1). Nimic nu e aplicat în BD, nimic nu e mergeuit.
**PR:** #554, branch `claude/erp-continuare-x4p5a7-j02b`.
**Legătură audit:** S05-02 (FALSE_GREEN critic), extins la matricea PT (legături `exceptat` cu `sursa='ai'`).

## Pragul de apply (runda 2)
- **Apply-ul se face DUPĂ depunerea Jilava CONFIRMATĂ în SEAP (06.10.2026)**, nu pe 02.10. Până atunci sunt permise doar:
  citiri read-only, testele locale și lista de reconfirmare (`docs/J02B_RAPORT_READONLY.sql`).
- Derogarea J05 **nu** se folosește pentru a grăbi J02b.
- Ordinea la apply, într-o singură fereastră:
  1. preflight live read-only: amprentele din §0 al migrării (helper, poartă, view) + raportul read-only;
  2. BD: `scripts/livrare_migrare.sh` (vezi „Aplicare”);
  3. UI imediat după (merge PR, Vercel ~3 min). Fără view-ul nou, UI-ul e fail-closed și arată toate „nu se aplică”/„exceptat” ca deschise;
  4. smoke: un cont cu modulul Ofertare (vede badge-urile, confirmă o cerință de test, poarta o vede închisă) și un cont fără modul
     (confirmarea refuzată, amprenta NULL, nimic închis);
  5. revalidare controlată: lista de reconfirmare trece pe la oameni, cerință cu cerință (nu în bloc).

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
- **propunerea concretă** pe care o validează (runda 2): id-ul + amprenta rândului întreg (`md5(to_jsonb(rând))`);
- **momentul**: `confirmat_la`.

Validă doar cât: nerevocată ∧ amprenta sursei = cea curentă ∧ propunerea curentă = cea confirmată. Se calculează la citire
(`fn_ofertare_na_confirmare_valida`, folosită de poartă, de view-ul PT și de view-ul UI), deci se **invalidează automat**
când textul cerinței, documentul sursă sau propunerea se schimbă, fără trigger și fără job. Confirmarea pe o amprentă sau o propunere
veche e refuzată (`40001`). „Nu se aplică” sau „exceptat” scris de AI rămâne **propunere**: se vede în UI (badge portocaliu), dar cerința rămâne deschisă.
`ofertare_cerinte.stare='nu_se_aplica'` fără confirmare cu amprentă (decizii vechi) **nu mai închide nimic**. Omul trebuie să reconfirme.

### Semantica aleasă: „confirmarea validează o propunere concretă” (decizie Răzvan)
- `exceptat_pt`: RPC-ul cere legătura `ofertare_pt_legaturi` `fel='exceptat'` a cerinței (`p_propunere_id`) și memorează `legatura_id` + amprenta ei.
  Propunerea curentă = legătura `exceptat` cea mai nouă (id maxim). O legătură nouă B după A ⇒ neconfirmată; o editare a legăturii confirmate ⇒ neconfirmată.
- `nu_se_aplica`: dacă există un rând `ofertare_acoperire.status='nu_se_aplica'`, confirmarea se leagă de cel mai nou (`acoperire_id` + amprentă);
  dacă nu există niciunul, confirmarea se leagă de „nicio propunere” (`acoperire_id` NULL). O propunere AI nouă (sau una apărută după decizia umană) nu moștenește confirmarea veche.
- **Alternativa, neimplementată: „declarație umană autonomă”.** Omul declară „nu se aplică” pe versiunea sursei, indiferent ce propune AI-ul;
  o re-rulare AI nu ar redeschide cerința. Mai puțină muncă de reconfirmare după re-rulări, dar AI-ul poate schimba propunerea (alt motiv, altă legătură)
  fără ca omul s-o vadă. **Decizia îi aparține lui Răzvan**; până atunci rămâne semantica strictă (fail-closed).
- Consecință practică a semanticii alese: o re-rulare a motorului de acoperire care rescrie rândurile `nu_se_aplica` (id nou sau conținut schimbat) redeschide cerințele confirmate — comportament voit (r3), motorul nu se modifică.

### Duplicate și revocare
- Index unic parțial `ofertare_na_conf_activa_uq (cerinta_id, tip, amprenta_sursa, legatura_id, acoperire_id, amprenta_propunere) WHERE revocata_la IS NULL`.
- Confirmarea e **idempotentă**: aceeași cerință/tip/sursă/propunere activă ⇒ RPC-ul întoarce id-ul existent (motivul primei confirmări rămâne).
- Revocarea (autorul sau ownerul, cu motiv) marchează rândul; cerința se redeschide. Reconfirmarea după revocare sau după schimbarea amprentei e permisă (rând nou).

## Obiecte afectate
| Obiect | Schimbare |
|---|---|
| `ofertare_cerinte_na_confirmari` | **NOU**. RLS; `authenticated` și `service_role` **doar SELECT** (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN = false), `anon` nimic, PUBLIC nimic, 0 ACL pe coloane. Scriere doar prin funcțiile SECURITY DEFINER. Coloane noi r2: `legatura_id`, `acoperire_id`, `amprenta_propunere` |
| `ofertare_na_conf_activa_uq` | **NOU**. Index unic parțial pe confirmările active |
| `ofertare_j02b_rollback_def` | **NOU**. Copia definiției live a `v_ofertare_pt_stare`, pentru revenire exactă; RLS, niciun rol în afară de proprietar |
| `fn_ofertare_cerinta_amprenta(bigint)` | **NOU**. SECURITY DEFINER, STABLE; NULL pentru un utilizator fără acces Ofertare (fail-closed) |
| `fn_ofertare_na_propunere_curenta(bigint,text)` | **NOU r2**. Propunerea curentă (id maxim) + amprenta rândului |
| `fn_ofertare_na_confirmare_valida(bigint)` | **NOU r2**. Sursa unică a regulii de validitate |
| `fn_ofertare_cerinta_na_confirmata(bigint,text)` | **NOU**. Există o confirmare validă? |
| `ofertare_confirma_neaplicabil(bigint,text,text,text,bigint)` | **NOU**. RPC: actor = `auth.uid()`, acces Ofertare, motiv, tip, cerință activă, `FOR UPDATE`, amprenta văzută = curentă, propunerea văzută = curentă, idempotent. EXECUTE doar `authenticated` |
| `ofertare_revoca_neaplicabil(bigint,text)` | **NOU**. RPC: revocare cu motiv, de autor sau owner. EXECUTE doar `authenticated` |
| `v_ofertare_cerinte_na_stare` | **NOU**. `security_invoker=on`, cu `valida`, `legatura_id`, `acoperire_id` |
| `fn_gate_depunere()` | **ÎNLOCUIT**, după pre-verificare: md5 `4bddf68c…`, proprietar `postgres`, plpgsql, SECDEF, search_path, ACL EXECUTE exact `postgres`+`service_role`. Ramura `a.status='nu_se_aplica'` devine `fn_ofertare_cerinta_na_confirmata(c.id,'nu_se_aplica')`; mesajul primește contorul „din ele N au doar «nu se aplică» propus de AI”. Postcondiție: md5 `04102c5e…` (r5; r1–r4: `59b42d41…`) + proprietar + ACL neschimbate |
| `v_ofertare_pt_stare` | **ÎNLOCUIT**, cu pre-verificare `md5(viewdef)=c77c49b8…`: `exceptata` cere și confirmare `exceptat_pt` validă; coloană nouă: `exceptate_propuse_ai` |
| `src/ofertareNeaplicabil.js` (+ test) | Regula JS, fail-closed; r2: `propunereCurenta` (id maxim, ca în BD) |
| `src/OfertareLicitatii.jsx` | contoare, badge-uri, buton „✓ Confirm «nu se aplică»”; r2: trimite `p_propunere_id` = rândul AI văzut |
| `src/OfertarePropunere.jsx` | filtre/badge-uri prin `stareExceptarePT`; buton „✓ Confirm exceptarea”; r2: trimite legătura văzută (la excepția pe o singură cerință, legătura tocmai creată) |
| `src/ofertarePoarta.js` | detaliul rândului „Cerințe fără capitol” arată `exceptate_propuse_ai` |

Precondiția pe `fn_are_acces_ofertare()` are amprenta EXACTĂ din 20261004b: proprietar `postgres`, `sql`, `proconfig = {search_path=public, pg_temp}`,
SECDEF, STABLE, `boolean`, 0 argumente, fără overload în nicio schemă, md5 `429d28e2a61fb24c8009d67050c16c85`, ACL EXECUTE exact `authenticated`/`postgres`/`service_role`, fără PUBLIC.

Toate funcțiile noi sunt SECURITY DEFINER cu `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`
(default privileges Supabase le dau EXECUTE tuturor), apoi GRANT minim; postcondiția verifică ACL-ul exact pe fiecare.
Nicio scriere directă în tabel din `src/`, `supabase/functions/`, `worker/` (verificat și de harness).

## Efect estimat după apply (fără confirmări noi)
- Poarta de depunere: cele **1.579** cerințe din raportul de mai jos devin „fără acoperire verificată” (375 eliminatorii). Licitațiile active nu se mai pot depune fără confirmare umană cerință cu cerință sau fără derogarea owner (J05).
- Poarta PT, licitația 93: `exceptate` scade de la 36 la 0, `fara_capitol` crește de la 0 la 24, iar restul de 12 apar ca `dovada_de_verificat`.
  La 5 și la 103: câte 1 cerință. Simulat read-only pe live, înlocuind helperul cu `false`.
- Cele 2 exceptări `sursa='om'` existente și cele 216 `stare='nu_se_aplica'` de om (108 pe licitația 5 și 108 pe 103) trebuie **reconfirmate** cu amprentă.

## Aplicare (după depunerea Jilava confirmată, GO Copilot și acordul lui Răzvan)
Runnerul oficial `scripts/livrare_migrare.sh` și validatorul (`scripts/livrare_validator.py`) sunt pe branch-ul `claude/erp-continuare-x4p5a7-sec-rsvti` și **nu sunt încă pe main**.
```bash
python3 scripts/livrare_validator.py supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana.sql
sha256sum supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana.sql
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261004a_ofertare_j02b_na_confirmare_umana.sql \
     --sha256 <sha256 de mai sus> --versiune 20261004000100 --tinta-db postgres --tinta-sistem <system_identifier> \
     --tinta-host <H> --tinta-port <P>
```
Migrarea nu are BEGIN/COMMIT; garda de livrare `gazpet.livrare_migrare = '20261004a_ofertare_j02b_na_confirmare_umana:' || txid_current()` e verificată
la start și la final (după postcondiții) și refuză orice altă cale: `apply_migration`, `execute_sql`, `psql -f` simplu.

## Revenire
`supabase/revenire/20261004a_ofertare_j02b_na_confirmare_umana_ROLLBACK.sql` — **nu e migrare** (nu o parcurge niciun runner), armare proprie, doar cu acordul lui Răzvan:
```sql
BEGIN;
SELECT set_config('gazpet.revenire_20261004a', 'REVINE_J02B:' || txid_current(), true);
\i supabase/revenire/20261004a_ofertare_j02b_na_confirmare_umana_ROLLBACK.sql
COMMIT;
```
- reface `fn_gate_depunere` exact (postcondiție md5 `4bddf68c…` + proprietar + ACL `postgres`/`service_role`);
- reface `v_ofertare_pt_stare` din copia salvată de migrare (postcondiție `md5=c77c49b8…`, `security_invoker=on`, ACL-ul de pe live);
- șterge obiectele noi;
- dacă există confirmări umane, tabelul **nu se șterge**: se redenumește în `ofertare_cerinte_na_confirmari_arhiva_j02b`, fără acces pentru `anon`/`authenticated`/`service_role`.

## Teste
- **Local, determinist:** `node scripts/test_j02b_na_confirmare.mjs` (PG17 local, fără live) — **76/76 OK** (runda 3). Construiește schema minimă cu helperul și poarta
  EXACTE (md5 live) și default privileges ca Supabase; singura substituție e md5-ul view-ului live → md5-ul view-ului local. Acoperă: gărzi de livrare/revenire,
  14 drift-uri de precondiție (helper: corp, anon, PUBLIC, VOLATILE, search_path, proprietar, overload; poartă: authenticated, service_role, proprietar, corp),
  testul SQL de mai jos, ACL-ul cerut de Copilot (verificat independent + REST simulat pentru `service_role`/`authenticated`/`anon`), poarta cap-coadă
  (cont fără modul refuzat, cont cu modul confirmă ⇒ depunerea trece, revocare ⇒ blochează), revenire + re-livrare, grep „nicio scriere directă”.
  Mutanții verificați: validitate fără legătură (prins de T8 replay), `GRANT ALL` pentru `service_role` (prins de postcondiție), validitate „nu se aplică” fără propunere (prins de T5d).
- **Pe clonă/branch Supabase:** `psql "$PGURI" -X -v ON_ERROR_STOP=1 -f supabase/tests/j02b_na_confirmare_test.sql` (BEGIN…ROLLBACK). Fixture-ul lipsă pe 103 ⇒ **FAIL**, nu SKIP.
  T1 AI-only neconfirmat; T2 ACL; T3/T3b fără actor, `service_role` nu scrie; T4 motiv/tip/amprentă/propunere stale; T5 confirmare + scriere directă refuzată;
  T5b idempotentă; T5c revocare ⇒ false, reconfirmare; T5d propunere AI nouă nu moștenește; T5e decizie fără AI, apoi AI ⇒ invalidă;
  T6 sursă schimbată ⇒ invalidă, reconfirmare pe amprenta nouă; T7 poarta blochează și numără AI-only; T8 PT: AI nu închide, A confirmată închide, B nouă ⇒ deschisă, editare ⇒ deschisă.
- `npx vitest run` 1064/1064, `npx vite build` OK.

## Runda 2 (NO-GO Copilot r1 → schimbare → test)
| # | Blocant r1 | Schimbare | Test |
|---|---|---|---|
| 1 | `service_role` avea `GRANT ALL` pe tabel ⇒ scriere directă ocolind RPC-ul | `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role; GRANT SELECT … TO authenticated, service_role`; secvența și copia de revenire fără niciun rol; RPC-urile fără `service_role`; postcondiție pe cele 7 privilegii × 2 roluri, anon 8, PUBLIC brut, 0 ACL coloane | harness §5 (16 verificări) + T2/T3b; mutantul `GRANT ALL service_role` e prins |
| 2 | Replay PT: confirmarea `exceptat_pt` era pe cerință, deci o legătură nouă AI o moștenea | Confirmarea memorează `legatura_id`/`acoperire_id` + `amprenta_propunere`; validă doar pe propunerea curentă (id maxim + amprentă); RPC-ul cere propunerea văzută | T4 (propunere stale/străină), T5d, T5e, T8 (A→B, editare); mutanții prinși |
| 3 | Duplicate / revocare nespecificate | Index unic parțial pe confirmările active; RPC idempotent; revocare ⇒ false; reconfirmare permisă după revocare sau amprentă nouă | T5b, T5c, T6; harness §6 |
| 4 | Revenirea stătea în `supabase/migrations/` (risc să fie rulată de runner) | Mutată în `supabase/revenire/`, armare `gazpet.revenire_20261004a` start/final; migrarea fără BEGIN/COMMIT, gardă start/final | harness §2 și §7 |
| 5 | Precondiția pe `fn_are_acces_ofertare()` doar md5; poarta doar md5; T8 putea ieși SKIP | Amprenta exactă ca în 20261004b + overload; poarta: proprietar + limbaj + SECDEF + search_path + ACL exact (pre și post); T8 cu fixture obligatoriu | harness §3 (14 drift-uri), „fixture lipsă ⇒ FAIL” |
| 6 | Pragul de apply 02.10 | După depunerea Jilava confirmată (SEAP 06.10.2026); secvența preflight → BD → UI → smoke → revalidare; fără J05 | doc |

## Runda 3 (Copilot: GO pe logica r2, NO-GO pe livrare pentru 2 întăriri)
| # | Cerință | Schimbare | Test |
|---|---|---|---|
| 1 | ACL **efectiv** pe RPC-urile umane (nu doar ACL-ul brut) | Postcondiția SQL cere `has_function_privilege` (include membership) pe `ofertare_confirma_neaplicabil(bigint,text,text,text,bigint)` și `ofertare_revoca_neaplicabil(bigint,text)`: authenticated → true, anon → false, service_role → false | harness: `SET ROLE service_role/anon/authenticated` + `has_function_privilege`; mutanți `GRANT authenticated TO service_role`, anon membru în authenticated, rol intermediar cu EXECUTE al cărui membru e service_role ⇒ refuz |
| 2 | Amprenta exactă a `trg_gate_depunere`, pre și post | `md5(pg_get_triggerdef(oid, true)) = 35e7d6a7f7d488556be1df754c26124f` (textul live: `CREATE TRIGGER trg_gate_depunere BEFORE INSERT OR UPDATE ON ofertare_licitatii FOR EACH ROW EXECUTE FUNCTION fn_gate_depunere()`), cu `search_path` fixat pe `public, pg_temp` în bloc (prefixul de schemă nu mai depinde de sesiune), `tgenabled='O'`, `NOT tgisinternal`, un singur trigger cu numele ăsta | harness: textul local = textul live exact; DISABLE, AFTER, `WHEN (false)`, doar UPDATE ⇒ refuz; reverificat după migrare |

### Precizări de semantică (acceptate de Copilot în r3)
- Semantica „confirmarea validează o propunere concretă” e **acceptată**.
- O re-rulare a motorului care rescrie rândurile `nu_se_aplica` **invalidează** confirmarea: comportament **voit**. Motorul nu se modifică.
- `p_propunere_id = NULL` la `nu_se_aplica` fără propunere AI = **confirmarea stării concrete „nicio propunere”**; se invalidează dacă apare ulterior o propunere.
- J02b **nu** rezolvă snapshot-ul dosarului la depunere (problemă separată, cunoscută).
- Raportul 1.579 / 375 **se rerulează în preflight** (`docs/J02B_RAPORT_READONLY.sql`); nu e un număr înghețat.

## Decizii pentru Răzvan
1. Ziua apply-ului (după 06.10) și cine face revalidarea listei de reconfirmare (numerele din preflight).
2. Alternativa „declarație umană autonomă” rămâne neimplementată; se redeschide doar la cererea lui Răzvan.

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
- Amprenta propunerii e pe rândul întreg (`to_jsonb`): orice coloană actualizată pe rândul AI (inclusiv câmpuri tehnice) invalidează confirmarea. Fail-closed, dar poate produce reconfirmări în plus.
- Migrarea n-a rulat pe schema reală: harness-ul local reproduce doar coloanele atinse, iar view-ul PT local e minim (conține exact fragmentele înlocuite). Testul SQL pe clonă inserează în `ofertare_acoperire` doar `(cerinta_id, status)`; dacă live are alte coloane NOT NULL fără default, fixture-ul trebuie completat.
- „Confirmare în bloc NO-GO” (verdictul pe #529) a fost aplicat și aici: excepția pe mai multe cerințe creează doar propuneri, iar fiecare rând se confirmă separat.
- Documentul de incident din 29–30.09 nu a fost găsit în repo și nici în `claude_context`. Specificația s-a luat din cerința reviewerului și din S05-02.

## Runda 5 — comutator pe licitație (decizia lui Răzvan 01.10.2026, varianta B)

**De ce:** aplicată pe toate licitațiile, J02b ar redeschide ~1.615 cerințe pe 5 licitații active (3, 5, 15, 93, 103).
Varianta B: regula se pornește licitație cu licitație, de un om, într-un singur sens.

**Ce face migrarea (aceeași, 20261004a):**
- `ofertare_licitatii.j02b_activ boolean NOT NULL DEFAULT true`. Licitațiile existente la apply primesc `false`.
  Nu se face cu UPDATE: coloana se adaugă cu `DEFAULT false`, apoi default-ul devine `true`. Astfel nu se rescrie niciun rând, nu pornesc triggerele și `updated_at` rămâne neatins. Postcondiția verifică numărul: toate cele N rânduri existente au `false`.
- `fn_gate_depunere`: `v_j02b = NEW.j02b_activ OR OLD.j02b_activ`. Pe `false`, interogarea `n_neacoperite` și mesajul sunt textual cele live (`4bddf68c…`). Pe `true`, se aplică regula J02b. md5 nou: `04102c5e…`.
- `v_ofertare_pt_stare`: `exceptata = EXISTS(exceptat) AND (NOT j02b_activ(licitație) OR confirmare umană validă)`. Dacă licitația lipsește, se consideră pornită (fail-closed).
- `fn_ofertare_j02b_activeaza(p_licitatie_id)` (SECDEF): cere `auth.uid()` + `fn_are_acces_ofertare()` + (owner **sau** `responsabil_id` = uid). Merge doar pe `false→true`; dacă e deja pornită, întoarce o eroare. Întoarce numărul de cerințe redeschise și scrie un rând în jurnalul `ofertare_j02b_activari` (UNIQUE pe licitație, doar SELECT pentru utilizatori).
- `fn_ofertare_j02b_impact(p_licitatie_id)`: întoarce câte cerințe se redeschid. Le numără pe cele cu „nu se aplică” AI fără dovadă și fără confirmare, plus cerințele PT exceptate fără capitol și fără confirmare. O folosește dialogul din UI.
- `trg_ofertare_j02b_sens_unic` (BEFORE INSERT OR UPDATE):
  - refuză `true→false` pe orice cale;
  - refuză `false→true` fără marcajul RPC-ului (`gazpet.j02b_activeaza = <id>:<txid>`);
  - refuză un INSERT cu `false`.
- ACL: pe cele 2 RPC-uri EXECUTE doar pentru `authenticated` (ACL brut, efectiv și graful SET ROLE, ca la celelalte RPC-uri umane).
- Postcondiție nouă: **verdictul porții nu se schimbă**. Înainte de orice modificare și după apply, se încearcă depunerea pe fiecare licitație nedepusă, într-o subtranzacție anulată. Se compară SQLSTATE și mesajul. Licitațiile 3, 5, 15, 93 și 103 trebuie să fie printre cele verificate.

**Matricea de stări**

| j02b_activ | „nu se aplică” AI la poartă | „exceptat” AI în v_ofertare_pt_stare | Tranziții permise |
|---|---|---|---|
| `false` (licitație existentă la apply) | închide cerința (regula live, mesaj identic) | exceptată (regula live); `exceptate_propuse_ai`=0 | → `true` doar prin RPC (owner/responsabil) |
| `true` (licitație nouă / pornită) | NU închide; cere confirmare umană validă | doar cu confirmare umană validă | niciuna (→ `false` refuzat) |
| INSERT | — | — | doar cu `true` (default) |

**UI** (`OfertareLicitatii.jsx`, tabul Cerințe, deasupra Acoperirii):
- `false`: banner „Confirmare umană pentru «nu se aplică» (J02b): OPRITĂ”. Butonul „Pornește J02b” apare doar la owner sau responsabil. Confirmarea spune câte cerințe se redeschid și că pasul e definitiv.
- `true`: badge.
- Coloana lipsă (migrare neaplicată): nu se afișează nimic.
- Logica pură e în `src/ofertareNeaplicabil.js` (`stareComutatorJ02b`, `poatePorniJ02b`, cu teste).

**Limite**
- Contoarele și badge-urile client-side din Acoperire/Propunere rămân pe regula J02b strictă și când comutatorul e oprit. UI-ul e mai conservator decât poarta: arată „AI: nu se aplică – neconfirmată”, dar poarta veche trece.
- Comutatorul în sens unic se poate ocoli de un superuser: `DISABLE TRIGGER`, `session_replication_role=replica` sau `set_config` pe marcaj din SQL editor. Din REST/PostgREST nu se poate ocoli (`set_config` nu e expus).
- Re-livrarea după revenire pune din nou `false` pe TOATE licitațiile, inclusiv pe cele pornite între timp. Jurnalul vechi rămâne în `ofertare_j02b_activari_arhiva`, iar re-livrarea e refuzată cât arhiva există.
- Postcondiția de verdict execută o încercare de depunere pe fiecare licitație nedepusă (~60 pe live). Încercarea e anulată, dar triggerele BEFORE/AFTER pe `ofertare_licitatii` rulează. Pe live sunt doar `a00_ofertare_licitatii_scriere` și `trg_gate_depunere`, citite read-only pe 01.10.
- sha256 migrare r5: `2dcd168f4cbefbd97bbf6f4f65944cd83b5883224f8cf5256ea8e61167f8d5fd`.

**Teste r5:**
- harness `scripts/test_j02b_na_confirmare.mjs` pe PG17 local, cu secțiunea 5b nouă și pre/rollback extinse;
- `supabase/tests/j02b_na_confirmare_test.sql`, cu T0 nou: pornire pe 103 prin RPC și `true→false` refuzat;
- vitest `src/ofertareNeaplicabil.test.js`.
