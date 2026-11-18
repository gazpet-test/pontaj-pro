# E-mail Redări — proba trimiterii din `redari@gazpet.ro` pe proiectul de TEST: pașii pentru coordonator și proprietar

Document operațional (felia F2b, 18.11.2026), de parcurs **pas cu pas**, cu un **jurnal al probei** ținut de coordonator în afara repo-ului (ora,
pasul, ce s-a văzut, ce s-a decis). Proiectarea întreagă: `PLAN_EMAIL_REDARI.md` (§1.3 trimiterea, §1.6 MIME, §2.3 OAuth, §2.4 fișa a–e) și
deciziile proprietarului din 18.11.2026 (în plan, blocul „Deciziile lui Răzvan (18.11.2026)”). La orice abatere se oprește (§9) și se notează.

**Ce aduce PR-ul acestei felii (cod):** funcția edge `redari-mail-oauth` (conectarea / revocarea căsuței pentru trimitere, doar owner), funcția edge
`redari-mail-trimite` completă (lot aprobat → rezervare → MIME → Gmail API `messages.send` → rezultat), wrapperul HTTP cu listă închisă de apeluri
către Google, pagina ERP `/redari/mail-oauth` (întoarcerea de la Google), butoanele din „✉️ Lot e-mail”, migrarea **neaplicată** `20261131h`
(gărzile în bază: pornirea doar cu căsuța conectată, doar proiecte `TEST-`, RPC-urile de state OAuth și de Vault). Garda „doar TEST” e **și în cod**
(`DOAR_PROIECTE_TEST = true` în `redariMailF2.mjs`: proiectul lotului, citit din bază, trebuie să aibă codul care începe cu `TEST-`), **și în bază**
(`red_mail_setari.doar_proiecte_test`, cu `CHECK IS TRUE`). Orice lot al unui proiect real primește **423 `transport_real_doar_test`** înainte de orice
secret și de orice apel către Google. Scoaterea gărzii = PR + migrare separate, revizuite, după „da”-urile din plan (textul juridic, DKIM / DMARC,
autorizarea Transgaz, `extern_permis`).

**Ce NU face această felie (limite declarate):** fără atașament — **decizia C a proprietarului (18.11.2026), valabilă și pentru proiectele reale**:
e-mailul are textul (validat de Juridic înaintea proiectelor reale) și linkul formularului public, iar convocarea oficială rămâne cea din plic (nu se
face nici conversia convocatorului DOCX pe server, nici un PDF generat în browser); fără citirea / golirea căsuței (F1); fără reconcilierea automată a
rezultatelor `necunoscut` (rămân „de decis”, cu pauza de 15 minute din bază; nu se retrimit); fără destinatari din afara `@gazpet.ro` (`extern_permis`
rămâne fals și în CHECK); fără protecția completă a categoriei pe lanțul FAN (§0.1 — PR FAN separat).

**Ordinea:** (a) Google Cloud → (b) secretele în Supabase → (c) aplicarea migrării + publicarea funcțiilor → (d) conectarea căsuței (proprietarul, logat
ca `redari@`) → (e) proba pe `TEST-RAZVAN` cu UN destinatar intern → (f) verificarea livrării → (g) oprirea / revocarea. Fiecare rând bifat în jurnal.

---

## 0. Lista de control (proprietarul + coordonatorul)

| # | Cine | Ce verifică / decide | Când |
|---|---|---|---|
| a | proprietarul | **proiectul de test** are codul exact `TEST-RAZVAN` (începe cu `TEST-`, fără spații); **destinatarul probei** = o adresă `@gazpet.ro` a unui coleg care acceptă (sau a proprietarului); niciun deținător real în lot | înainte de (e) |
| b | toți | **categoria proiectului (TEST / real) e păzită de bază, nu de o înțelegere verbală** (§0.1): nimeni nu pornește trimiterea pe alt proiect; o redenumire care ar schimba categoria e refuzată de server cât lotul e în lucru | toată ziua |
| c | coordonatorul | **commit-ul publicat** identificat: SHA-ul de pe `main` după îmbinare = versiunea funcțiilor edge din Supabase | înainte de (d) |
| d | coordonatorul | **migrarea `20261131h` aplicată** prin runner (manifest L15 generat pe clonă, proba cu ROLLBACK pe țintă, apoi livrarea), ÎNAINTE de publicarea funcțiilor; postcondițiile ei trecute | înainte de (c) publicare |
| e | proprietarul | **contul Google folosit la consimțământ este `redari@gazpet.ro`** (nu contul personal): ecranul Google arată adresa înainte de „Permite”; serverul refuză oricum altă căsuță (id_token) | la (d) |
| f | toți | **oprire la orice rezultat ambiguu** („necunoscut”, cod neașteptat, mail neprimit cu stare „trimis”): nimic nu se „mai apasă o dată” | toată ziua |

