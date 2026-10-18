# noutati-mail — scoaterea secretului din cod (07.10.2026)

**Problema:** funcția `noutati-mail` (v8 pe live, `verify_jwt = false`) avea secretul de acces scris direct în cod, iar aceeași valoare era copiată în clar în `claude_context` #990. Oricine o vedea putea porni trimiterea tuturor rândurilor netrimise din `platforma_noutati` (doar destinatarii din rânduri, dar fără control).

**Ce face PR-ul:**
- `supabase/functions/noutati-mail/index.ts` (funcția intră pentru prima dată în repo): secretul se citește din `NOUTATI_SECRET` (Edge Secrets), comparat prin digesturi de lungime fixă (fără garanție de timp constant la nivel mașină). Dacă secretul lipsește sau are sub 24 de caractere, calea cu secret e închisă (fail-closed) și rămâne doar JWT de owner.
- `titlu` și `descriere` sunt escapate în HTML-ul mailului (înainte erau interpolate direct).
- Runda 2 adauga claim atomic si raport pe rand; semantica trimis_la este explicata mai jos.

**Ordinea de livrare (doar cu OK-ul lui Răzvan):**
1. Răzvan setează în Supabase → Edge Functions → Secrets `NOUTATI_SECRET` = o valoare NOUĂ, aleatoare (min. 24 caractere). Valoarea veche se consideră compromisă.
2. Deploy `noutati-mail` din acest branch (v9).
3. Test: apel fără header → 401, apel cu valoarea veche → 401, apel cu cea nouă și coadă goală → `procesate: 0`.
4. Ștergerea valorii vechi din `claude_context` #990 (UPDATE cu preview + OK — e scriere în date).
5. Rând nou / actualizat în `registru_automatizari` + `public.automatizari` (fișa a–e).

Până la pasul 2 nimic nu se schimbă pe live.

## Actualizare peste main — 18.10.2026 (cod local, fără livrare)

Implementarea se află în `handler.ts`, cu adaptorul Deno în `index.ts`.
Autorizarea testabilă este în `auth.ts`. `NOUTATI_SECRET` se citește exclusiv
prin `Deno.env.get`; fără fallback literal, fișier, variabilă frontend sau DB publică.
Valoarea absentă, prea scurtă, goală ori cu spații la capete nu autorizează calea
secretului. Rămâne intenționat fallback-ul owner din PR633: `auth.getUser(jwt)`
și `profiles.is_owner === true`, cu erorile tratate ca refuz, nu ca autorizare.
Niciun acces la coada de mail și nicio trimitere înainte de autorizare.
GET este refuzat; OPTIONS nu produce efecte. Lipsa configurării Resend și eșecul
citirii cozii sunt 503; erorile furnizorului nu expun corpul răspunsului.

Test local fără rețea/DB/secrete reale:
`node --test supabase/functions/noutati-mail/auth_node_test.mjs` (Node 24, TypeScript stripping).
Acoperă refuzurile, fallback owner, erorile autentificării/profilului,
absența efectelor pentru neautorizați, coadă goală și citire eșuată.
Nu este test Deno/Supabase end-to-end și nu verifică instanța live.
Compararea digesturilor are lungime fixă; nu pretinde garanție de timp constant
la nivel mașină pentru un runtime JavaScript.

### Vault și livrare ulterioară

Edge Secrets este sursa funcției. Dacă un cron SQL folosește aceeași acreditare,
el o citește din Supabase Vault la execuție; nu o înscrie în migrații, job SQL,
loguri sau exemple. Această schimbare NU creează cron și NU sincronizează automat
Vault cu Edge Secrets. Operatorul autorizat trebuie să configureze ambele surse
coerent, să rotească valoarea expusă și să testeze, fără a copia valoarea în repo.
Curățarea istoricului și a înregistrării vechi rămâne operațiune separată aprobată.

Sursa pentru citirea variabilelor: https://supabase.com/docs/guides/functions/secrets.
Nu s-au făcut deploy, setări de secrete sau operații asupra bazei de date.

## Inainte de deploy (runda 2 #023; NEEXECUTAT aici)

- Verificati RLS/GRANT: utilizatorul NU isi poate seta `profiles.is_owner`;
  JWT-ul verificat trebuie sa-si poata citi profilul propriu prin clientul anon+JWT.
  Orice refuz/error/null da 401. Nu mai folosim service_role pentru verificarea
  owner; exista un singur client privilegiat, numai dupa autorizare.
- Confirmati Edge Secrets reale si rotatia valorii vechi, fara valori in loguri;
  Vault al eventualului cron ramane separat. verify_jwt=false se
  fixeaza prin lista NO_JWT din `.github/workflows/deploy-edge-function.yml`
  (repo-ul NU are `supabase/config.toml` — interzis de scripts/test_sec_ofertare.sh).
  Gateway-ul nu inlocuieste autorizarea.
- Testati in Deno/Supabase toate cazurile de acces cu furnizorul de mail interceptat,
  apoi claim-ul concurent PostgREST real. Testele locale folosesc mock atomic;
  nu dovedesc configuratia RLS, granturile sau comportamentul bazei live.
- Deno nu este disponibil in PATH aici; deno check/test NU au fost rulate.
  Node 24: 19/19 teste trecute, fara retea sau secrete reale.

### Claim si erori: decizia explicita

UPDATE cu id si trimis_la IS NULL, RETURNING id este claim-ul inainte de HTTP.
Daca nu revine un id, randul este sarit; la eroare claim nu se trimite.
Pastrasem riscul de concurenta in prima versiune; acum este adresat in cod.

Pastrez claim-ul la ORICE eroare a furnizorului, inclusiv resp.text si erori
HTTP certe; nu resetez automat la NULL. Un timeout/reset poate urma unei trimiteri
reusite si resetarea ar permite dublarea. Rezultatul pe rand este trimis,
eroare_furnizor_<status> sau eroare_retea_furnizor; bucla continua. Nu introduc
un tabel/coloana/stare DB noua. `trimis_la` inseamna acum rezervare/incercare,
NU dovada de livrare. Un crash dupa claim poate lasa un rand netrimis blocat.
Acesta este compromis at-most-one-attempt pentru apeluri concurente, nu exactly-once.
Operatorul trebuie sa pastreze raportul si sa reconcilieze cu furnizorul inainte
oricarei resetari manuale, prin preview/aprobare/apply; aceasta sarcina nu reseteaza.

### Review acceptat/respins

Acceptate: encoding UTF-8 fara BOM + test payload; try/catch HTTP/body; claim;
subiect fara CR/LF; destinatari goi; CORS methods; config; client privilegiat unic;
teste refuz/owner/erori/concurenta. Resping resetarea automata sugerata de Gemini,
din cauza rezultatului incert al trimiterii. Testul sugerat care interzice orice
UPDATE pe esec este incompatibil cu claim-ul prealabil: verificam in schimb
retinerea claim-ului si zero retry. Nu preiau afirmatia de constant-time strict:
ramane limitarea JS documentata. RLS/GRANT, secrete, cron si Deno/live raman
conditii de livrare, nu rezultate confirmate. Nicio actiune in productie.
