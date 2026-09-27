# R5 — teste runda 9b

Migrarea 2 este **NEAPLICATĂ**. Toate cazurile SQL de mai jos sunt pentru baza izolată PGlite a lui Claude, cu schema fixture + migrarea 1 + 1b + migrarea 2. Nu se execută pe baza reală. Testele Deno rămân la Claude.

## Contractul comparării

Unitatea este clasificată prin `ofertare_clasa_unitate` / `clasaUnitate`, fără deducerea factorilor. Unitatea necunoscută rămâne restanță inclusiv dacă rândul are `status='validat'`.

TOTAL și detaliile trebuie să aibă aceeași licitație, obiect, categorie, tip de sursă și sursă, normalizate ca în migrarea 1b. Obiectul, tipul sursei și sursa trebuie să fie identificate, nu goale. Nu deducem din cuvântul „TOTAL” ce străzi / loturi însumează. Dacă TOTAL are `obiect='TOTAL'`, iar detaliile au alte obiecte, rezultatul este **necomparabil**, până când perimetrul este identificat corect de om. Mai multe TOTAL pe același perimetru sunt necomparabile. Pentru alte unități, comparația cere aceeași unitate normalizată; pentru lungimi se aplică factorul explicit.

`cantitate` și `cantitate_plansa` se verifică separat, fără fallback între baze. Porțile finale verifică baza financiară `cantitate`; controlul graficului verifică baza aleasă. Suma din review cu detalii incomplete este numai suma detaliilor validate comparabile, nu un total ales. Nicio funcție de control nu modifică valorile.

## Setul comun de unități

Set identic cu `UNITATI` din `src/ofertareRunda9b.test.js`. Testul Vitest compară rezultatul JS cu maparea efectivă din textul SQL; acesta **nu înlocuiește executarea funcției SQL**. Normalizarea PostgreSQL și consumatorii se verifică pe PGlite.

| Intrare | Rezultat așteptat JS și SQL |
|---|---|
| `m`, ` M` urmat de NBSP, `m.`, `metri`, `metru`, `ml`, `ml.`, `m.l.`, `m.l`, `metri liniari`, `metru liniar` | `{"tip":"lungime","factor":1}` |
| `km` | `{"tip":"lungime","factor":1000}` |
| `hm` | `{"tip":"lungime","factor":100}` |
| `mc`, `m cub`, `m3`, `m³`, `mp`, `m2`, `m²`, `ha`, `l`, `litri`, `buc`, `bucata`, `bucati`, `bucăți`, `buc.`, `bc`, `kg`, `t`, `to`, `h`, `ore`, `set`, `cpl` | `{"tip":"alta"}` |
| NULL, șir gol, un spațiu, `100 m`, `sute m`, `xyz` | `{"tip":"de_verificat"}` |

SQL pentru contractul mapării; rezultatul așteptat este **zero rânduri**:

```sql
WITH cazuri AS (
  SELECT unnest(ARRAY['m',' M' || chr(160),'m.','metri','metru','ml','ml.','m.l.','m.l','metri liniari','metru liniar']) um,
         '{"tip":"lungime","factor":1}'::jsonb asteptat
  UNION ALL SELECT 'km','{"tip":"lungime","factor":1000}'::jsonb
  UNION ALL SELECT 'hm','{"tip":"lungime","factor":100}'::jsonb
  UNION ALL SELECT unnest(ARRAY['mc','m cub','m3','m³','mp','m2','m²','ha','l','litri','buc','bucata','bucati','bucăți','buc.','bc','kg','t','to','h','ore','set','cpl']), '{"tip":"alta"}'::jsonb
  UNION ALL SELECT unnest(ARRAY[NULL::text,'',' ','100 m','sute m','xyz']), '{"tip":"de_verificat"}'::jsonb
)
SELECT um, asteptat, public.ofertare_clasa_unitate(um) efectiv
FROM cazuri WHERE public.ofertare_clasa_unitate(um) IS DISTINCT FROM asteptat;
```

Pentru fiecare unitate, introduceți în fixture câte un rând F3 de conductă cu cantitate 2, pe rând `extras` și `validat`. Comparați `categoriiRetea` cu toate coloanele omonime din view și baza F3: km = 2.000 m, hm = 200 m; unitățile cunoscute rămân grupate separat; cele neclare cresc restanțele. `*_pe_um` păstrează cantitatea originală, `*_m` este în metri. Rândurile TOTAL nu intră în sumele detaliilor.

