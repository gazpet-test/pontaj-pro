# Porțile Izometrie: reconcilierea din 19.11.2026 (migrarea 20261230a)

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
Comentariile (ștampilele) nu sunt în amprenta globală; le acoperă POST-ul migrării (instantaneul tuturor funcțiilor și comentariilor).

**Revenirea** (`supabase/revenire/20261230a_…_ROLLBACK.sql`, plafon 2000) pune la loc corpul vechi și ștampilele vechi exact; porțile
redevin roșii (starea de dinainte), deci e doar pentru o problemă a migrării. O revenire mai veche care fixează corpul porții
(ex. `20261120a`) se rulează doar după ea.

**Probe:** `scripts/pglite/test_izometrie_porti_reconciliere_local.mjs` (poarta E2 reală pe o schemă falsă; istoria de pe producție
refăcută — aceleași semnale; aplicare, refuzuri PRE, mutanți, revenire, validatorul runnerului) și `src/izoPortiReconciliere.test.js`.

## Livrarea pe producție (procedura înlocuitoare a probei pe clonă) — de judecat în review

**Faptul:** proba pe clonă în forma cerută (manifest, ROLLBACK ×3, aplicare → revenire → reaplicare) **nu se poate face**. Definițiile
porților pun în amprentă oid-uri de rol (`relowner` / `proowner` brute, `polroles`), care diferă pe orice clonă; garda PRE 2 refuză deci
pe orice clonă (proba coordonatorului pe clona 176, 19.11.2026: definițiile clonei f13743e0… / c8e54134… / 7bdcbc9b… / e46e8a12… /
e99a4c45… față de cele de producție; plus stub-urile clonei: fără trigger-ul `on_auth_user_created`, fără RLS / politicile izo pe
`storage.buckets`). Simularea cu ROLLBACK pe clonă a confirmat logica: corpul nou are md5 `23da4c3c9e4639f3600197f3d7b88977`, iar
semnalele DEFINER / E2a / E3 / E3b / E4 / E4b dispar (rămâne doar semnalul stub-ului Storage, artefact al clonei).

**Procedura propusă** (pe PRODUCȚIE, prin runner; fiecare pas care atinge producția cere „da”-ul lui Răzvan; pașii a–b nu comit nimic):

0. *(doar citire)* `fn_izo_porti_lipsa()` = semnalele analizate (DEFINER + trigger-ul `on_auth_user_created` + cele 5 ștampile) și
   amprenta globală curentă (`scripts/amprenta_globala_citire.sh`) = GLOBAL.
1. **(a) manifestul L15, generat pe producție, în tranzacție cu ROLLBACK** (modul `--iesire` al generatorului aplică migrarea în forma
   livrării și dă ROLLBACK în locul COMMIT-ului; mesajul are alt alias, deci nu poate fi confundat cu o livrare):

   ```bash
   bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261230a_izometrie_porti_reconciliere.sql --versiune 20261230120000 \
     --tinta-host <H> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS producție> --user <U> --plafon-tranzactie-ms 5000 \
     --iesire supabase/migrations/20261230a_izometrie_porti_reconciliere.l15.tsv --detalii <în afara repo-ului>/20261230a.l15.detalii.txt
   diff <(grep -v '^#' supabase/tests/20261230a_izometrie_porti_reconciliere.l15.obiecte.tsv | sort) \
        <(grep -v '^#' supabase/migrations/20261230a_izometrie_porti_reconciliere.l15.tsv | cut -f1-3 | sort)   # gol
   ```

   Lista revizuită (`supabase/tests/20261230a_izometrie_porti_reconciliere.l15.obiecte.tsv`) = **exact un rând**: `functie
   public.fn_izo_porti_lipsa()` „schimbat”. În detalii, rândul are `md5(prosrc)` = `23da4c3c9e4639f3600197f3d7b88977` și aceleași
   owner / DEFINER / search_path / ACL ca înainte. Cele 5 ștampile nu apar (familia comentariilor nu e în amprenta globală) — le
   verifică POST-ul. **Abatere declarată:** antetul generatorului spune „generarea DOAR pe clonă”; aici e pe producție pentru că PRE-ul
   nu poate trece pe nicio clonă. Generarea nu comite nimic; ține lock-ul consultativ al runnerului cât durează (salvările Izometrie
   așteaptă, apoi continuă). Manifestul generat intră în PR (commit nou), înainte de aplicare.
2. **(b) proba `--compara-cu`, de 3 ori, cu ROLLBACK**, pe același GLOBAL:

   ```bash
   bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261230a_izometrie_porti_reconciliere.sql --versiune 20261230120000 \
     --tinta-host <H> … --plafon-tranzactie-ms 5000 --compara-cu supabase/migrations/20261230a_izometrie_porti_reconciliere.l15.tsv \
     --amprenta-globala <GLOBAL>
   ```

   De fiecare dată IDENTIC (cod 0); timpii din lista de la final (lock / sfârșit / LOCK_TINUT) sub plafonul de 5000 ms, notați.
