# Lumini sediu - raport CDX, 25.10.2026

Implementare exclusiv in worktree. NEAPLICATA pe BD si NEDEPLOYATA. Nu am rulat Git, nu am citit secrete si nu am trimis comenzi reale.

## Fisiere

- `supabase/functions/tuya/index.ts`: rutare comanda/test/tick, POST obligatoriu, timeout Tuya, pastrarea actiunilor existente.
- `supabase/functions/tuya/lumini_edge.ts`: reutilizeaza `poartaModul`, apoi verifica nivelul explicit editor/admin pentru cladire; test numai owner; tick numai secret cron validat de index. Lista alba din iot_lumini, cod boolean switch_1/switch din status, recitire, jurnal inclusiv esec, traducere 1106/permission deny.
- `supabase/functions/tuya/lumini_logica.ts`: NOAA, calendar Europe/Bucharest, solar/orar/simulare, plan reproductibil, proprietatea comenzilor, suspendare manuala, cleanup, urmatoarele evenimente.
- `supabase/migrations/20261113a_iot_programe_lumini.sql`: patru tabele, RLS, ACL, RPC UI cu porti server, aprobare owner, cron separat. Seed explicit confirmat: 85462 exterior, 85458/85460 mixt, restul interior. Numele Tuya nu se modifica.
- `supabase/revenire/20261113a_iot_programe_lumini_ROLLBACK.sql`: revenire cu garda proprie; refuza stergerea daca exista programe sau jurnal operational, necesita export/plan separat in acel caz.
- `src/CladireLumini.jsx`, `src/luminiUi.js`: card, comenzi confirmate, roluri, program nou/editare, aprobare/comutator owner, coordonate/vacanta, jurnal, urmatoarele momente. `src/Cladire.jsx`: exact un import si un loc de montare.
- `src/luminiLogica.test.js`, `src/luminiUi.test.js`, `src/luminiContract.test.js`: teste Vitest, inclusiv paritate matrice rol/tip intre validarea SQL, UI si motor.
- `scripts/test_lumini_node.mjs`: verificari fara dependente, cu Tuya si BD simulate in memorie; nicio conexiune.
- `scripts/test_iot_programe_lumini.sh`, `_fixture.sql`, `.sql`: harness PG17 izolat, owner NOSUPERUSER, runner oficial, RLS, drepturi, append-only UI, aprobare, schimbare rol, conflict programe, limite/dedup si revenire. HTTP/Vault/cron sunt simulate local.

## Rezultate reale

- `node --test scripts/test_lumini_node.mjs`: **11/11 trecute**, ultima rulare. Acopera anotimpuri/DST, seed/durate/pauze/maxim doua, eligibilitate, exterior exclus, manual/idempotenta/cleanup/offline/pending/reaprobare, poarta autentificare si nivel, cod switch, comanda/noop/1106/plafon, paritate rol/tip.
- `python -X utf8 scripts/livrare_validator.py supabase/migrations/20261113a_iot_programe_lumini.sql`: **OK, 31 instructiuni de nivel superior**. Prima incercare fara UTF-8 a esuat la afisarea rezultatului in consola Windows; rerularea UTF-8 a reusit.
- `node --check` pentru index.ts, lumini_edge.ts, lumini_logica.ts: trecute. Este control de sintaxa, nu verificare de tipuri Deno.
- `bash -n scripts/test_iot_programe_lumini.sh`: trecut.
- Instalare dependente: **blocata**. npm a necesitat calea explicita Node si USERPROFILE temporar in worktree pentru eroarea uv_os_homedir ENOMEM. Incercarea efectiva `npm install --ignore-scripts --no-audit --no-fund` a esuat cu **EACCES** la registry.npmjs.org. Cache/loguri doar in `.tmp/npm-cache`, fara biblioteci noi in manifest.
- `npx --offline vite build`: **nu a pornit**, ENOTCACHED (Vite indisponibil local).
- `npx --offline vitest run`: **nu a pornit**, ENOTCACHED (Vitest indisponibil local). Nu declar suita completa verde; testele Node nu o inlocuiesc.
- **Nu am rulat Deno, PostgreSQL, API/PostgREST real, Tuya real sau browser.** Nu am accesat BD si nu am facut deploy.

## Decizii si limite

