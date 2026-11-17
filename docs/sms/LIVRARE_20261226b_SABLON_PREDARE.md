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
2. **Nicio rundă în curs.** Un worker trăiește cel mult ~100 s de runde plus limita funcției edge; se așteaptă cel puțin **5 minute** de la
   ultima rezervare Redări, apoi:
   ```sql
   SELECT l.stare, count(DISTINCT l.id) AS loturi,
          count(m.id) FILTER (WHERE m.stare = 'necunoscut' AND m.rezervat_la > now() - interval '10 minutes') AS rezervate_10_min,
          max(m.rezervat_la) AS ultima_rezervare
     FROM public.sms_loturi l LEFT JOIN public.sms_mesaje m ON m.lot_id = l.id
    WHERE l.categorie = 'redari' AND l.stare IN ('aprobat', 'in_trimitere', 'coada_golita')
    GROUP BY l.stare ORDER BY 1;
   ```
   Așteptat: `rezervate_10_min` = 0 pe toate rândurile și `ultima_rezervare` mai veche de 5 minute (sau NULL). Altfel se așteaptă și se
   repetă. Mesajele `necunoscut` mai vechi (rezultat nescris) NU se retrimit automat; se reconciliază înaintea recreării lotului (§4).
3. Abia apoi aplicarea B (în aceeași fereastră, imediat după A).

## 4. Loturile existente și pasul de curățare (doar descris)

- Un lot creat înainte (`filtru.sablon_versiune = 'provizoriu-2026-11-03'`, text cu „redare”) e **refuzat** după migrare la aprobare, la
  fiecare rezervare și de cron. Nicio rezervare NOUĂ din el; mesajele rezervate înainte de COMMIT sunt acoperite de §3.
- Loturile Redări pot exista doar pe proiecte `TEST-%` (versiune provizorie). Cât un lot vechi rămâne „activ” (draft / aprobat /
  in_trimitere, sau coada_golita cu mesaje „necunoscut”) **ocupă UAT-ul** (un singur lot Redări activ pe UAT), deci nu se poate crea altul.
- **Pasul de curățare, după aplicare**: NOTICE-ul migrării listează loturile (`loturi Redari active cu alta versiune …: N (id stare; …)`);
  mesajele lor rezervate sau cu rezultat necunoscut se reconciliază întâi (SMS → Istoric, rezultatul fiecărui mesaj), apoi operatorul
  anulează lotul din SMS → Istoric și îl recreează din șablon. Un lot creat în cele câteva secunde ale aplicării poate primi versiunea
  veche: același refuz, aceeași anulare. Migrarea nu anulează nimic singură.

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