3. **(c) aplicarea**, cu plafonul 5000 și amprenta globală:

   ```bash
   bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261230a_izometrie_porti_reconciliere.sql --aprobare aprobare_20261230a.txt \
     --versiune 20261230120000 --tinta-db postgres --tinta-sistem <SIS> --tinta-host <H> --tinta-port <P> --user <U> \
     --plafon-tranzactie-ms 5000 --amprenta-globala <GLOBAL din pasul b> \
     --diferente-globale supabase/migrations/20261230a_izometrie_porti_reconciliere.l15.tsv
   ```

4. **(d) POST** *(doar citire)*: `fn_izo_porti_lipsa() = '{}'`; md5 corp = `23da4c3c…`; fiecare ștampilă = definiția ei; apoi **o
   salvare Izometrie reală, făcută de un utilizator** (poarta nu mai refuză), Ctrl+Shift+R înainte.
5. **(e) revenirea pregătită, NU rulată**: comanda exactă din antetul `supabase/revenire/20261230a_…_ROLLBACK.sql` (`--sha256 <sha>
   --versiune 20261230120001 … --plafon-tranzactie-ms 2000`). Se rulează doar la o problemă a migrării; porțile redevin roșii.

**Ce NU dovedește procedura (riscuri reziduale, declarate):** aplicare → revenire → reaplicare pe un catalog Supabase real (revenirea e
probată doar în PGlite, cu substituenți pentru E3 / E3b / E4); serializarea concurentă cu salvările reale (lock-ul consultativ exclusiv al
runnerului față de cel partajat al API-ului Izometrie — mecanismul e al runnerului, neprobat aici); probele cu rolurile API pe catalogul
real (le acoperă, parțial, salvarea reală de la pasul d). O variantă „doar pentru clonă” a migrării NU e livrată: valorile clonei se
schimbă la alinierea stub-urilor (RLS / politicile `storage.buckets`, trigger-ul de pe `auth.users`), POST-ul `'{}'` cere oricum
alinierea, iar postcondițiile revenirii sunt valorile literale de producție — n-ar fi „același fișier cu alt BASELINE”, ci o a doua
migrare, cu sha256 diferit de cel aprobat. Se poate face, la cerere, după ce clona e aliniată (generatorul primește valorile clonei).

## Livrare 20.11.2026 00:03

Procedura de mai sus, rulată pe producție de coordonator, cu „da”-ul lui Răzvan (pașii a–b fără nimic comis):

| Pas | Rezultat | Timp (ms de la BEGIN, plafon 5000) |
|---|---|---|
| 0. GLOBAL înainte | `e300acd3b24b47fb379ba0b861b07c0c` (28245 rânduri) | — |
| a. manifestul L15, cu ROLLBACK | 1 obiect: `functie public.fn_izo_porti_lipsa()` „schimbat” = lista revizuită (diff gol); detaliul: md5 corp `23da4c3c9e4639f3600197f3d7b88977`, owner / SECURITY DEFINER / `search_path` / ACL ca înainte; GLOBAL după `819548e9f6971a36f135b06424d4e6b7` | **4890** |
| b. `--compara-cu` ×3, cu ROLLBACK | IDENTIC, cod 0, de fiecare dată pe același GLOBAL | **4468 / 4456 / 4474** |
| c. aplicarea (versiunea `20261230120000`) | sha256 aprobat; amprenta globală după = 1 diferență = manifestul; COMMIT; înregistrarea confirmată | **4254** |
| d. POST (doar citire) | `fn_izo_porti_lipsa() = '{}'` (verde) | — |

* Fișierele livrate, fixate de `src/izoPortiReconciliere.test.js` (sha256 pe textul fără CR): migrarea `47439660c3a7a306a78f709eda55791fda3fe50981ac8f0cdbd4d91d6401a7c0`,
  revenirea `f864110e78fad8bb588e3a7d9e73d1369e7ae9da891b083a4682540fc8a01e67`, manifestul
  `supabase/migrations/20261230a_izometrie_porti_reconciliere.l15.tsv` (generat la pasul a, copiat octet cu octet)
  `357c9989000bc325d4206b54d2681549a5ce03058d954f1bfd3d8707111dea83`. Detaliul canonic al manifestului rămâne material de review, în afara depozitului.
* **Rămâne de confirmat:** o salvare Izometrie reală, făcută de un utilizator (Ctrl+Shift+R înainte). Revenirea e pregătită, NErulată
  (porțile ar redeveni roșii).
* **Regula pentru migrările viitoare** (forma ritualului: PRE → schimbare → ștampile calculate → POST) și verificarea ei în CI:
  `docs/izometrie/PORTI_REGULA.md` (adusă de PR #1146). Orice migrare care atinge obiectele amprentate de porți (registrul `izo_*` /
  `fn_izo_*`, trigger-ele și politicile de pe tabelele Execuție citite de E4 / E4b, drepturile pe secvențele lor, listele revizuite ale
  porții E2) face ritualul — altfel salvarea Izometrie se blochează din nou, ca pe 19.11.
