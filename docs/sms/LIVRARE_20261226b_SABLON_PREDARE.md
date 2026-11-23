# Livrarea migrării 20261226b — SMS Redări: șablonul cu „predare” (NEAPLICATĂ)

Decizia proprietarului (17.11.2026): terminologia „predare”. Textul SMS-ului fix devine:

> Gazpet pt Transgaz: sesiune predare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}

(„redare” → „predare”, restul identic). Versiunea rămâne **PROVIZORIE** (`provizoriu-2026-11-17`): textul nu e încă aprobat de beneficiar,
deci comutatorul Redări NU se pornește (`docs/sms/ACTIVARE_SMS_REDARI.md`). Acordul pentru PREGĂTIRE: 17.11.2026; aplicarea o face
coordonatorul, cu acordul proprietarului, după plecarea pachetului la beneficiar.

## 1. Ordinea COMPLETĂ (aceeași în `docs/redari/LIVRARE_20261226a_PREDARE_DECLARATIE.md` §1 și în descrierea PR-ului)

0. **Înainte** (doar citire, obligatoriu): §3 de mai jos (trimiterile SMS Redări oprite, rundele în curs terminate) și §2 (lungimea pe
   UAT-urile reale); pentru A, documentul A §2.
1. **A** — `20261226a` (declarația, opțiunea retrasă).
2. **B** — `20261226b` (acest document).
3. **Publicarea coordonată** — îmbinarea AMBELOR PR-uri, #1117 și #1119, una după alta.
4. **Reîncărcarea** formularului public pe proiectul de test și a ecranului SMS → Istoric; verificarea din §6.

Ce vede un operator SMS în fiecare stare: până la B — totul ca azi; **după B, înaintea publicării** — cu JS-ul vechi, crearea lotului Redări
e refuzată (40001: textul afișat diferă de cel recalculat de BD), fail-closed, nimic trimis; după publicarea ambelor — șablonul „predare”
aliniat (JS = SQL). Tabelul complet (și ce vede un proprietar de teren) e în documentul A §1.

**De ce publicarea #1119 înaintea B e interzisă:** JS-ul nou (`SABLON_REDARI` cu „predare”, versiunea `provizoriu-2026-11-17`) + SQL-ul
vechi = textul afișat ≠ textul recalculat de BD → orice creare de lot Redări e refuzată (40001) până la B.

| Unde | Ce |
|---|---|
| SQL `fn_sms_redari_sablon_model()` | textul nou |
| SQL `fn_sms_redari_sablon_versiune()` | `provizoriu-2026-11-17` |
| JS `src/sms/sablonRedari.js` | `SABLON_REDARI` (textul nou), `SABLON_REDARI_VERSIUNE` = `provizoriu-2026-11-17` |
| Testele | cazurile P1–P15 într-un singur tabel (`src/sms/sablonRedari.cazuri.js`), verificate în vitest (JS) și pe SQL-ul real în proba PGlite (paritatea JS ↔ SQL); `RedariSmsFereastra.test.jsx` cu textul nou |

Regulile NU se schimbă (`fn_sms_redari_sablon_aprobat` neatinsă): o versiune `provizoriu-*` trece doar pe proiectele `TEST-%` cu 1–5
destinatari.

## 2. Lungimea GSM-7 — și ce NU dovedesc cazurile de paritate

+1 caracter („predare” are o literă în plus). Pe cazurile de paritate: P1 140 (era 139), P2 / P11 / P13 / P14 134 (133), P3 139 (138);
toate sub 160; P10 (numele UAT foarte lung) era deja peste 160 și rămâne „prea_lung” (199). **Cazurile din tabel NU dovedesc că orice UAT
real încape**: un text care azi are exact 160 de caractere ajunge la 161 și e refuzat (lotul nu se mai poate crea pe acel UAT). Un text
peste 160 rămâne, ca înainte, blocat de aplicație (nu se trimite pe două segmente).

