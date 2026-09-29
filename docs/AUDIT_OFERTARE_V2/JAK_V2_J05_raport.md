# JAK-V2-J05 — audit derogare depunere

Implementare locală după `C:\Users\Public\spec_v2_j05.md`. Fără git, producție sau secrete.

## Modificări

- Migrare nouă: tabel de audit cu FK către licitație, RLS SELECT prin helperul real de acces Ofertare și privilegii exclusiv SELECT pentru authenticated/service_role. Privilegiile implicite pe tabel/secvență sunt revocate explicit.
- Trigger append-only pentru UPDATE, DELETE și TRUNCATE, inclusiv în sesiunea postgres. Revocarea privilegiului TRUNCATE singură nu protejează împotriva superuserului.
- Coloană nullable `derogare_motiv`; RPC SECURITY DEFINER cu verificare owner, motiv de minimum 10 caractere după eliminarea spațiilor marginale, blocarea licitației și audit în aceeași tranzacție. Retragerea acceptă motiv opțional; ID inexistent și `p_acorda=NULL` sunt refuzate explicit.
- Poarta este copiată din 20260929a și primește numai auditul acordării și al depunerii pe derogare. R5 și NOTICE rămân intacte.
- Dublarea este evitată fără GUC: la false/NULL → true scrie exclusiv triggerul, inclusiv pentru RPC; RPC scrie retragerea sau reconfirmarea unei derogări deja active. Astfel, un `set_config` făcut de apelant nu poate suprima auditul.
- FK este `DEFERRABLE INITIALLY DEFERRED`: la BEFORE INSERT, auditul este inserat înaintea licitației. Verificarea la finalul tranzacției permite acest caz, păstrând `ON DELETE RESTRICT`.
- Rollback atomic: restabilește exact funcția 20260929a și elimină obiectele noi numai dacă nu există audit sau motive salvate. Cu date existente refuză integral operația, fără pierderea istoricului.
- CI: bază dedicată `jakv205_test_ci`, pas PostgreSQL 16 și filtre pentru migrarea nouă.

## Verificări

- **Trecut:** `node --check scripts/pg/test_jakv205_derogare_audit.mjs`.
- **Trecut:** comparație locală a surselor: după eliminarea celor două adăugări de audit, codul porții este identic cu 20260929a; funcția din rollback este identică integral cu originalul.
- **Nerulat pe PostgreSQL:** prima invocare a refuzat lipsa PGURI. A doua, cu URI local de test fără parolă, a eșuat la lansarea psql cu `EPERM`. psql nu este în PATH; nici instalarea PostgreSQL standard, Docker sau WSL instalat nu au fost găsite. Nu declar testele SQL trecute.
- Testul nou include: owner/non-owner/fără JWT, motiv invalid, actor/motiv/statusuri, acordare și retragere atomică, reconfirmare fără dublare, UPDATE direct, INSERT cu derogare, depunere, GUC falsificat, RLS, ACL, refuz UPDATE/DELETE/TRUNCATE pentru authenticated/service_role/postgres, FK RESTRICT, refuz rollback cu date, rollback exact și rerulare cu/fără istoric. Reia și întreaga matrice a porții J03.
- R5 este simulat în fixture, ca în J03; integrarea cu implementarea completă R5 și PostgREST nu a fost executată. Nu există schimbări UI/JS de produs pentru care să fie necesare vitest/build.

Rulare de către Claude/CI pe o bază PostgreSQL 16 locală goală:

```powershell
$env:PGURI = 'postgres://postgres@localhost:5432/jakv205_test_local'
node scripts/pg/test_jakv205_derogare_audit.mjs
```

Fixture-urile și rolurile sunt tranzacționale; testul face ROLLBACK final. Baza dedicată trebuie creată înainte. Harness-ul refuză adrese nelocale și alte nume de baze.

## Draft PR pregătit pentru Claude

Titlu: `Ofertare: audit append-only pentru derogarea depunerii (JAK-V2-05)`

Descriere: Derogările aveau numai NOTICE la depunere. Migrarea adaugă audit persistent pe licitație pentru acordare, retragere prin RPC și depunere pe derogare, cu acces de citire limitat și protecție împotriva rescrierii. Păstrează regulile porții J03 și include rollback fără pierdere de date, matrice PostgreSQL 16 și pas CI.

Validare: sintaxă JavaScript și comparație exactă a porții/rollback-ului trecute; matricea PostgreSQL necesită rulare în CI/mediul Claude.

PR-ul nu a fost creat pe GitHub: lucrul a rămas exclusiv local, fără git, conform instrucțiunii. Titlul și descrierea sunt pregătite aici pentru predare.

## Fișiere

1. `supabase/migrations/20260929b_ofertare_derogare_audit.sql`
2. `supabase/migrations/20260929b_ofertare_derogare_audit_ROLLBACK.sql`
3. `scripts/pg/test_jakv205_derogare_audit.mjs`
4. `.github/workflows/ofertare-regresie.yml`
5. `docs/AUDIT_OFERTARE_V2/JAK_V2_J05_raport.md`