### 0.1 Garanția tehnică a categoriei proiectului (migrarea `20261131h`, runda 2)

Convenția `TEST-` este păzită **în bază**, pe toate căile (nu doar prin ecran și prin funcția edge):
- **codul proiectului nu poate trece din `TEST-…` într-un cod „real” (sau invers) cât proiectul are loturi de e-mail neîncheiate ori mesaje rezervate /
  în apel** — deci nici în intervalul dintre autorizarea unui apel și apelul propriu-zis către Google — **și nici cât are AWB-uri FAN propuse /
  aprobate / în curs / necunoscute**. Serverul răspunde cu refuz explicit (`categoria codului (TEST- / real) nu se schimba cat proiectul are …`).
  **Pentru e-mail garanția e completă** (toate căile de trimitere). **Pentru FAN garanția e PARȚIALĂ și declarată ca atare** (runda 3): condiția pe
  AWB-uri acoperă doar intervalul cu AWB-uri în stările de mai sus (deci și un AWB aprobat deja rezervat „în curs”, cu apelul în desfășurare); **nu
  acoperă** verificarea categoriei → autorizare → apel din funcția FAN când la momentul verificării nu există încă AWB-uri în acele stări, nici acțiunea
  „evenimente” (fără AWB), nici urmărirea / etichetele / confirmările pe AWB-uri generate / ridicate. Protecția completă a FAN e un PR FAN separat
  (lucru rămas); până atunci, pe FAN rămân gărzile FAN existente (proiect `TEST-` + lot marcat TEST) și regula din `FAN_TEST1_PASI.md`;
- **schimbarea categoriei o poate face doar proprietarul** (owner), și doar când condiția de mai sus nu se aplică; redenumirile care păstrează
  categoria (`TEST-RAZVAN` → `TEST-RAZVAN-2`, `LOT1` → `LOT1-B`) rămân ca azi (admin Redări);
- decizia „doar TEST” din bază (`fn_red_mail_f2_poate`, chemată de rezervare și de autorizarea apelului) se ia **cu rândul proiectului blocat
  (FOR SHARE)**: o redenumire pornită în același moment așteaptă și apoi e refuzată, iar o redenumire deja comisă e văzută;
- pe proiectele cu autorizarea Transgaz completată, codul nu se poate schimba deloc (regula din `20261130m`, existentă).

**Efect zilnic:** un proiect de TEST cu loturi active nu poate fi „transformat” într-unul real redenumindu-l, și nici invers; după încheierea
loturilor (și AWB-urile ajunse generat / ridicat / anulat / eroare), proprietarul poate schimba categoria. Obiecte noi în bază:
`fn_red_proiect_e_test` (definiția unică a convenției), `fn_red_proiect_cod_test_garda` + triggerul `trg_red_proiect_cod_test` pe `red_proiecte`, și
lock-ul proiectului în `fn_red_mail_rezerva` / `fn_red_mail_apel_incepe`. Proprietarul le aprobă odată cu migrarea.

## 1. Google Cloud (proprietarul; coordonatorul verifică DOAR existența, nu valorile)

Un proiect GCP **propriu** pentru trimitere (planul §2.3, decizia implicită (g): revocare independentă de celelalte clienți). Pași, în consola
Google Cloud, logat ca administratorul Workspace al `gazpet.ro`:

