# Livrarea migrării 20261226a — Redări: declarația „predare” și opțiunea retrasă (NEAPLICATĂ)

Decizii ale proprietarului (17.11.2026): documentele vorbesc despre **predarea** terenului; semnarea de la distanță se face **doar
electronic**; opțiunea `nu_particip_cu_obiectii` nu se mai oferă pentru răspunsuri noi (răspunsurile vechi rămân valabile și afișabile).
PR-ul #1117 a schimbat șabloanele și ecranele; PR-ul #1119 (acesta) are partea de bază de date (20261226a + 20261226b) și constanta JS a
SMS-ului. Acordul pentru PREGĂTIRE: 17.11.2026. Aplicarea o face coordonatorul, separat, cu acordul proprietarului, după plecarea pachetului
la beneficiar.

## 1. Ordinea COMPLETĂ (aceeași în `docs/sms/LIVRARE_20261226b_SABLON_PREDARE.md` și în descrierea PR-ului)

Într-o singură fereastră liniștită (fără sesiuni de predare în desfășurare, fără răspunsuri publice așteptate în acel moment):

0. **Înainte** (doar citire, obligatoriu): pașii din §2 de mai jos (amprentele pe producție) și pașii din documentul B §3 (trimiterile SMS
   Redări oprite, rundele în curs terminate).
1. **A** — aplicarea `20261226a` prin runner (§7).
2. **B** — aplicarea `20261226b` prin runner (documentul B).
3. **Publicarea coordonată** — îmbinarea AMBELOR PR-uri, #1117 și #1119 (deploy Vercel ~3 min după fiecare; se îmbină unul după altul, fără
   altă publicare între ele).
4. **Reîncărcarea** (Ctrl+Shift+R) formularului public pe proiectul de test și a ecranului SMS → Istoric; verificarea din §7.

Ce vede fiecare, în fiecare stare intermediară:

| Stare | Proprietarul de teren (formularul public) | Operatorul (ERP) |
|---|---|---|
| Înaintea A | Formularul și declarația vechi; opțiunea „Nu particip — am obiecții” încă acceptată. | Totul ca azi. |
| După A, înaintea publicării | O pagină (re)încărcată primește declarația nouă („electronic”), dar formularul vechi mai oferă opțiunea retrasă; trimiterea ei e refuzată (`optiune_invalida`, mesajul general de eroare). O pagină deschisă ÎNAINTE de A afișează încă textul vechi (vezi §4). | Înregistrarea unui răspuns cu opțiunea retrasă e refuzată (23514, mesaj explicit); restul ca azi. |
| După B, înaintea publicării | Ca rândul de mai sus. | SMS: cu JS-ul vechi, crearea lotului Redări e refuzată (40001: textul afișat diferă de cel recalculat de BD) — fail-closed, nimic trimis. |
| După publicarea ambelor PR-uri | Trei opțiuni pentru răspunsuri noi, declarația „electronic”, terminologia „predare”. Paginile deja deschise cer reîncărcare. | SMS „predare” aliniat (JS = SQL). |