- Refolosim poarta existenta `_shared/poartaModul.ts`; aceasta verifica modulul, iar stratul lumini verifica suplimentar nivelul editor/admin si restrictia testului la owner. Nici JWT anon, nici rol generic, nici secret cron singur nu permit comenzi manuale.
- Runtime-ul serializabil sta intr-o coloana suplimentara a singletonului de setari. Lease globala de patru minute serializeaza tick/manual/test; configurarea refuza modificarile cat exista lease. Rezervarile atomice limiteaza 12 comenzi pe apel si 40 intr-o ora glisanta, inclusiv esecuri si teste. Limita este intentionat conservatoare. Dedup prin iot_alerta, titluri stabile.
- Nu pot exista doua programe active cu aceeasi lumina. Rolul mixt intra implicit in simulare, se selecteaza explicit la solar; interior nu se selecteaza la solar. Roluri/setari schimbate anuleaza aprobarile afectate.
- La dezactivare/modificare, cleanup se face la urmatorul tick si stinge doar luminile preluate de program, fara override manual. Intentia se persista inaintea POST pentru reconciliere dupa un raspuns pierdut; luminile offline isi pastreaza proprietatea pentru o incercare ulterioara.
- Nu exista tranzactie atomica intre Tuya si Postgres. O cadere BD dupa un POST poate impiedica jurnalizarea rezultatului; runtime-ul pending salvat anterior ajuta reconcilierea, iar esecul jurnalului opreste comenzile si incearca notificarea. Verificati starea fizica la astfel de erori.
- Un intrerupator fizic poate fi apasat intre GET si POST. Nici testul noop nu poate garanta absenta unei schimbari vizibile in aceasta cursa; trimite cea mai recenta valoare citita. Doua apasari fizice intre tick-uri care readuc aceeasi stare nu sunt observabile din polling. Comenzile UI marcheaza explicit override-ul.
- Planul generat are cel mult doua lumini simultan si nu adauga o a treia peste stari interioare/mixt deja observate. Interventiile fizice simultane si alte automatizari Tuya nu sunt controlabile de acest motor.
- NOAA este aproximativ; executia are rezolutia cronului de cinci minute. Recitirea imediata poate raporta esec daca Tuya propaga starea cu intarziere; pending-ul este reconciliat ulterior. Lumina deja aprinsa inaintea preluarii nu este stinsa de program.
- Configuratia gateway `verify_jwt` nu este in acest checkout. Operatorul trebuie sa confirme ca endpoint-ul Tuya existent accepta apelurile cron doar cu x-iot-secret, la fel ca sync-ul actual. Poarta comenzilor ramane in cod.

## Verificari ramase pentru Claude/operator

Operatorul ruleaza `bash scripts/test_iot_programe_lumini.sh` pe PostgreSQL 17 local; eu nu am rulat harness-ul. Este necesara verificarea SQL efectiva inaintea aprobarii migrarii, apoi verificarea Deno, instalarea dependentelor si `npx vite build` / `npx vitest run`. Query-urile noi si RPC-urile trebuie verificate pe calea PostgREST reala in etapa autorizata de Claude; build-ul nu valideaza relatiile sau ACL-urile. Verificarea vizuala si testul Tuya noop se fac numai de persoana autorizata, dupa review si livrare. Nu s-a acordat aici permisiune de aplicare/deploy.

## FISA DE SECURITATE

- (a) Continut extern citit: **nu**. Doar fisierele locale ale repo-ului; nicio instructiune preluata din continut extern. Incercarea de instalare npm a fost blocata de mediu.
- (b) Ce scrie/face dupa livrare: comenzi fizice pe lumini, jurnal, patru tabele noi, ultima stare iot_dispozitive si notifications prin iot_alerta; job cron nou.
- (c) Identitate: edge cu service_role, ca functia Tuya existenta, justificat prin cron si Vault. Comenzile UI trec prin utilizator real + poarta de modul + nivel explicit de scriere. Scrierile UI in tabele noi sunt numai prin RPC SECURITY DEFINER cu search_path fix si porti server; runtime si cron nu sunt UI-callable.
- (d) Cine o porneste: cron cu x-iot-secret pentru tick; utilizator owner/editor/admin explicit cladire pentru comanda; numai owner pentru noop, roluri, setari si activare/aprobare.
- (e) Confirmare umana: programe noi/modificate raman inactive pana la aprobarea ownerului; comanda manuala si noop cer confirmare in UI. Migrarea/deploy-ul nu au fost executate.