## Matrice SQL pentru Claude

Actorii: proprietarul fixture-ului pentru setup; apelurile client sub `SET ROLE authenticated` cu `auth.uid()` setat și acces Ofertare. Așa se verifică trigger-ul invoker, nu doar apelurile făcute ca proprietar. Nu schimbați drepturile de producție. Respectați și `safeupdate`: fiecare UPDATE/DELETE din teste are WHERE.

| ID | Intrare / acțiune | Rezultat așteptat |
|---|---|---|
| A1 | Planșă ilizibilă; F3 conține `1.000 m validat`, `500 ml extras`, `2 hm validat`, `80 mc`, `3 × 100 m`, cantitate NULL | `planse_auto` creează numai `propunere`; `intrebare` nu conține valorile, sume, diferențe ori contoare; review păstrează restanțele și unitățile. Verificați separat că ID-urile din numele documentelor rămân. |
| A2 | Document de tip `lista_cantitati` identificat în fixture | Întrebarea îl identifică prin ID și numele real. Fără un asemenea document cere identificarea documentului financiar; nu afirmă „F3 publicat” sau absența lui. |
| A3 | Reconfirmare cu tokenul din `v_ofertare_clarificari_baza`, apoi `de_trimis`; modificați o cantitate, aceleași ID-uri și aceeași sumă globală | `stare='schimbata'`; textul și statusul se păstrează, exportul și trecerea spre `trimisa` sunt refuzate. `diferente.modificate` identifică rândurile. |
| A4 | Schimbați doar statusul validării, unitatea, sursa, specificațiile, codul articolului ori obiectul unui rând relevant | Hash-ul bazei se schimbă, chiar dacă lungimea globală rămâne aceeași. |
| A5 | Reordonați rândurile / schimbați doar timestamp-ul lor; rescrieți numeric `100` ca `100.000` | Amprenta rândurilor rămâne aceeași. |
| A6 | Conflictul deschis X devine Y, același număr de conflicte; sau rămâne aceeași identitate, dar alte detalii | Hash diferit: sunt incluse tokenul, conținutul conflictelor, restanțele și transferul în curs, nu numai un boolean „există conflict”. |
| A7 | Editează omul `123 m` în `124 m`, formulare liberă; statusul anterior `de_trimis` | Textul nou se salvează; statusul revine la `propunere`; autorul editării și vechile decizii se păstrează. Necesită aprobare nouă indiferent de formularea cifrei. |
| A8 | După citirea tokenului, altă sesiune modifică textul; primul client reconfirmă cu tokenul vechi | RPC refuză; tokenul include hash-ul textului, nu doar datele. |
| A9 | Ciornă v5 fără bază / ciornă r9 cu mod `corespondenta` fără semnătură r9b | Necesită review; nu primește implicit `ok`; nu se reconstruiește nicio „valoare istorică”; generatorul repetat nu rescrie textul. |
| C1 | TOTAL 1.200 m + detalii 1 km și 2 hm, toate validate, aceeași sursă/obiect/categorie/tip | `totaluri_control`: declarat 1.200, detalii 1.200, `ok`; totalul nu se adaugă peste detalii. |
| C2 | C1, dar TOTAL 1.200,1 m | Ambele valori păstrate; `diferit`, mesajul exact din SPEC. WARN în controlul de lucru; aprobarea pachetului / depunerea ofertei BLOCK. |
| C3 | C1, dar un detaliu NULL / extras / `100 m` / unitate absentă | `necomparabil`, mesajul exact din SPEC; aprobarea finală BLOCK; niciun UPDATE pe cantități. |
| C4 | TOTAL fără detalii, TOTAL multiplu, sursă/obiect lipsă sau total din altă sursă | `necomparabil`; nu se însumează automat detalii din alte perimetre ca să „iasă” totalul. |
| C5 | TOTAL și detalii în mc versus m; apoi toate în mc, același perimetru | Prima comparație necomparabilă; a doua în mc, fără conversie în metri. |
| C6 | Baza financiară egală; `cantitate_plansa` diferită sau lipsă | `ofertare_totaluri_control(lic,'cantitate')` și `(lic,'cantitate_plansa')` păstrează rezultate distincte; fără fallback. |
| D1 | Instalați în fixture un trigger pe `notifications` care ridică eroare; modificați F3 validat | Editarea cantității se salvează; istoricul și invalidarea 1/1b sunt corecte. Apelul separat `ofertare_clarificari_notifica` returnează eroare. Marcajul de notificare nu se salvează, pentru a permite retry. |
| D2 | Repetați notificarea pe aceeași bază schimbată, apoi pe o bază nouă | O notificare pe revizie; apelurile repetate, inclusiv intercalate cu v6, nu multiplică notificările. V6 notifică numai crearea; schimbările sunt notificate de RPC-ul de citire. Textul / statusul ciornei rămân intacte. |
| D3 | În fixture, faceți funcția de bază indisponibilă / ridicați eroare în control | Scrierea F3 nu o apelează. `de_trimis` / `trimisa` și `ofertare_clarificari_export` sunt refuzate; lipsa controlului nu devine `ok`. |
| D4 | View-ul cantităților sau controlul TOTAL indisponibil | `fn_gate_depunere` și aprobarea pachetului refuză finalizarea. Derogarea nu ocolește controlul R5. |
| D5 | UPDATE în lot pe multe rânduri F3 | Nu există `trg_zzz_ofertare_cantitati_clar_baza`; nicio scanare a bazei clarificărilor per rând. Istoricul / invalidarea 1/1b continuă per rând. |
| E1 | Client UPDATE direct `cheie=NULL`, altă cheie, `origine`, `licitatie_id`, `baza_generare=NULL`, semnătură fabricată | Refuz; proveniența și aprobarea nu pot fi resetate. Încercați și text+cheie+status în aceeași comandă. |
| E2 | INSERT client cu cheie `auto_planse_*`; DELETE ciornă automată apoi reinserare | Refuz; ciornele automate sunt create de generator și retrase prin status, nu șterse pentru pierderea provenienței. |
| E3 | Clarificare transmisă; date schimbate; reconfirmare `luat_act`; apoi încercare `de_trimis` ori export | Textul / fișierul transmis rămân imuabile; revenirea la ciornă refuzată; `luat_act` nu este aprobare. Modificarea întrebării sau PDF-ului transmis și DELETE sunt refuzate. Răspunsul autorității rămâne editabil. |
| E4 | Reconfirmare `revizuit` cu token exact, apoi date schimbate înainte de `de_trimis` | Trecerea refuzată în trigger, fără dependență de deschiderea unui ecran. |
| E5 | Conflict încă deschis; omul verifică textul despre conflict și reconfirmă, apoi `de_trimis`, export, `trimisa` | Toate permise pentru clarificare; conflictul rămâne deschis și blochează aprobarea finală a ofertei. Nimic nu se transmite automat. |
| E6 | Schimbare concurentă a întrebării în timpul exportului | Exportul citește întrebarea blocată `FOR SHARE` și o verifică în backend; nu combină textul unei citiri cu aprobarea altei citiri. Documentul reflectă versiunea controlată la momentul exportului. |
| R1 | Ciornă umană cu antet standard; apeluri v6 repetate, date neschimbate | Textul / autorul / aprobarea sunt păstrate; fără notificări duplicate. Semnătura umană protejează și textul identic cu cel generat. |
| R2 | Rollback după două reconfirmări + luat_act, apoi reaplicare | Coloana `baza_generare`, textele aprobate, actorii, notele, tokenii și `istoric_decizii` supraviețuiesc. Nu există `DROP COLUMN baza_generare`. |

La verificarea migrării comparați hash-urile datelor fixture înainte/după aplicare: aplicarea definițiilor nu rescrie cantități, clarificări sau decizii umane. Verificați și rollback-ul complet, inclusiv dependențele funcțiilor noi.

## Validarea locală din această sesiune

- `node --test --test-isolation=none scripts/test-r5-r9b.mjs`: **9/9**.
- Diagnostic suplimentar al celor 7 suite pure afectate, cu `node:test` + adaptor temporar `node:assert`: **325/325**. Adaptorul din `.jak` nu este Vitest și nu se livrează ca înlocuitor al lui.
- `node --check` pe cele șase module JS de implementare: OK.
- `npx vitest run`: nu a pornit, dependența lipsește și npm offline răspunde `ENOTCACHED`.
- `npx vite build`: nu a pornit, același blocaj pentru Vite.
- Încercările de restaurare prin `npm ci` au eșuat: cache incomplet; încercarea cu rețeaua activată explicit a produs eroarea npm `Exit handler never called` în mediul restricționat.
- PGlite / Deno / API real: **nerulate** aici. Ultimul este interzis de SPEC. Nu există dovadă locală de build sau de execuție SQL; acestea sunt condiții restante înainte de aplicare.