1. **Proiect nou**: „Redări trimitere” (numele e informativ). Fără facturare (Gmail API nu costă).
2. **API**: „APIs & Services → Library” → **Gmail API → Enable**. Nimic altceva (fără People, fără Drive).
3. **Ecranul de consimțământ** („OAuth consent screen” / „Google Auth platform → Branding”): tipul **Internal** (doar conturile `gazpet.ro`);
   numele aplicației „ERP Redări trimitere”; e-mailul de asistență = al proprietarului. **Scopes** („Data access”): se adaugă exact
   `https://www.googleapis.com/auth/gmail.send`, `openid`, `.../auth/userinfo.email`. Nimic altceva (serverul refuză un set diferit).
4. **Clientul OAuth** („Credentials → Create credentials → OAuth client ID”): tipul **Web application**, numele „ERP Redări trimitere”;
   **Authorized redirect URIs** = exact `https://pontaj-pro-sooty.vercel.app/redari/mail-oauth` (o singură linie, fără bară finală, fără alt
   domeniu; serverul trimite exact această valoare la schimbul codului — altă valoare = refuz de la Google). Fără „Authorized JavaScript origins”.
5. Se notează **Client ID** și **Client secret** DOAR pentru pasul 2 (nu în jurnal, nu în chat, nu în repo).
6. **Admin Console** (opțional, recomandat): „Security → API controls → Manage Third-Party App Access” → aplicația marcată de încredere,
   limitată la scope-urile de mai sus.

## 2. Secretele în Supabase (proprietarul; doar NUMELE aici)

Supabase → Edge Functions → Secrets:

| Secret (Edge Secrets) | Ce e |
|---|---|
| `REDARI_GMAIL_TRIMITERE_CLIENT_ID` | Client ID-ul clientului web de la pasul 1.4 |
| `REDARI_GMAIL_TRIMITERE_CLIENT_SECRET` | Client secret-ul aceluiași client |

Refresh token-ul **nu se pune de mână**: ajunge în **Vault** sub numele `REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN`, scris de funcția edge la
conectare (pasul 4), prin RPC-ul `fn_red_mail_secret_seteaza` (doar `service_role`, cu owner-ul re-verificat). Nu se refolosesc
`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` ale altor module (planul §4).

## 3. Migrarea și publicarea funcțiilor (coordonatorul, după îmbinarea PR-ului)

1. **Migrarea `20261131h_redari_mail_f2b_trimitere`** (NEAPLICATĂ în PR). Două probe SEPARATE, apoi livrarea:
   - **(1a) Proba de concurență, pe un cluster PostgreSQL ≥ 17 COMPLET DISPENSABIL** (nu clona de producție, nu un cluster folosit la altceva):
     `F2B_CLUSTER_DISPENSABIL=da PGHOST=… PGUSER=postgres … bash supabase/tests/20261131h_redari_mail_f2b_concurenta.sh <nume_baza_noua>`
     (nerulată în PR — fără PostgreSQL local). Ce atinge: creează și șterge baza dată; creează, DOAR dacă lipsesc, rolurile de cluster `anon` /
     `authenticated` / `service_role` / `supabase_auth_admin` / `supabase_storage_admin` și le șterge la final pe cele create de ea; fișiere temporare
     șterse; nicio conexiune în afara clusterului. Ce dovedește (două sesiuni psql reale, barieră explicită, SQLSTATE-urile promise): redenumirea
     `TEST-` → real **și** real → `TEST-` concurentă cu rezervarea așteaptă lock-ul proiectului (55P03) și după commit e refuzată de trigger (P0001);
     `apel_incepe` așteaptă un UPDATE al proiectului și nu autorizează nimic sub lock; după încheierea lotului owner-ul poate schimba categoria,
     adminul nu (42501). Ieșire 0 = toate așteptările se țin.
   - **(1b) Regresiile pe CLONA COMPLETĂ** (schema de producție): manifestul L15 (`scripts/livrare_l15_manifest.sh --iesire …`; lista obiectelor
     așteptate: `supabase/tests/20261131h_redari_mail_f2b_trimitere.l15.obiecte.tsv`, 22 obiecte), proba cu ROLLBACK pe țintă (`--compara-cu`),
     aplicare → revenire → reaplicare, apoi suitele existente F1 / F2 / FAN (20261130j / k, 20261131a, 20261212a) rulate DUPĂ migrare, inclusiv
     interacțiunea cu triggerele de pe live care lipsesc din fixture (`trg_red_autorizare_tgz`, 20261130m). Acestea nu sunt acoperite de (1a).
   - apoi livrarea prin runner cu plafonul 5000 și amprenta globală (antetul migrării). Postcondițiile verifică: comutatorul tot OFF, căsuța neconectată,
     `doar_proiecte_test = true`, niciun state / secret, triggerul pe `red_proiecte` pus. Fără „da”-ul proprietarului nu se aplică. **Revenirea**
     (`…_ROLLBACK.sql`) e posibilă doar cât trimiterea n-a fost folosită deloc (L14): după prima conectare, întoarcerea = migrare nouă, nu revenire (§8).
