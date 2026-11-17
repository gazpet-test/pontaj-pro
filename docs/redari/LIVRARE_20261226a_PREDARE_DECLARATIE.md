# Livrarea migrării 20261226a — Redări: declarația „predare” și opțiunea retrasă (NEAPLICATĂ)

Decizii ale proprietarului (17.11.2026): documentele vorbesc despre **predarea** terenului; semnarea de la distanță se face **doar
electronic**; opțiunea `nu_particip_cu_obiectii` nu se mai oferă pentru răspunsuri noi (răspunsurile vechi rămân valabile și afișabile).
PR-ul #1117 a schimbat șabloanele și ecranele; aceasta e partea de bază de date. Acordul pentru PREGĂTIRE: 17.11.2026. Aplicarea o face
coordonatorul, separat, cu acordul proprietarului.

## 1. Când se aplică: în ACELAȘI moment cu publicarea #1117

- #1117 publicat fără migrare: formularul spune „electronic” în titlu, dar declarația de dedesubt vine din BD și spune încă
  „prin poștă / electronic” (verdictul recenzentului pe #1117, P1). Iar codul retras e încă primit de server.
- Migrarea fără #1117: formularul vechi mai oferă opțiunea retrasă; serverul o refuză (`optiune_invalida`, mesajul general de eroare).
  Fără pierdere de date, dar experiență proastă.
- Ordinea recomandată, în aceeași fereastră liniștită: (1) aplicarea 20261226a prin runner; (2) imediat merge #1117 (deploy Vercel ~3 min);
  (3) Ctrl+Shift+R pe formularul public al proiectului de test. Migrarea SMS 20261226b se aplică în aceeași fereastră (documentul ei).

## 2. Ce face

| Ce | Cum |
|---|---|
| `red_proiecte.text_declaratie` | DEFAULT nou = „Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.”; rândurile cu EXACT vechea valoare implicită („… spre semnare, prin poștă / electronic.”) primesc textul nou; un text personalizat rămâne neatins. Postcondiție: niciun rând cu textul vechi. |
| Refuzul pe server | triggerul `fn_red_raspunsuri_valideaza` (BEFORE INSERT/UPDATE, orice cale: RPC public, operator prin API, `service_role`, alți producători, inclusiv e-mailul) refuză INSERT-ul cu `nu_particip_cu_obiectii` și UPDATE-ul care schimbă opțiunea CĂTRE el: 23514, „cine are obiectii vine la sesiune sau cere constatare pe teren”. Codul rămâne în CHECK; un rând vechi cu el se corectează în continuare (alt câmp). |
| RPC-ul public | `fn_red_raspuns_public` întoarce pentru codul retras refuzul EXISTENT `{ok:false, motiv:'optiune_invalida'}`, în același punct (după contoare, înainte de orice scriere): niciun motiv nou, niciun oracol nou, nicio schimbare în formular. |
| O singură definiție (L19) | `fn_red_optiune_retrasa(text)` — nouă, internă (fără drept de apel pentru roluri), chemată de trigger și de RPC. |

Ce NU face: nu schimbă denumirea proiectului și nicio altă dată; nu atinge CHECK-ul, ecranele, șabloanele, FAN, mailul.

## 3. Lock-uri, durată, risc

- `red_proiecte` **ACCESS EXCLUSIVE** (cerut de `ALTER COLUMN … SET DEFAULT`), NOWAIT, bugetul de 1 s de la prima încercare. Ținut până
  la COMMIT, inclusiv pasul „după” al runnerului (~1,3–1,6 s estimat pe producție, extrapolare): în acest interval **așteaptă și citirile**
  din `red_proiecte` — formularul public și ecranele Redări întârzie cu ~1,5 s. Implicit: INSERT în `red_jurnal` (ROW EXCLUSIVE).
- `red_raspunsuri` **nu** se blochează (`CREATE OR REPLACE FUNCTION` ia doar rândul din `pg_proc`; triggerul vede corpul nou de la COMMIT).
  Un răspuns inserat concurent înainte de COMMIT trece pe regula veche — ca înainte de migrare.
- Corpul migrării pe PGlite: sub 100 ms; tranzacția întreagă e dominată de cele două amprente globale (estimat ~2,5–2,8 s pe producție,
  sub plafonul de 5000 ms). Cifra reală: proba cu ROLLBACK pe țintă.

## 4. Revenirea (`supabase/revenire/20261226a_redari_predare_declaratie_ROLLBACK.sql`, plafon 2000, fără amprentă globală)

Corpurile EXACTE din 20261126a (amprentele `3528222d…` / `230aa93e…`), funcția nouă scoasă, DEFAULT-ul vechi. Rândurile: **evidența e
jurnalul existent** — fiecare UPDATE al migrării scrie singur în `red_jurnal` rândul vechi și cel nou (fără utilizator) și crește
`versiune`. Revenirea readuce DOAR proiectele al căror rând e IDENTIC cu `date_noi` din acel rând de jurnal (deci și aceeași versiune):
un proiect salvat între timp de un om (versiunea crește la orice salvare) sau creat după migrare cu DEFAULT-ul nou rămâne neatins și e
numărat în NOTICE. Fără refuz pe date (revenirea nu șterge nimic). Starea exactă a migrării e verificată înainte (corpuri, proprietăți,
ACL, DEFAULT, trigger, CHECK), altfel refuz.

## 5. Probe

- Local, rulate: `node scripts/pglite/test_redari_predare_declaratie_local.mjs` — PASS (validatorul real; aplicarea ca la livrare cu pașii
  L15 v2 generați — manifestul = 4 obiecte din `supabase/tests/20261226a_redari_predare_declaratie.l15.obiecte.tsv`; comportamentul pe
  fiecare cale; aplicare → revenire → reaplicare → revenire; 15 refuzuri ale migrării, 6 ale revenirii; 8 mutanți + mutantul revenirii).
- `python3 scripts/test_livrare_validator_plafon.py` (validatorul acceptă migrarea cu 5000 și o refuză cu 2000 / fără plafon; revenirea cu 2000).
- NU dovedesc: PostgreSQL 17 real, runnerul real, concurența (alt client ținând `red_proiecte`), producția. Pașii de mai jos.

## 6. Comenzile coordonatorului (clonă adusă la starea producției; producția doar cu acordul owner-ului)

```bash
# 1. citirea pe producție (o fotografie, fără DDL concurent)
bash scripts/amprenta_globala_citire.sh --tinta-host <H> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS> --user <U> --lista \
  --radacina 'public.fn_red_raspuns_public(text,text,date,text,boolean,text)' --radacina 'public.fn_red_raspunsuri_valideaza()' \
  > citire_prod_20261226a.txt
# 2. manifestul + detaliile pe clonă (ROLLBACK, nimic comis); lista de obiecte -> diff gol (4 obiecte)
bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261226a_redari_predare_declaratie.sql --versiune 20261226120000 \
  --tinta-host <clona> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS clona> --user <U> --plafon-tranzactie-ms 5000 \
  --iesire supabase/migrations/20261226a_redari_predare_declaratie.l15.tsv --detalii <în afara repo-ului>/20261226a.l15.detalii.txt
diff <(grep -v '^#' supabase/tests/20261226a_redari_predare_declaratie.l15.obiecte.tsv | sort) \
     <(grep -v '^#' supabase/migrations/20261226a_redari_predare_declaratie.l15.tsv | cut -f1-3 | sort)
bash scripts/amprenta_globala_citire.sh --tinta-host <clona> … --lista --radacina … > citire_clona_20261226a.txt
# 3. comparabilitatea -> COMPARABIL (0)
bash scripts/l15_compara_liste.sh --a citire_clona_20261226a.txt --b citire_prod_20261226a.txt \
  --manifest supabase/migrations/20261226a_redari_predare_declaratie.l15.tsv
# 4. pe clonă: aplicare -> revenire -> reaplicare (ca la 20261220a, pasul 4), apoi verificările SQL de mai jos
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261226a_redari_predare_declaratie.sql --aprobare aprobare_20261226a.txt \
  --versiune 20261226120000 --tinta-db postgres --tinta-sistem <SIS clona> --tinta-host <clona> --tinta-port <P> --user <U> \
  --plafon-tranzactie-ms 5000 --amprenta-globala <GLOBAL clona> --diferente-globale supabase/migrations/20261226a_redari_predare_declaratie.l15.tsv
bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261226a_redari_predare_declaratie_ROLLBACK.sql --sha256 <sha256> \
  --versiune 20261226120001 --tinta-db postgres --tinta-sistem <SIS clona> --tinta-host <clona> --tinta-port <P> --user <U> --plafon-tranzactie-ms 2000
# 5. în ziua livrării: recitirea + partea revizuită identică; apoi proba cu ROLLBACK pe țintă (acordul owner-ului), apoi aplicarea
bash scripts/l15_compara_liste.sh --a citire_prod_20261226a.txt --b citire_ziua_20261226a.txt --recitire
bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261226a_redari_predare_declaratie.sql --versiune 20261226120000 \
  --tinta-host <H> … --plafon-tranzactie-ms 5000 --compara-cu supabase/migrations/20261226a_redari_predare_declaratie.l15.tsv \
  --amprenta-globala <GLOBAL din citire_ziua_20261226a.txt>
```

Rezultatul așteptat: manifestul = cele 4 obiecte (`coloana public.red_proiecte.text_declaratie` schimbat; `functie
fn_red_optiune_retrasa(text)` creat; `fn_red_raspuns_public(…)` și `fn_red_raspunsuri_valideaza()` schimbate); aplicarea = cod 0, cu
NOTICE-urile `20261226a: lock la … (1 incercari …)`, `20261226a: declaratia: N proiecte schimbate (id cod versiune: …), M cu text
personalizat neatinse` (de consemnat în jurnalul livrării: e evidența revenirii), `PLAFON_TIMP … (plafon 5000 ms)`, `LOCK_TINUT …`; revenirea
= cod 0, `N proiecte readuse …; 0 proiecte raman cu textul nou`. Verificări SQL după aplicare (doar citire):

```sql
SELECT count(*) FILTER (WHERE text_declaratie LIKE '%prin poștă / electronic.') AS vechi, count(*) AS total FROM public.red_proiecte; -- vechi = 0
SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
 WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie';                                            -- textul NOU
SELECT has_function_privilege('anon', 'public.fn_red_optiune_retrasa(text)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.fn_red_optiune_retrasa(text)', 'EXECUTE');                                 -- f, f
```

Proba de comportament pe clonă (NU pe producție; în tranzacție anulată, pe un deținător al proiectului de test): `BEGIN; INSERT INTO
public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('<detinator test>', 'telefon', 'nu_particip_cu_obiectii', 'x');
ROLLBACK;` → `23514 … cine are obiectii vine la sesiune sau cere constatare pe teren`.

## 7. Lecții aplicate (L01–L25)

L06 ordinea lock-urilor în antet (un singur lock); L07 regula în triggerul BEFORE pe orice cale; L14 o tranzacție, postcondiții, revenire
testată aplicare → revenire → reaplicare; L15 v2 amprenta globală + manifest; L18 refuzul codului retras = eroare clară, nu tăcere; L19
`fn_red_optiune_retrasa` = o singură definiție; L20 căile legitime probate (rândul vechi corectat, celelalte trei opțiuni); L25 așteptări
scrise de mână, roluri reale (anon / authenticated / service_role / postgres), mutanți. Restul: n/a (detaliat în raportul livrării).