**De ce publicarea #1119 înaintea B e interzisă:** #1119 schimbă constanta JS a SMS-ului (`SABLON_REDARI`, versiunea `provizoriu-2026-11-17`).
Cu JS-ul nou și SQL-ul vechi, textul afișat de UI nu mai coincide cu cel recalculat de BD, deci crearea oricărui lot Redări e refuzată
(40001) până la aplicarea B. Fără pierdere de date, dar fluxul SMS e blocat. De aceea: A, apoi B, apoi publicarea. Iar #1117 fără A
afișează titlul „electronic” peste declarația „prin poștă / electronic” din BD (verdictul pe #1117, P1).

## 2. Înainte de aplicare — confirmarea pe PRODUCȚIE (doar citire, obligatoriu în ziua aplicării)

Preflight-ul migrării refuză orice corp sau proprietate diferită de cele așteptate. Coordonatorul rulează, doar citire:

```sql
SELECT p.oid::regprocedure AS functie, md5(replace(p.prosrc, chr(13), '')) AS amprenta, l.lanname AS limbaj, p.prosecdef AS definer,
       p.provolatile AS volatil, p.prorettype::regtype AS intoarce, p.proconfig, pg_get_userbyid(p.proowner) AS proprietar,
       coalesce(p.proacl, acldefault('f', p.proowner))::text AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('fn_red_raspuns_public', 'fn_red_raspunsuri_valideaza', 'fn_red_jurnal', 'fn_red_versiune_creste', 'fn_red_optiune_retrasa')
 ORDER BY 1;
SELECT count(*) FILTER (WHERE text_declaratie = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.') AS cu_textul_vechi,
       count(*) AS proiecte FROM public.red_proiecte;
SELECT count(*) AS raspunsuri_cu_optiunea_retrasa FROM public.red_raspunsuri WHERE optiune = 'nu_particip_cu_obiectii';
```

Rezultatul așteptat (exact 4 rânduri în prima interogare; `fn_red_optiune_retrasa` NU există):

| funcție | amprentă | limbaj / definer / volatil / întoarce | proconfig | proprietar | ACL |
|---|---|---|---|---|---|
| `fn_red_jurnal()` | `41ab451b7fcb499a2284c9c82367069e` | plpgsql / t / v / trigger | `{"search_path=public, pg_temp"}` | postgres | `{postgres=X/postgres}` |
| `fn_red_raspuns_public(text,text,date,text,boolean,text)` | `230aa93e36c8d9b5f9ac5f3afc0066ad` | plpgsql / t / v / jsonb | `{"search_path=public, pg_temp"}` | postgres | `postgres`, `anon`, `authenticated`, `service_role` cu `X` (20261126a §7) |
| `fn_red_raspunsuri_valideaza()` | `3528222d7d8379dbbe8f3d2e64c60b94` | plpgsql / t / v / trigger | `{"search_path=public, pg_temp"}` | postgres | `{postgres=X/postgres}` |
| `fn_red_versiune_creste()` | `e7ab9318de671f0a94c678ee382250db` | (preflight-ul verifică doar amprenta) | | | |

**La nepotrivire NU se înlocuiește constanta din migrare.** Se compară corpul de pe producție cu cel din `20261126a` (de ex.
`pg_get_functiondef(...)` salvat într-un fișier în afara repo-ului și `diff` față de corpul din migrare) și se analizează diferența: cine a
schimbat funcția, când, de ce. Abia apoi se decide (alt PR, alt review) dacă migrarea trebuie refăcută pe corpul nou.

**Verificat la 17.11.2026 de coordonator (doar citire)**: md5-urile corpurilor celor două funcții înlocuite sunt exact cele de mai sus
(inclusiv cel al RPC-ului, până atunci neconfirmat), ambele SECURITY DEFINER, proprietar postgres, `search_path = public, pg_temp`; textul
vechi al declarației din migrare e identic octet cu octet cu cel de pe producție (2 proiecte îl au); există 1 răspuns istoric cu opțiunea
retrasă (rămâne valabil). **Se reverifică în ziua aplicării** (inclusiv ACL-ul, care nu a fost în lista din 17.11).

Tot în ziua aplicării: proba cu ROLLBACK pe țintă (§7, pasul 5) și citirea baseline-ului L15.

## 3. Ce face

| Ce | Cum |
|---|---|
| `red_proiecte.text_declaratie` | DEFAULT nou = „Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.”; rândurile cu EXACT vechea valoare implicită („… spre semnare, prin poștă / electronic.”) primesc textul nou; un text personalizat rămâne neatins. Postcondiție: niciun rând cu textul vechi. |
| Refuzul pe server | triggerul `fn_red_raspunsuri_valideaza` (BEFORE INSERT/UPDATE, orice cale: RPC public, operator prin API, `service_role`, alți producători, inclusiv e-mailul) refuză INSERT-ul cu `nu_particip_cu_obiectii` și UPDATE-ul care schimbă opțiunea CĂTRE el: 23514, „cine are obiectii vine la sesiune sau cere constatare pe teren”. Codul rămâne în CHECK; un rând vechi cu el se corectează în continuare (alt câmp). |
| RPC-ul public | `fn_red_raspuns_public` întoarce pentru codul retras refuzul EXISTENT `{ok:false, motiv:'optiune_invalida'}`, în același punct (după contoare, înainte de orice scriere): niciun motiv nou, niciun oracol nou, nicio schimbare în formular. |
| O singură definiție (L19) | `fn_red_optiune_retrasa(text)` — nouă, internă (fără drept de apel pentru roluri), chemată de trigger și de RPC. |
| Evidența pentru revenire | Rândurile de jurnal ale UPDATE-ului poartă **marcajul execuției** în câmpul existent `red_jurnal.user_email`: `livrare:20261226a_redari_predare_declaratie:<txid>` (numele migrării + tranzacția, din garda de livrare). Fără tabel, coloană sau RPC nou. Detalii în §5. |

Ce NU face: nu schimbă denumirea proiectului și nicio altă dată; nu atinge CHECK-ul, ecranele, șabloanele, FAN, mailul.

## 4. Lock-uri, durată, risc — și ce NU garantează

- `red_proiecte` **ACCESS EXCLUSIVE** (cerut de `ALTER COLUMN … SET DEFAULT`), NOWAIT, bugetul de 1 s de la prima încercare.
  **Bugetul limitează doar OBȚINEREA lock-ului, nu durata ținerii lui**: lock-ul rămâne până la COMMIT, inclusiv pasul „după” al runnerului
  (calculul final al amprentei globale). Pe clonă (17.11.2026): lock-ul ținut ~450 ms, tranzacția ~0,9 s; pe producție, estimat
  ~1,3–1,6 s. În acest interval **așteaptă și citirile** din `red_proiecte`: formularul public (`fn_red_formular_public`) și ecranele Redări
  întârzie până la COMMIT (nu dau eroare). Plafonul tranzacției (5000 ms) e limita superioară.
- Implicit: INSERT în `red_jurnal` (ROW EXCLUSIVE, compatibil cu scrierea unui răspuns public obișnuit; doar un DDL / lock puternic
  concurent pe jurnal ar da refuz prin `lock_timeout`).
- `red_raspunsuri` **nu** se blochează (`CREATE OR REPLACE FUNCTION` ia doar rândul din `pg_proc`; triggerul vede corpul nou de la COMMIT).
  Un răspuns inserat concurent înainte de COMMIT trece pe regula veche — ca înainte de migrare (o validare deja făcută pe corpul vechi
  nu e anulată retroactiv).
- **Pagina publică deschisă ÎNAINTE de aplicare**: (a) oferă încă opțiunea retrasă — trimiterea ei e refuzată (`optiune_invalida`), nimic
  scris; (b) afișează declarația VECHE, iar cererea de răspuns NU transmite versiunea declarației: un proprietar poate trimite
  „Nu particip — nu am obiecții” după textul vechi afișat, iar răspunsul se înregistrează. De aceea **fereastra liniștită** (nimeni nu
  completează formularul în acel moment) și reîncărcarea paginii de test după publicare.
- Proba cu **două sesiuni** pe clonă (un răspuns public în curs în timpul aplicării, un formular citit în timp ce lock-ul e ținut):
  `supabase/tests/20261226a_redari_predare_clona.sh` (§6) — scenariul și rezultatul așteptat sunt scrise în antetul scriptului.

## 5. Revenirea (`supabase/revenire/20261226a_redari_predare_declaratie_ROLLBACK.sql`, plafon 2000, fără amprentă globală)

Corpurile EXACTE din 20261126a (amprentele `3528222d…` / `230aa93e…`), funcția nouă scoasă, DEFAULT-ul vechi. Rândurile (r2, review #1119
P1): proveniența = **execuția concretă** a migrării, nu forma tranziției. Un proiect se readuce la textul vechi DOAR dacă:

1. are textul nou;
2. ULTIMUL lui rând de jurnal poartă marcajul ULTIMEI execuții a migrării (`livrare:20261226a_redari_predare_declaratie:<txid>`), fără
   utilizator, VECHI → NOU, nimic altceva schimbat în afară de versiune;
3. rândul e identic cu `date_noi` din acel rând de jurnal (deci și aceeași versiune).

Rămân neatinse (și numărate în NOTICE): o tranziție VECHI → NOU făcută de altcineva fără JWT, înainte sau după migrare (n-are marcajul);
un proiect salvat între timp de un om (rând de jurnal mai nou, versiunea crescută); un proiect creat după migrare. De ce marcajul nu poate fi
falsificat de aplicație: e scris în `user_email` din `auth.jwt()`; un JWT real are `sub` (deci `user_id` nenul), iar `service_role` nu are
e-mail; doar o sesiune de administrator al BD (care oricum poate orice) l-ar putea imita. Marcajul se pune doar pe durata UPDATE-ului
(`request.jwt.claims` local, fără `sub` și fără `role`: `auth.uid()` și `auth.role()` rămân NULL, nicio identitate pentru triggere) și se
șterge imediat (verificat). Revenirea își marchează la rândul ei rândurile (`…_ROLLBACK:<txid>`). Fără refuz pe date (revenirea nu șterge
nimic). Starea exactă a migrării e verificată înainte (corpuri, proprietăți, ACL, DEFAULT, trigger, CHECK, jurnal), altfel refuz.

Coordonatorul consemnează în jurnalul livrării NOTICE-ul aplicării (lista id / cod / versiune + marcajul) și NOTICE-ul revenirii, dacă e cazul.

## 6. Probe

- Local, rulate: `node scripts/pglite/test_redari_predare_declaratie_local.mjs` — PASS (validatorul real; aplicarea ca la livrare cu pașii
  L15 v2 generați — manifestul = 4 obiecte din `supabase/tests/20261226a_redari_predare_declaratie.l15.obiecte.tsv`; comportamentul pe
  fiecare cale; marcajul execuției în jurnal; aplicare → revenire → reaplicare → revenire; **contraexemplele revenirii** (tranziția
  VECHI → NOU fără utilizator înainte de migrare și după ea: neatinse; revenirea de la 60072612 le readucea — `--revenire <fișier>`
  o rulează pe altă revenire); 17 refuzuri ale migrării, 7 ale revenirii; 10 mutanți ai migrării + 2 ai revenirii).
- `python3 scripts/test_livrare_validator_plafon.py` (validatorul acceptă migrarea cu 5000 și o refuză cu 2000 / fără plafon; revenirea cu 2000).
- Pe clonă, coordonatorul (17.11.2026, pe 60072612): manifestul = 4 obiecte, reproductibil; 3 probe cu ROLLBACK IDENTIC; aplicare →
  revenire → reaplicare → revenire cod 0, catalogul identic după revenire. LIMITA: clona n-are rânduri Redări, deci rândurile, jurnalul și
  refuzurile pe roluri reale se probează cu scriptul de mai jos.
- **Pentru coordonator, DOAR pe clonă** (nerulat de autor — serverul de cod nu are acces la BD):
  `supabase/tests/20261226a_redari_predare_clona.sh` — date SINTETICE create și șterse de script; aplicarea și revenirea prin runner;
  rândurile + jurnalul + refuzurile INSERT / UPDATE pe fiecare cale cu rolurile reale (anon prin RPC, authenticated editor, service_role);
  contraexemplele revenirii; un răspuns public în curs din a doua sesiune în timpul aplicării; formularul citit cât e ținut lock-ul;
  revenirea și curățenia. Rezultatul așteptat pe fiecare pas e în antetul scriptului.
- NU dovedesc: producția. Pașii de mai jos.

## 7. Comenzile coordonatorului (clonă adusă la starea producției; producția doar cu acordul owner-ului)

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
# 4. pe clonă: proba cu date sintetice, două sesiuni, roluri reale, aplicare -> revenire (scriptul cheamă runnerul)
PSQL=<calea psql> EDITOR=<uuid profil editor redari pe clonă> bash supabase/tests/20261226a_redari_predare_clona.sh \
  --sistem <SIS clona> --host <clona> --port <P> --user postgres --db postgres \
  --manifest supabase/migrations/20261226a_redari_predare_declaratie.l15.tsv --amprenta-globala <GLOBAL clona>
# 5. în ziua livrării: §2 (doar citire), recitirea + partea revizuită identică; apoi proba cu ROLLBACK pe țintă (acordul owner-ului), apoi aplicarea
bash scripts/l15_compara_liste.sh --a citire_prod_20261226a.txt --b citire_ziua_20261226a.txt --recitire
bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261226a_redari_predare_declaratie.sql --versiune 20261226120000 \
  --tinta-host <H> … --plafon-tranzactie-ms 5000 --compara-cu supabase/migrations/20261226a_redari_predare_declaratie.l15.tsv \
  --amprenta-globala <GLOBAL din citire_ziua_20261226a.txt>
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261226a_redari_predare_declaratie.sql --aprobare aprobare_20261226a.txt \
  --versiune 20261226120000 --tinta-db postgres --tinta-sistem <SIS> --tinta-host <H> --tinta-port <P> --user <U> \
  --plafon-tranzactie-ms 5000 --amprenta-globala <GLOBAL din ziua livrării> --diferente-globale supabase/migrations/20261226a_redari_predare_declaratie.l15.tsv
```

Rezultatul așteptat: manifestul = cele 4 obiecte (`coloana public.red_proiecte.text_declaratie` schimbat; `functie
fn_red_optiune_retrasa(text)` creat; `fn_red_raspuns_public(…)` și `fn_red_raspunsuri_valideaza()` schimbate); aplicarea = cod 0, cu
NOTICE-urile `20261226a: lock la … (1 incercari …)`, `20261226a: declaratia: N proiecte schimbate (id cod versiune: …), M cu text
personalizat neatinse; marcajul executiei in red_jurnal.user_email: livrare:20261226a_redari_predare_declaratie:<txid>` (de consemnat în
jurnalul livrării), `PLAFON_TIMP … (plafon 5000 ms)`, `LOCK_TINUT …`; revenirea = cod 0, `executia livrare:…: N proiecte readuse …;
K proiecte ale executiei salvate intre timp, neatinse; R proiecte raman cu textul nou`. Verificări SQL după aplicare (doar citire):

```sql
SELECT count(*) FILTER (WHERE text_declaratie LIKE '%prin poștă / electronic.') AS vechi, count(*) AS total FROM public.red_proiecte; -- vechi = 0
SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
 WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie';                                            -- textul NOU
SELECT has_function_privilege('anon', 'public.fn_red_optiune_retrasa(text)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.fn_red_optiune_retrasa(text)', 'EXECUTE');                                 -- f, f
SELECT user_email, count(*) FROM public.red_jurnal WHERE tabela = 'red_proiecte' AND user_email LIKE 'livrare:20261226a_%' GROUP BY 1; -- marcajul, N
```

## 8. Lecții aplicate (L01–L25)

L06 ordinea lock-urilor în antet (un singur lock; bugetul = obținerea, nu ținerea); L07 regula în triggerul BEFORE pe orice cale; L08
nicio identitate nouă (marcajul fără `sub` / `role`, `user_id` rămâne NULL); L14 o tranzacție, postcondiții (inclusiv marcajul pe fiecare
rând schimbat), revenire testată aplicare → revenire → reaplicare și pe contraexemple; L15 v2 amprenta globală + manifest; L18 refuzul
codului retras = eroare clară, nu tăcere; L19 `fn_red_optiune_retrasa` = o singură definiție; L20 căile legitime probate (rândul vechi
corectat, celelalte trei opțiuni, proiectele salvate de om); L25 așteptări scrise de mână, roluri reale (anon / authenticated /
service_role / postgres), mutanți, contraexemplele rulate și pe revenirea veche. Restul: n/a (detaliat în raportul livrării).