2. GitHub → Actions → **„Deploy edge function (manual)”** → `slug` = `redari-mail-oauth`, apoi din nou cu `slug` = `redari-mail-trimite` (de pe
   `main`). Ambele se publică cu `verify_jwt = true` (callback-ul OAuth vine din pagina ERP cu JWT-ul omului, nu direct de la Google).
3. Identificarea commit-ului publicat (rândul (c) din §0): `git rev-parse origin/main` = SHA-ul din rezumatul workflow-ului; în Supabase, Code:
   `redariMailF2.mjs` conține `TRANSPORT_REAL_ACTIV = true` și `DOAR_PROIECTE_TEST = true`.
4. Vercel publică singur pagina `/redari/mail-oauth` după îmbinare (~3 min); Ctrl+Shift+R la testare.

## 4. Conectarea căsuței (proprietarul; cine dă click pe „Permite”, cu ce cont)

1. **În browser, întâi** se deschide Gmail și se verifică că contul activ (sau cel pe care îl va alege la Google) este **`redari@gazpet.ro`**.
   Dacă proprietarul e logat doar cu contul personal: se adaugă contul `redari@` în același browser sau se folosește o fereastră separată logată ca `redari@`.
2. ERP (logat ca owner) → Redări → `TEST-RAZVAN` → **✉️ Lot e-mail** → caseta „Căsuța redari@gazpet.ro pentru trimitere: neconectată” →
   **„Conectează căsuța pentru trimitere (Google)”**. Browserul merge la Google.
3. La Google: se alege / confirmă **`redari@gazpet.ro`**; ecranul arată „ERP Redări trimitere” și permisiunile „Trimite e-mailuri în numele tău”
   + adresa de e-mail; **„Permite”**. Alt cont (personal) = serverul refuză (`casuta_gresita`), revocă accesul primit și nu salvează nimic — se reia pasul 2.
4. Întoarcerea pe pagina ERP `/redari/mail-oauth`: mesajul **„Căsuța redari@gazpet.ro este conectată pentru trimitere. Trimiterea rămâne oprită…”**.
   Orice alt mesaj (cu codul în paranteză) = oprire (§9). Pagina încearcă o singură dată; o reîncărcare a ei dă „state_invalid” — normal.
   Mesajele de eșec spun exact cât se știe: la un **refuz al serverului** (`casuta_gresita`, `scope_diferit`, `id_token_*`…) nimic nu e salvat în ERP și
   serverul **a cerut** revocarea accesului la Google (dacă Google a confirmat-o nu se vede de aici); la un **răspuns pierdut / eroare temporară**
   (`salvare_neconfirmata`, 503, rețea) **nu se știe** dacă căsuța s-a conectat sau dacă revocarea a reușit → se verifică în Lot e-mail (Recitește) și,
   la nevoie, în contul Google (§7, „Rezervă”). Nu se reîncarcă pagina.
5. Înapoi în **✉️ Lot e-mail**: caseta arată „conectată (redari@gazpet.ro, data și ora)”. În jurnal: ora conectării.
6. **Pornirea trimiterii**: butonul **„Pornește trimiterea”** → confirmare. Caseta arată „Trimiterea: PORNITĂ · destinatari externi: doar @gazpet.ro”.
   (Pornirea e refuzată de bază fără căsuța conectată: `casuta_neconectata`.)

