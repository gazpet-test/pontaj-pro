# Porțile Izometrie: reconcilierea din 19.11.2026 și regula pentru migrările viitoare

Porțile Izometrie (`fn_izo_porti_lipsa()` = E2a, care cheamă și E3 / E3b / E4 / E4b) verifică, la fiecare salvare / activare, că
schema pe care se sprijină registrul e cea revizuită. Fiecare poartă își compară **definițiile** de acum (`fn_izo_porti_*_definitii()`, un
md5 peste corpuri de funcții, drepturi, trigger-e, politici, coloane, secvențe, roluri) cu **ștampila** pusă la migrare
(`COMMENT ON FUNCTION … IS 'porti*=<md5>'`). Orice diferență = poarta roșie = salvarea refuzată (fail-closed, intenționat).

## Reconcilierea din 19.11.2026 (TKT-2026-0393, migrarea `20261230a_izometrie_porti_reconciliere`)

**Simptomul:** salvarea în Izometrie refuzată pe producție; porțile E2 / E3 / E3b / E4 / E4b roșii.

**Cauza** (analiza coordonatorului pe producție, doar citire): ștampilele au fost puse ultima dată de `20261120a`. După ea s-au aplicat
trei migrări legitime din repo, din alte module, care au schimbat obiecte amprentate de porți fără să refacă ștampilele:

| Migrarea | Ce a schimbat | Porțile atinse |
|---|---|---|
| `20261209a_executie_acces_proiect` | trigger-ul `trg_executie_acces_garda` pe `executie_tevi` / `executie_pachete_lansare` / `executie_pachete_documente` / `executie_tronsoane`; 4 politici RESTRICTIVE `executie_acces_*` pe `executie_proiecte` și `executie_tronsoane` | E4, E4b |
| `20261211a_executie_fibra_optica` | trigger-ul `trg_executie_fibra_garda_tronson` pe `executie_tronsoane` | E4 |
| `20261218a_securitate_anon_drepturi` | drepturile `anon` retrase de pe secvențe (între ele `magazie_bucati_id_seq` și secvențele documentelor izo) | E2a, E3, E3b, E4b |

Fiecare ștampilă se reconstruiește **exact** din starea de azi cu aceste schimbări scoase: nicio diferență neexplicată, deci nicio
schimbare manuală. Plus două semnale ale porții E2 care nu sunt ștampile, ambele fals-pozitive cunoscute ale euristicii închiderii:

1. excepția revizuită a trigger-ului `on_auth_user_created` (auth.users → `handle_new_user()`) poartă amprenta corpului; `20261119a`
   (Portal E1-1b) a rescris corpul ⇒ excepția a căzut. Amprenta nouă `b1858fddd590635b445127fd6c680d97` (refăcută și din corpul din repo).
2. porțile portalului `fn_portal_porti_lipsa()` / `fn_portal_porti_lipsa_1b()` intră ca „SQL dinamic” din cauza literalului
   `'EXECUTE'` din `has_function_privilege`. Ca `fn_conturi_inchideri_sweep`, trec pe lista revizuită `c_dinamice_revizuite`, cu amprenta
   `md5(prosrc | proconfig | owner | proacl | prosecdef)`; `fn_portal_1b_snapshot()` iese apoi singură din închidere.

**Ce face `20261230a`** (o tranzacție, prin runner, plafon 5000 + amprenta globală L15 v2):

1. gărzi PRE: cele 5 ștampile stocate, cele 5 definiții de acum, corpul + proprietățile + ACL-ul porții E2, corpurile
   `fn_izo_porti_definitii` / `fn_izo_porti_e3_lipsa` / `fn_izo_porti_e4_lipsa`, amprenta trigger-ului și a porților portalului = valorile
   analizate (altfel refuz, nimic schimbat);
2. `CREATE OR REPLACE fn_izo_porti_lipsa()` = corpul de pe producție (`20261109b`) cu **exact** cele două schimbări de listă (generat de
   `scripts/izometrie/reconciliere/gen_20261230a.mjs`; testul refăce diff-ul pe linii);
3. cele 5 ștampile refăcute, **după** corp (E2a și E4b includ corpurile `fn_izo_*`);
4. gărzi POST: corpul nou cu aceleași proprietăți și același ACL, fiecare ștampilă = definiția ei, E3 / E3b / E4 = exact definițiile de
   dinainte, restul funcțiilor și toate celelalte comentarii neschimbate, `fn_izo_porti_lipsa() = '{}'`.