**Pas obligatoriu înaintea aplicării (coordonatorul, doar citire, pe producție)** — lungimea textului NOU pe toate UAT-urile reale:

```sql
SELECT pr.cod, u.nume AS uat, c->>'motiv' AS motiv_azi, (c->>'lungime')::int AS lungime_azi,
       (SELECT v.lungime FROM public.fn_sms_text_verifica(replace(c->>'text', 'sesiune redare teren', 'sesiune predare teren')) v) AS lungime_dupa_b
  FROM public.red_uat u JOIN public.red_proiecte pr ON pr.id = u.proiect_id
 CROSS JOIN LATERAL (SELECT public.fn_sms_redari_sablon_calc(u.nume, ARRAY[u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3],
                                                       ARRAY[u.program_zi1, u.program_zi2, u.program_zi3], pr.contact_telefon,
                                                       (now() AT TIME ZONE 'Europe/Bucharest')) AS c) x
 ORDER BY lungime_dupa_b DESC NULLS LAST, pr.cod, u.nume;
```

Rezultatul așteptat: `lungime_dupa_b` = `lungime_azi` + 1 pe fiecare rând cu text; **niciun rând cu `lungime_dupa_b` > 160** care azi avea
`lungime_azi` ≤ 160. Rândurile cu `motiv_azi` = `lipsuri` (zi / program / telefon necompletat) nu au text azi: lungimea lor nu depinde de zi
(ZZ.LL și HH:MM au lungime fixă), deci se verifică după completare, cu aceeași interogare. Dacă apare un UAT care trece de 160: **nu se
aplică B**; se raportează proprietarului (numele UAT-ului de scurtat în Setări UAT sau textul de reformulat de Juridic).

## 3. Trimiterile în curs — procedura (doar citire), înaintea aplicării

**Ce garantează B și ce nu:** după COMMIT, aprobarea, fiecare rezervare și cronul refuză loturile cu versiunea veche
(`fn_sms_redari_lot_motiv_la` → `sablon_neaprobat`; textul recalculat diferă oricum → `text_schimbat`). Dar un worker `sms-trimite` care a
REZERVAT deja mesaje înainte de COMMIT (`fn_sms_rezerva` i-a dat lista și textul) le trimite furnizorului după COMMIT, cu textul vechi:
trimiterea nu reverifică versiunea (`supabase/functions/sms-trimite/logica.ts`, bucla de runde). Deci **afirmația „niciun mesaj cu textul
vechi nu mai pleacă” e valabilă doar pentru rezervările făcute (și verificate) după schimbare**, iar delimitarea strictă cere oprirea
trimiterilor ÎNAINTE. Funcția edge nu se schimbă.

Pașii (coordonatorul, pe producție, doar citire; orice schimbare de setare o decide proprietarul):

1. **Inițierea trimiterilor Redări e oprită.** Cât timp comutatorul Redări e oprit, `fn_sms_rezerva` nu rezervă niciun mesaj Redări
   (`redari_neautorizat`), nici de la buton, nici de la cron:
   ```sql
   SELECT redari_autorizat, kill_switch FROM public.sms_setari WHERE id;  -- așteptat: redari_autorizat = false
   ```
   Dacă `redari_autorizat = true` (n-ar trebui: versiunea e provizorie): **stop**, nu se aplică B; proprietarul decide (oprește comutatorul
   din 📱 SMS → Setări sau amână aplicarea). Coordonatorul nu schimbă setarea.