**Verificarea coordonatorului (doar citire, SQL)** după pașii 5–6:
```sql
-- un rând: trimitere_oprita false, doar_proiecte_test true, extern_permis false, trimitere_casuta 'redari@gazpet.ro', conectata_de = uuid-ul owner-ului
SELECT trimitere_oprita, extern_permis, doar_proiecte_test, trimitere_conectata_la, trimitere_conectata_de, trimitere_casuta, versiune FROM public.red_mail_setari;
-- evenimentele conectării: oauth_conectat (cod trimitere, autor owner); orice oauth_respins = încercare refuzată, de lămurit
SELECT tip, cod, autor, creat_la FROM public.red_mail_evenimente WHERE tip LIKE 'oauth_%' ORDER BY id;
-- secretul EXISTĂ, fără a-i afișa valoarea
SELECT name, length(decrypted_secret) > 0 AS are_valoare, updated_at FROM vault.decrypted_secrets WHERE name = 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN';
```

## 5. Proba pe `TEST-RAZVAN`: UN destinatar intern

Precondiții: §0 (a), (e); §3; §4 (conectată + pornită); informarea GDPR publicată pe proiectul de test (autorizarea Transgaz în ⚙️ Setări proiect —
altfel aprobarea lotului e refuzată cu `informare_nepublicata`).

| # | Cine | Ce apasă | Ce trebuie să vadă |
|---|---|---|---|
| 1 | admin / owner | pe `TEST-RAZVAN`, deținătorul de test are în contact **e-mailul colegului** (`@gazpet.ro`) | în ✉️ Lot e-mail, la UAT-ul lui, deținătorul apare la „Eligibili” |
| 2 | owner | UAT → bifează DOAR acel deținător → subiect + text (textul validat de Juridic sau un text de probă marcat „PROBĂ”) → **„Creează ciorna pentru previzualizare”** | lotul apare cu starea `ciorna`, un mesaj `M-nnnnnn`, adresa completă și textul exact |
| 3 | owner | bifa „Aprob explicit acest lot…” → **„Aprobă acest lot”** | starea `aprobat`; butonul „Trimite lotul (până la 20 de mesaje)” devine activ (pe un proiect real ar rămâne „Trimite lotul — transport doar pe proiecte de TEST…”) |
| 4 | owner | **„Trimite lotul”** → confirmare | mesajul „Rulat: trimise 1, eșuate sigur 0, necunoscute 0, rezervate 1”; mesajul lotului trece în `trimis`. „trimise 1” apare **doar** dacă baza a confirmat scrierea rezultatului; altfel „neconfirmate 1 (starea în server: …)” — §9 |
| 5 | coordonator | SQL de mai jos (A1, A2) | A1: un rând `trimis`, `gmail_id` și `thread_id` nenule, `trimis_la` = acum; A2: jurnalul `rezervat → apel_inceput → trimis` |

```sql
-- A1: mesajele lotului (fără conținut în ieșire)
SELECT nr_document, stare, eroare_cod, rezervat_la, apel_inceput_la, trimis_la, gmail_id IS NOT NULL AS are_gmail_id FROM public.red_mail_mesaje WHERE lot_id = '<uuid lot>' ORDER BY id;
-- A2: pașii din jurnalul F2
SELECT cod, creat_la FROM public.red_mail_jurnal_f2 WHERE lot_id = '<uuid lot>' ORDER BY creat_la;
```

Alte rezultate posibile la pasul 4 (toate FĂRĂ reapăsare):
- `Refuzat: transport_real_doar_test` → lotul nu e pe un proiect `TEST-`; se verifică codul proiectului (o redenumire care ar schimba categoria e
  oricum refuzată de bază cât lotul e în lucru — §0.1);
- „oprit: persistare_neconfirmata · neconfirmate 1” → mailul **poate** fi plecat, dar baza n-a confirmat scrierea rezultatului sub rezervarea noastră
  (de ex. rezervarea expirase): NU se reapasă; se citește starea din server (afișată), se verifică „Trimise” în `redari@`; decizia e a owner-ului (§9);