De ce doar cu amprenta globală: refacerea ștampilelor acceptă catalogul din momentul ei. Pasul „după” al runnerului (diferența = exact
manifestul, o singură linie: `functie public.fn_izo_porti_lipsa()` „schimbat”) refuză orice altă schimbare apărută în aceeași tranzacție.

**Revenirea** (`supabase/revenire/20261230a_…_ROLLBACK.sql`, plafon 2000) pune la loc corpul vechi și ștampilele vechi exact; porțile
redevin roșii (starea de dinainte), deci e doar pentru o problemă a migrării. O revenire mai veche care fixează corpul porții
(ex. `20261120a`) se rulează doar după ea.

**Probe:** `scripts/pglite/test_izometrie_porti_reconciliere_local.mjs` (poarta E2 reală pe o schemă falsă; istoria de pe producție
refăcută — aceleași semnale; aplicare, refuzuri PRE, mutanți, revenire, validatorul runnerului) și `src/izoPortiReconciliere.test.js`.

## REGULA pentru migrările viitoare (de la 20261230a)

**Orice migrare care atinge un obiect amprentat de porțile Izometrie** rulează porțile și reface ștampilele **în aceeași tranzacție**:

* obiectele amprentate (lista nu e exhaustivă — sursa sunt corpurile `fn_izo_porti_*_definitii()`): `executie_tevi`, `executie_tronsoane`,
  `executie_pachete_lansare`, `executie_pachete_documente`, `executie_proiecte`, `executie_bonuri_consum_linii`, `logistica_depozite`,
  `profiles`, `magazie_bucati*`, toate tabelele / vederile / funcțiile `izo_*` / `fn_izo_*`, **secvențele** din schema `public` (drepturile
  lor), `storage.objects` / `storage.buckets` (RLS, ACL, politicile `izo_*`), rolurile `izo_*`;
* „atinge” = trigger-e, politici, coloane, constrângeri, indexuri, drepturi (GRANT / REVOKE, inclusiv `ON ALL … IN SCHEMA public`),
  owner, RLS, corpul / drepturile / `search_path` al funcțiilor `fn_izo_*`.

Forma (tiparul `20261120a`):

1. **înainte**: `IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION …` — porțile trebuie să fie verzi
   înainte (altfel migrarea ar „binecuvânta” o schimbare neanalizată); o migrare de reconciliere fixează în schimb starea roșie analizată
   (ștampile + definiții, ca `20261230a`);
2. schimbarea;
3. **ștampilele**, după schimbare, toate cinci:
   `EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());` (la fel
   `porti_e3`, `porti_e3b`, `porti_e4`, `porti_e4b`);
4. **după**: `IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION …`;
5. livrarea cu amprenta globală L15 v2 (manifestul arată exact ce s-a schimbat); revenirea reface ștampilele de dinainte, exact.

Dacă o schimbare face poarta roșie din alt motiv decât ștampila (un semnal al închiderii citirilor, o listă revizuită), corecția porții
intră în aceeași migrare, cu review (ca `20261230a`), nu se ocolește.

**Verificarea automată:** `src/izoPortiRegula.test.js` (vitest, CI) caută în migrările de la `20261230a` încolo instrucțiunile care ating
obiectele de mai sus și cere, pentru fiecare astfel de migrare, apelul porții cu `'{}'` și cele 5 ștampile refăcute. Excepția (schimbare
dovedit în afara componentelor amprentate) se declară în migrare cu un rând `-- IZO_PORTI: neatins — <motivul>`, care intră în review.
Testul e o plasă de siguranță textuală (fail-closed, fals-pozitive acceptate), nu o dovadă: sursa adevărului rămâne poarta pe clonă.

## Ce verifică chat-ul pe clonă (înainte de aplicare)

1. clona adusă la starea producției: `fn_izo_porti_lipsa()` întoarce aceleași semnale ca producția (cele 2 ale porții E2 + ștampilele
   E2a / E3 / E3b / E4 / E4b);
2. manifestul `20261230a_izometrie_porti_reconciliere.l15.tsv` generat cu `scripts/livrare_l15_manifest.sh --plafon-tranzactie-ms 5000`
   (așteptat: o linie, `functie public.fn_izo_porti_lipsa()` „schimbat”);
3. aplicarea prin runner (plafon 5000 + `--amprenta-globala` + `--diferente-globale`): toate porțile verzi; timpii (garda finală, cele două
   calcule ale amprentei, poarta); apoi revenirea (plafon 2000) → aceleași semnale ca înainte → re-aplicarea;
4. o salvare Izometrie pe proiectul de test după aplicare (poarta nu mai refuză).