2. **Nicio rundă în curs — inventarul TUTUROR rezervărilor Redări, oricare ar fi starea lotului (inclusiv `anulat`) și a mesajului.**
   De ce nu ajunge filtrarea pe starea lotului (r3, review #1119): anularea unui lot scoate din coadă DOAR mesajele `in_coada`
   (`fn_sms_lot_anuleaza`, `supabase/migrations/20261130b_sms_acces_modul.sql:734`); cele deja rezervate rămân `necunoscut` și workerul
   care le-a primit le trimite mai departe. Deci un lot anulat poate avea o rezervare recentă în curs. Reperul fiecărei rezervări e
   `sms_mesaje.rezervat_la`: scris o singură dată, la rezervare (`fn_sms_rezerva`, `20261130c_sms_redari_sablon.sql:676`; triggerul îl
   fixează la rezervare și îl păstrează la orice schimbare ulterioară de stare, `20261130c_sms_redari_sablon.sql:729-730, 769`). Coloanele
   și stările folosite: `sms_loturi.categorie` / `stare` (`20261130a_sms_mvp.sql:85`), `sms_mesaje.lot_id` / `stare` / `rezervat_la`
   (`20261130a_sms_mvp.sql:112-123`), `sms_setari.redari_autorizat` / `actualizat_la` (`20261130a_sms_mvp.sql:64-74`; `actualizat_la` se
   pune la ORICE schimbare a setărilor, `20261130a_sms_mvp.sql:251`).

   **Momentul opririi rezervărilor** (de la el se numără cele 5 minute) = cel mai târziu dintre (a) momentul de la care comutatorul e
   neschimbat (`sms_setari.actualizat_la`, cât timp `redari_autorizat = false`: nicio rezervare Redări nu mai e posibilă după el —
   `fn_sms_rezerva` blochează întâi rândul de setări și refuză cu `redari_neautorizat`, `20261130c_sms_redari_sablon.sql:617`) și (b) ultima
   rezervare Redări înregistrată (o rezervare care ținea deja setările în clipa opririi poate avea `rezervat_la` cu câteva milisecunde după
   `actualizat_la`). Un worker trăiește cel mult ~100 s de runde plus limita funcției edge, deci **5 minute** după acest moment nu mai e
   nicio rundă în curs:
   ```sql
   -- (1) momentul opririi; se CONSEMNEAZĂ în jurnalul livrării (oprirea_rezervarilor, acum)
   SELECT s.redari_autorizat, s.actualizat_la AS comutator_neschimbat_din, r.ultima_rezervare_redari,
          greatest(s.actualizat_la, r.ultima_rezervare_redari) AS oprirea_rezervarilor, now() AS acum,
          now() >= greatest(s.actualizat_la, r.ultima_rezervare_redari) + interval '5 minutes' AS se_poate_aplica
     FROM public.sms_setari s
    CROSS JOIN (SELECT max(m.rezervat_la) AS ultima_rezervare_redari
                  FROM public.sms_mesaje m JOIN public.sms_loturi l ON l.id = m.lot_id
                 WHERE l.categorie = 'redari') r
    WHERE s.id;
   -- (2) inventarul rezervărilor Redări pe TOATE stările lotului și ale mesajului (fără filtru pe stare)
   SELECT l.stare AS stare_lot, m.stare AS stare_mesaj, count(*) AS mesaje, count(DISTINCT l.id) AS loturi,
          count(*) FILTER (WHERE m.rezervat_la > now() - interval '10 minutes') AS rezervate_10_min,
          max(m.rezervat_la) AS ultima_rezervare
     FROM public.sms_mesaje m JOIN public.sms_loturi l ON l.id = m.lot_id
    WHERE l.categorie = 'redari' AND m.rezervat_la IS NOT NULL
    GROUP BY 1, 2 ORDER BY 1, 2;
   ```
   Așteptat: (1) `redari_autorizat = false` și `se_poate_aplica = true` (altfel se așteaptă și se repetă ambele interogări);
   (2) `rezervate_10_min` = 0 pe TOATE rândurile, inclusiv pe cele cu `stare_lot = 'anulat'`, iar niciun `ultima_rezervare` nu e după
   `oprirea_rezervarilor` din (1). O rezervare apărută după oprire = **stop** (ceva rezervă cu comutatorul oprit): nu se aplică B,
   se raportează proprietarului. Mesajele `necunoscut` (rezultat nescris), din orice lot, NU se retrimit automat; se reconciliază
   înaintea recreării lotului (§4).
3. Abia apoi aplicarea B (în aceeași fereastră, imediat după A).

## 4. Loturile existente și pasul de curățare (doar descris)

- Un lot creat înainte (`filtru.sablon_versiune = 'provizoriu-2026-11-03'`, text cu „redare”) e **refuzat** după migrare la aprobare, la
  fiecare rezervare și de cron. Nicio rezervare NOUĂ din el; mesajele rezervate înainte de COMMIT sunt acoperite de §3.
- Loturile Redări pot exista doar pe proiecte `TEST-%` (versiune provizorie). Cât un lot vechi rămâne „activ” (draft / aprobat /
  in_trimitere, sau coada_golita cu mesaje „necunoscut”) **ocupă UAT-ul** (un singur lot Redări activ pe UAT), deci nu se poate crea altul.
- **Pasul de curățare, după aplicare**: NOTICE-ul migrării listează loturile (`loturi Redari active cu alta versiune …: N (id stare; …)`).
  Întâi se reconciliază mesajele lor rezervate sau cu rezultat necunoscut (SMS → Istoric, rezultatul fiecărui mesaj; nu se retrimit).
  Apoi, după reconciliere, fiecare lot e într-una din două situații (r3, review #1119):
  1. **Încă anulabil** (`draft` / `aprobat` / `in_trimitere`): operatorul îl anulează din SMS → Istoric (`fn_sms_lot_anuleaza` scoate
     din coadă doar mesajele `in_coada`; ce era rezervat își păstrează rezultatul) și îl recreează din șablon.
  2. **Deja închis** (`coada_golita` sau `anulat`): NU se mai anulează — `fn_sms_lot_anuleaza` refuză orice altă stare decât
     draft / aprobat / in_trimitere cu `23514` („lotul e deja inchis”, `20261130b_sms_acces_modul.sql:731-733`). Înaintea recreării se
     verifică două lucruri:
     - **UAT-ul e eliberat**: un lot `coada_golita` ocupă UAT-ul cât are mesaje `necunoscut` (regula „un singur lot Redări activ pe UAT”,
       `20261130c_sms_redari_sablon.sql:389-394`); după reconciliere nu mai are niciunul (`necunoscut = 0` în interogarea de mai jos).
       Un lot `anulat` nu ocupă UAT-ul.
     - **Campania zilei**: un lot NEANULAT (deci și `coada_golita`) pe același UAT + aceeași zi de sesiune + același șablon blochează
       recrearea pentru ACEEAȘI zi (`23505`, „nu se trimite de două ori”, `20261130c_sms_redari_sablon.sql:395-407`). Mesajele lui au
       plecat deja (cu textul vechi): pentru acea zi nu se recreează nimic; un lot nou pe acel UAT e posibil doar pentru altă zi de
       sesiune, la decizia proprietarului.
  ```sql
  SELECT l.id, l.stare, l.uat_id, l.filtru->>'zi' AS zi, l.filtru->>'sablon_versiune' AS versiune,
         count(m.id) FILTER (WHERE m.stare = 'in_coada') AS in_coada, count(m.id) FILTER (WHERE m.stare = 'necunoscut') AS necunoscut,
         CASE WHEN l.stare IN ('draft', 'aprobat', 'in_trimitere') THEN 'anulabil: anulare, apoi recreare'
              WHEN l.stare = 'coada_golita' AND count(m.id) FILTER (WHERE m.stare = 'necunoscut') > 0 THEN 'inchis: ocupa UAT-ul, de reconciliat'
              WHEN l.stare = 'coada_golita' THEN 'inchis: UAT eliberat; ziua lui ramane ocupata (campania)'
              WHEN count(m.id) FILTER (WHERE m.stare = 'necunoscut') > 0 THEN 'anulat: nu ocupa UAT-ul; necunoscut de reconciliat'
              ELSE 'anulat: nimic de facut' END AS ce_se_face
    FROM public.sms_loturi l LEFT JOIN public.sms_mesaje m ON m.lot_id = l.id
   WHERE l.categorie = 'redari' AND (l.filtru->>'sablon_versiune') IS DISTINCT FROM public.fn_sms_redari_sablon_versiune()
   GROUP BY l.id ORDER BY l.creat_la;
  ```
  Un lot creat în cele câteva secunde ale aplicării poate primi versiunea veche: același refuz, aceeași procedură. Migrarea nu anulează
  nimic singură.

## 5. Lock-uri, durată

Niciun lock pe tabele: `CREATE OR REPLACE FUNCTION` ia doar rândul din `pg_proc`. `sms_loturi` / `sms_mesaje` doar citite (NOTICE-ul).
Fără bloc de lock: garda finală a runnerului afișează `LOCK_TINUT` „nedeclarat” (diagnostic, nu gardă). Tranzacția = cele două amprente
globale + câteva milisecunde (clonă, 17.11.2026: ~0,7 s).

## 6. Revenirea (`supabase/revenire/20261226b_sms_redari_sablon_predare_ROLLBACK.sql`, plafon 2000)

Corpurile EXACTE din 20261130c; starea exactă a migrării verificată înainte. Fără refuz pe date. Loturile create cu versiunea nouă devin
`sablon_neaprobat` (NOTICE-ul le numără; se anulează la fel). Se face ÎMPREUNĂ cu revenirea constantei JS, cu aceeași procedură §3 înainte.

## 7. Probe și comenzi

- Local, rulat: `node scripts/pglite/test_sms_sablon_predare_local.mjs` — PASS (validatorul real; aplicarea ca la livrare, manifestul =
  2 obiecte din `supabase/tests/20261226b_sms_redari_sablon_predare.l15.obiecte.tsv`; paritatea JS ↔ SQL pe 15 cazuri; loturile vechi /
  noi / pe proiect real / text amestecat; revenire → reaplicare; 8 refuzuri ale migrării, 4 ale revenirii; 6 mutanți). NU probează fluxul
  complet creare → aprobare → rezervare → worker și nici concurența cu un worker în curs (§3 e procedura pentru asta).
- `npx vitest run src/sms/sablonRedari.test.js src/sms/RedariSmsFereastra.test.jsx`.
- Pe clonă (17.11.2026, coordonatorul, pe 60072612): manifestul = 2 obiecte, reproductibil; 3 probe cu ROLLBACK IDENTIC; aplicare →
  revenire → reaplicare → revenire cod 0; catalogul identic după revenire.
- Coordonatorul, pe țintă: aceiași pași ca documentul A §7, cu numele `20261226b_sms_redari_sablon_predare`, versiunile `20261226120100`
  (migrarea) / `20261226120101` (revenirea), rădăcinile `--radacina 'public.fn_sms_redari_sablon_model()' --radacina
  'public.fn_sms_redari_sablon_versiune()'`, iar diff-ul listei de obiecte pe `supabase/tests/20261226b_sms_redari_sablon_predare.l15.obiecte.tsv`
  (2 obiecte, ambele `functie … schimbat`).
- Rezultatul așteptat la aplicare: cod 0; NOTICE `20261226b: loturi Redari active cu alta versiune decat provizoriu-2026-11-17: N (…)`
  (de consemnat și de curățat, §4); verificare: `SELECT public.fn_sms_redari_sablon_versiune();` → `provizoriu-2026-11-17`.

**Proba fluxului pe clonă** (`supabase/tests/20261226b_sms_predare_flux_clona.sh`; o rulează coordonatorul DUPĂ ce A și B sunt aplicate pe
clonă prin runner, între 08:00 și 19:45 ora României: `PSQL=<psql> EDITOR=<uuid ne-owner, fără acces SMS> bash supabase/tests/20261226b_sms_predare_flux_clona.sh
--sistem <system_identifier> --host <H> --port <P> --user postgres --db postgres`, `OWNER` implicit profilul sintetic is_owner al clonei).
Gărzile refuză înaintea oricărei scrieri altă țintă, A / B neaplicate (amprentele postcondiției), lanțul SMS diferit de cel din repo,
conturile nepotrivite, ora din afara ferestrei, o clonă NEIZOLATĂ (cod 28, vezi mai jos) și orice identificator al probei deja folosit pe
clonă (cod 25: tot spațiul de chei `b26b0000-0000-4000-8000-…`, pe orice coloană care îl poate purta — UAT-uri, parcele, deținători,
contacte, tokenuri, convocări, jurnal, loturi, mesaje —, codul `TEST-SMSP-SINT` și numerele de document ale probei).
**Bariera de trimitere (r3, cod 29) — ținută pe TOATĂ rularea.** Singura cale prin care pleacă un SMS e funcția edge `sms-trimite`, care
trimite doar mesajele întoarse de `fn_sms_rezerva` (rezervarea = UPDATE pe `sms_mesaje`). Înaintea oricărei schimbări (înaintea gărzii 28,
a copiei setărilor, a lui S0, a kill-switch-ului și a comutatorului), proba pune pe `sms_mesaje` un trigger BEFORE UPDATE (schema proprie
`smsp_bariera`, `ENABLE ALWAYS`, deci trage și cu `session_replication_role = replica`) care refuză (42501, `smsp_bariera: …`) orice
scoatere din coadă în altă stare decât `anulat` și orice scriere a furnizorului / momentelor de rezervare-trimitere, în afara sesiunilor
probei (o cheie de 128 de biți generată local, trimisă doar ca parametru de conexiune prin `PGOPTIONS`, niciodată într-o interogare; în
bază stă doar sha256-ul ei) ȘI în afara loturilor proiectului probei (nici proba nu poate rezerva un lot străin). Un worker / edge / cron
care se conectează ORICÂND în timpul probei primește eroare la rezervare, deci nu are ce trimite. Anularea și confirmările de livrare trec.
Înaintea fiecărei porniri a trimiterii și la final, proba verifică (29) că bariera e în vigoare: triggerul exact și funcția cu amprenta de
la punere, plus o rezervare reală fără cheie, anulată, refuzată de EA. Bariera se scoate DOAR în tranzacția de curățenie, după ce setările
sunt puse la loc (la COMMIT dispar deodată); dacă proba se oprește înaintea oricărei schimbări, o scoate trap-ul; o curățenie picată o
LASĂ pe clonă (rezervările blocate, sigur) și tipărește cum se scoate. O barieră rămasă de la altă rulare = refuz 29. Cheia trebuie să
ajungă în sesiune (verificat pe sha256 înaintea punerii): conexiune DIRECTĂ la clonă, nu prin pooler. **Condiția de rulare rămâne**: pe
clonă nu e configurat furnizorul real (fără `SMSLINK_*`, fără `SMS_FURNIZOR=smslink` pe o funcție edge legată de clonă) — bariera nu
depinde de asta, dar un sistem care trimite fără să treacă prin baza clonei nu e acoperit de ea.
**Izolarea SMS (r2, cod 28) — verificare SUPLIMENTARĂ (instantaneu, nu barieră)**: `simulator` din probă NU e o barieră (edge-ul își ia
furnizorul din `SMS_FURNIZOR`), iar comutatoarele probei sunt globale; proba verifică și din bază că pe clonă nu e nimic altceva conectat:
nicio altă sesiune client (PostgREST, edge, worker, altă consolă), fără `pg_cron` / `pg_net` / `http`, niciun lot în afara probei aprobat /
în trimitere (o clonă a producției are numere reale) și nicio rundă rezervată / trimisă în afara probei din cele 15 minute dinaintea
pornirii încoace (rundele rezervate înaintea barierei: edge-ul trimite lista primită în cel mult ~2 minute). Verificarea se face la pornire
(după punerea barierei), înaintea FIECĂREI porniri a trimiterii (kill-switch oprit / comutator Redări pornit) și la final; o încălcare
oprește proba (28), iar curățenia pune la loc setările. Ea singură nu oprește o conexiune apărută între două verificări (review r2): asta o
face bariera. Pe date SINTETICE
(proiectul `TEST-SMSP-SINT`, mobile 07000009xx, adrese fictive) și pe căile reale — aplicația ca `authenticated` cu JWT-ul contului, workerul
ca `service_role` — **dovedește**: cu comutatorul Redări oprit (starea producției) nici crearea, nici rezervarea nu trec (42501 /
`redari_neautorizat`); cu el pornit DOAR în probă (pe calea owner-ului), crearea din șablon dă textul cu „sesiune predare teren”, un
segment, versiunea `provizoriu-2026-11-17`; un client care trimite textul vechi primește 40001 (UI-ul vechi blochează oricum butonul
înaintea apelului, `motivBlocareCreare`; 40001 e plasa BD-ului, versiunea nu e un parametru al RPC-ului); aprobarea refuză anon, un cont
fără nivel SMS și versiunea greșită; cu kill-switch-ul pornit (comutatorul Redări pornit) rezervarea întoarce `kill_switch`, fără niciun
mesaj rezervat (F4c); două rezervări concurente (sesiuni reale, a doua blocată de prima) nu dublează niciun mesaj; pașii de
BD ai workerului (`fn_sms_rezultat`) lasă lotul `coada_golita` cu mesajul `necunoscut` nereluat la rezervările următoare, iar lotul ocupă
UAT-ul (§4); loturile cu versiunea veche (draft / aprobat / în trimitere / `coada_golita`) sunt refuzate la aprobare și la rezervare
(`sablon_neaprobat`), se anulează cele anulabile, `coada_golita` e refuzat (23514), interogarea §4 le clasifică corect, iar recrearea
merge pe UAT-ul eliberat și e refuzată pe campania zilei. Loturile vechi se pot face după B doar ca fixture: INSERT cu triggerele active,
iar istoricul lor de dinainte de B (aprobare, rezervare, rezultat) cu triggerele SMS oprite doar în acea tranzacție, reactivate și verificate
înainte de COMMIT. Curățenia șterge doar ce a creat ACEASTĂ rulare: lanțul care pleacă de la proiectul cu id-ul, codul și marcajul rulării
(un uuid luat de pe server la pornire, scris în denumire) — niciodată după o listă de id-uri; dacă S0 n-a ajuns la COMMIT, lanțul e gol și nu
se șterge nimic. Înainte de COMMIT verifică pe fiecare tabel că au dispărut EXACT rândurile lanțului, pune la loc EXACT rândul `sms_setari`,
iar după COMMIT, din altă sesiune, că garda 25 trece din nou și bariera e scoasă; `PASS` apare doar după ea, altfel cod 26. Garda 25 / 28,
bariera și curățenia au un test local pe PGlite cu SQL-ul luat din script (`scripts/pglite/test_sms_predare_flux_clona_local.mjs`: intruși
pe fiecare tabel, S0 picat pe cheia unui UAT străin, resturile unei rulări anterioare, rulare completă cu scrieri străine în timpul probei,
13 cazuri de izolare; bariera pe lanțul SMS REAL 20261130a + 20261130b: scenariul din review r2 — fără barieră workerul rezervă mesajele
probei, iar garda 28 e goală înainte și după; cu barieră, refuzat —, lotul intern străin, cronul, cheia greșită, proba pe un lot străin,
`replica`, anularea legitimă, aceeași secvență a probei cu și fără barieră, verificarea „în vigoare”, curățenia picată care o lasă; plus
mutanții). **NU dovedește**: furnizorul real, funcția edge `sms-trimite` (poarta, fereastra verificată în edge,
rundele), cronul (calea fără lot nu se cheamă), nivelul „utilizator” SMS și un worker care a rezervat înaintea COMMIT-ului lui B (§3).