- `Refuzat: trimitere_oprita` / `casuta_neconectata` → §4 pașii 5–6;
- `Refuzat: token_respins` → Google a respins refresh token-ul (revocat din contul Google sau clientul schimbat): trimiterea s-a oprit singură în bază;
  se reconectează (§4) și se pornește din nou;
- `Refuzat: informare_nepublicata` / `lot_neaprobat` / `aprobare_expirata` / `lot_integritate` → starea lotului; `lot_integritate` = OPRIRE, lot nou;
- „necunoscute 1” → §9.

## 6. Verificarea livrării (proprietarul + coordonatorul)

1. **Gmail, `redari@`, „Trimise”** (proprietarul, logat ca `redari@`): există exact un mesaj nou către adresa colegului, cu subiectul probei. În
   antetele complete („Afișează originalul”): `From: redari@gazpet.ro`, un singur `To`, fără `Cc` / `Bcc`, `Message-ID: <uuid@gazpet.ro>`
   (același uuid ca `red_mail_mesaje.id`), antetul `X-Gazpet-Redari: <id>; h=<hash>`, `List-Unsubscribe`. Textul cu diacritice corect.
2. **Căsuța colegului**: mesajul primit, nu în Spam; textul identic cu cel aprobat; expeditorul `redari@gazpet.ro`.
3. **Antetele de autentificare** (în mesajul PRIMIT, „Afișează originalul”): `Authentication-Results` cu `spf=pass`, `dkim=pass` (semnătura
   `d=gazpet.ro`) și `dmarc=pass`. Dacă `dkim` lipsește sau e `fail`: DKIM-ul Google pentru `gazpet.ro` nu e pornit (planul §0.4 — precondiție pentru
   proiectele reale, nu oprește proba internă); se notează în jurnal.
4. **Numărul din Gmail = numărul din ERP**: un singur mesaj în „Trimise” pentru acel subiect; în ERP un singur rând `trimis`. Două mesaje = OPRIRE.

## 7. Oprirea și revocarea (proprietarul)

- **Oprire**: ✉️ Lot e-mail → **„Oprește trimiterea”** (fără condiții; nimic nou nu mai pleacă; un mesaj deja `in_apel` își termină tranziția).
- **Revocare**: **„Revocă conectarea”** → confirmare: serverul revocă tokenul la Google, golește secretul din Vault, oprește trimiterea și șterge
  starea conectării (eveniment `oauth_revocat`). Verificare: SQL din §4 (căsuța `NULL`, `are_valoare = false`).
- **Rezervă (fără ERP)**: contul `redari@` → Google Account → Securitate → „Conexiuni cu aplicații terțe” → „ERP Redări trimitere” → Elimină
  accesul; apoi în ERP „Revocă conectarea” tot trebuie apăsat (curăță Vault-ul și starea).
- **Oprire de urgență**: ștergerea celor două secrete din Edge Secrets → orice cerere nouă primește `transport_neconfigurat`; o cerere deja
  începută continuă cu valorile capturate (L05: rezultatul ei se citește din bază, nu se repetă).

## 8. Ce rămâne în bază după probă (evidență, nu se șterge)

Lotul și mesajul pe `TEST-RAZVAN` (`red_mail_loturi`, `red_mail_mesaje` cu snapshotul, `red_mail_jurnal_f2`), evenimentele `oauth_*` și `f2_*`,
state-urile OAuth consumate (`red_mail_oauth_state`), rândul din Vault (cu valoare cât e conectată; golit după revocare). **Revenirea migrării
(`20261131h_…_ROLLBACK.sql`) refuză la orice istoric produs după aplicare** (state-uri, evenimente OAuth ale trimiterii, rândul Vault, mesaje / jurnal
de transport) și nu șterge nimic: după prima conectare nu mai există „revenire”, ci doar o migrare nouă, revizuită (regula L14, textual).

## 9. Dacă rezultatul nu are forma așteptată: OPRIRE, nu improvizație

| Ce se vede | Ce înseamnă | Ce se face |
|---|---|---|
| „necunoscute 1” / mesajul `necunoscut` | 5xx / timeout / răspuns de neînțeles DUPĂ `messages.send`: mailul **poate** fi plecat | NU se reapasă. Baza pune pauza de 15 minute. Se verifică „Trimise” în `redari@`: dacă mailul e acolo, se notează; decizia pe rând („a plecat” / „n-a plecat”) e a owner-ului, într-o felie următoare (reconcilierea); până atunci rândul rămâne `necunoscut` și ocupă un loc în contorul „în zbor” |
| mesaj `in_apel` după ce ecranul s-a liniștit | rezultatul nu s-a putut scrie în bază după apel | fără reapăsare. „Recitește” doar **afișează** (nu mișcă nimic): rândul rămâne `in_apel` până la următoarea rezervare pe acel lot (`fn_red_mail_rezerva`, chemată de „Trimite lotul”), care după expirarea rezervării (2 minute) îl trece în `necunoscut` (`lease_expirat`) și **apoi continuă cu următorul mesaj din coadă**. În proba cu UN singur mesaj coada e goală, deci coordonatorul decide: după 2 minute, o singură apăsare „Trimite lotul” doar pentru reconciliere; cu mai multe mesaje în coadă NU se apasă (ar pleca următorul) — se oprește și se notează |
| „neconfirmate 1” (`persistare_neconfirmata`) | Gmail a răspuns, dar baza NU a confirmat scrierea rezultatului sub rezervarea noastră (rezervare expirată / stare schimbată); mailul **poate** fi plecat | NU se reapasă. Se citește „starea în server” din mesaj și SQL A1; se verifică „Trimise” în `redari@`; dacă rândul e `necunoscut` → regula de mai sus; dacă e `trimis` (scris între timp de altă cale) → se notează; orice altă combinație = OPRIRE |
| `casuta_gresita` la întoarcerea de la Google | consimțământul a fost dat cu alt cont decât `redari@` | nimic salvat în ERP; serverul a cerut revocarea tokenului primit (confirmarea Google nu e vizibilă de aici — la nevoie §7 „Rezervă”); se reia §4 cu contul corect |
| `scope_diferit` | ecranul de consimțământ sau clientul au alte permisiuni decât `gmail.send` + `openid` + `email` | nimic salvat în ERP, revocare cerută; se corectează în Google Cloud (§1.3), se reia §4 |
| `id_token_*` / `jwks_indisponibil` | răspunsul Google nu a putut fi validat local (inclusiv un `id_token` malformat) | nimic salvat în ERP, revocare cerută; se notează codul; dacă se repetă = PR |
| `salvare_neconfirmata` / mesaj „răspunsul s-a pierdut” | serverul a primit accesul dar nu a confirmat salvarea, ori răspunsul nu a ajuns în browser | **nu se știe** dacă e conectată și dacă revocarea a reușit: Recitește în Lot e-mail; dacă apare conectată → se continuă; dacă nu → §7 „Rezervă” (contul Google) și apoi „Conectează” din nou |
| `state_invalid` | pagina de întoarcere a fost reîncărcată sau au trecut peste 10 minute | nimic salvat, codul nu a fost schimbat la Google; se reia §4 pasul 2 (buton nou „Conectează”) |
| `transport_real_doar_test` | lotul nu e pe un proiect `TEST-` | se verifică lotul; categoria proiectului e păzită de bază (§0.1) |
| „categoria codului (TEST- / real) nu se schimba…” la editarea unui proiect | cineva a încercat o redenumire TEST- ↔ real cât proiectul are loturi de e-mail / AWB-uri FAN în lucru | normal: regula din §0.1; se încheie loturile întâi, apoi (doar owner-ul) redenumește |
| `transport_neconfigurat` / `client_neconfigurat` | lipsește un secret din §2 (numele exact) | §2 |
| mail în Spam / `dkim=fail` | DKIM / DMARC nepornite pentru `gazpet.ro` | se notează; precondiție pentru proiectele reale (planul §0.4), nu pentru proba internă |
| două mesaje în „Trimise” pentru același rând | dublare | OPRIRE; se lămurește înainte de orice altă trimitere (nu se mai apasă nimic) |
