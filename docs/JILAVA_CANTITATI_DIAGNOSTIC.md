# Jilava (lic. 93): de ce sunt 0 cantități în platformă

Diagnostic din 25.09.2026, runda 2 (după verificarea independentă din runda 1). Runda 3 a adus finisajele cerute de verificare: R3 și eticheta din §2, reluarea la 401/403 (§3.A), interdicția de re-rulare după retipizare (§4) și SQL-ul din §5. În BD s-a rulat doar SELECT, plus s-au citit loguri Edge și cod. Nu s-a rulat nimic plătit, nu s-a scris nimic în BD, nu s-a făcut deploy și nu s-a făcut push.

## 1. Concluzie
**Extragerea cantităților nu a pornit niciodată pentru licitația 93.** Nu e o problemă de filtru și nici de document: nu există niciun declanșator automat, iar din butonul 🤖 nu a pornit nicio rulare. La 25.09.2026, ~22:00 UTC (runda 2), starea e aceeași: `ofertare_cantitati` are 0 rânduri pe lic. 93, iar `ai_usage_log` are 0 apeluri `ofertare-cantitati-extrage` cu `ref_id=93` (SELECT count).

Singurul POST din browser către funcție în ultimele 24 h (25.09, 15:53:55 UTC) a primit **403** de la poarta pe cheltuială, de pe contul „Claude” (10c105d3…). **Apelul nu a venit din buton.** Corpul lui avea 40 B (`function_edge_logs`, `content_length=40`). Butonul trimite `{"licitatie_id":93,"de_la":0}`, adică 29 B, și cel mult ~31 B pentru orice licitație. Din log nu se poate afla nici licitația apelului.

**Bugul de afișare există și se vede din cod** (§3), dar nu e dovedit că l-a văzut cineva pe Jilava.

## 2. Dovezi
| Fapt | Sursă |
|---|---|
| `ofertare_cantitati`: 0 rânduri pe lic. 93. Tabelul are rânduri doar pe alte licitații: `lista_f3` 756, `lista_c6` 77 și `lista_alt` 29, toate pe lic. 5 (Domnești) | `SELECT tip_sursa, licitatie_id, count(*) … GROUP BY` |
| Doc 434 (`…LST-002-00-R Cantitati de lucrari.pdf`): tip `lista_cantitati`, 83 de pagini, `text_extras` = 141.697 de caractere, OCR, cu marcaje `⟦PAGINA n⟧` | `ofertare_documente_atribuire` id=434 |
| **26 de liste F3.** Le-am numărat după antetul „Lista cu cantitati de lucrari pe categorii de lucrari” (26 de apariții). Tot 26 apar „TOTAL 1 (Cheltuieli directe)” și „Stadiul fizic:”. Șirul „Formular F3” apare de 89 de ori, pentru că e și antet, și subsol de pagină: nu e numărul de liste | `regexp_matches` pe `text_extras` id=434 |
| **Doc 434 are și anexele C6–C9:** C6 „Lista cuprinzand consumurile de resurse materiale” (pag. 76–80), C7 manoperă (pag. 81), C8 utilaje (pag. 82), C9 transport (pag. 83). Între pag. 1 și 75 nu apare niciun antet C6–C9. După pag. 76 nu mai apare niciun antet F3 | SELECT pe pagini (`⟦PAGINA n⟧`), secțiunile [0, 121.853) / [121.853, 137.048) / [137.048, 141.697) |
| Pag. 1–9, 18–19, 28–29, 44–45, 60–61 și 68–69 sunt DEVIZ GENERAL / CENTRALIZATORUL: valori în lei, fără cantități. Pe pag. 10–75, regex-ul R3 (mai jos) prinde 88 de linii de capitol „N \| 4.x… / 6.x \| …”: 80 cu 4.x (ex. „10 \| 4.1.4 \| Instalatii”) și 8 cu 6.x („17 \| 6.2 \| Probe tehnologice si teste”). Toate sunt pe paginile de centralizator 18, 19, 28, 44, 60 și 68, deci nu sunt poziții F3. Forma strictă „N \| x.y.z” dă 40. Cifra e informativă și nu intră în reper | SELECT pe pagini (spații normalizate), refăcut în runda 3 |
| În `ai_usage_log` nu e niciun apel `ofertare-cantitati-extrage` cu ref_id=93. Singurele sunt 32 de apeluri pe lic. 5 (11.09, 1,28 $) | `ai_usage_log` (runda 1, confirmat de verificator) |
| Logurile Edge nu au niciun apel al funcției între 17.09 și 24.09. Pe 25.09 sunt 7 POST-uri curl de test (cheie anon sau JWT fals), care au primit 401, și un POST din browser cu 403 (§1) | `query_logs` (runda 1, confirmat de verificator) |
| Singurul care apelează funcția e butonul din `src/OfertareCantitati.jsx`. Worker-ul NAS și `ofertare-ingest-doc` nu pornesc extragerea | `grep cantitati-extrage` |
| F3-ul din 24.09 s-a făcut în afara platformei: clarificările 10–18 (id 54–62) au `origine='manual'`, `cantitate_id` NULL, `status='de_trimis'` | `ofertare_clarificari` (runda 1) |

### Reperul de verificare pentru doc 434 (nu ~307 de rânduri)
Am numărat linii din `text_extras`, după ce am normalizat spațiile (SELECT cu `regexp_split_to_table` pe pagini):

| Secțiune (pagini) | Ce am numărat | Câte |
|---|---|---|
| F3 (10–75), poziții principale | linii „nr întreg · COD - denumire” (regex R1) | **190** (189 distincte pe pagină) |
| F3 (10–75), sub-rânduri de material | linii „x.y · cod - denumire” (regex R2) | **105** |
| C6 (76–80) | resurse cu număr distinct | **105** (nr. 1–105; pagina 76 apare de două ori în text: 44 de linii, 22 de numere distincte) |
| C7 (81) / C8 (82) / C9 (83) | rânduri numerotate | **25 / 15 / 0** (C9 are doar „TOTAL Transport”) |

```
R1: ^\|?\s*[1-9][0-9]*\s*\|\s*\S+\s+-\s
R2: ^\|?\s*[0-9]+\.[0-9]+\s*\|\s*\S+\s+-\s
R3: ^\|?\s*[0-9]+\s*\|\s*[0-9]+\.[0-9]+          (doar pentru cifra informativă din §2: linii de capitol din centralizator)
```

Verificatorul din runda 1 a numărat, cu alt regex, ~214 poziții F3, ~94 de sub-rânduri și ~90 de rânduri C6–C9. **Reperul pentru F3 este deci ~190–214 poziții principale, plus ~94–105 sub-rânduri de material.** C6–C9 (~145 de rânduri distincte după numărătoarea de mai sus) se numără **separat**, nu în F3. Cifra de ~307 din runda 1 amesteca F3 cu C6–C9 și nu mai e reper.

## 3. Ce e reparat pe ramura `claude/jilava-cantitati-extragere-erori` (locală, nepushată)
**A. Butonul 🤖 din 📋 Cantități** (`src/OfertareCantitati.jsx`, bucla mutată în `src/ofertareExtragereCantitati.js`). Codul vechi (8a6fbbb) avea patru probleme:
1. La non-2xx afișa mesajul generic al supabase-js („Edge Function returned a non-2xx status code”). Motivul real (de ex. „o pornește doar ownerul sau responsabilul”) stă în `error.context`.
2. La eroare făcea `break`, apoi apela imediat `showToast('Extragere terminată: N rânduri noi','ok')`. Toast-ul e unul singur, deci eroarea era înlocuită de un fals succes. Testul „VECHE” rulează o copie a buclei vechi: la un 403 produce `[err …non-2xx…]` urmat de `[ok Extragere terminată: 0 rânduri noi]`.
3. După 40 de apeluri se oprea tot cu „terminată”, deși serverul răspundea `continua=true`.
4. Ignora `raport[].eroare` (felii cu răspuns neinterpretabil sau cu eroare de furnizor).

Acum stările sunt `ok`, `partial`, `neterminat` și `eroare`, iar mesajul arată motivul real și statusul HTTP. **Reluarea** pornește de la felia unde s-a oprit, fără să plătească din nou feliile deja făcute (upsert-ul previne dublurile, nu costul). Se reia în două situații:
- după plafonul de apeluri;
- **după o eroare trecătoare la mijlocul rulării** (`eroare` cu `deLa > 0` și status ≠ 401/403, de ex. 504/546 sau o eroare de furnizor). Butonul devine „🤖 Continuă extragerea (felia X)”. Reluarea nu pornește singură: cere clic și confirmare.

La 401/403 nu se oferă o reluare nouă și nici mesajul „apasă din nou”. Dacă însă exista deja o reluare de dinainte de clic, ea se păstrează: pe aceeași licitație avansează până la felia apelului refuzat, iar pentru altă licitație rămâne neschimbată. Altfel, următorul clic ar porni de la felia 0 și ar replăti feliile deja făcute (runda 3). Funcția pură `reluareDupa(r, licId, anterioara)` are 9 teste.

**B. `mesajInvoke` într-un singur loc:** `src/lib/mesajInvoke.js`, plus `statusInvoke`. Până acum existau copii identice în `OfertareLicitatii.jsx` și în modulul extragerii. `OfertareLicitatii.jsx` o importă acum; corpul funcției nu s-a schimbat.

**C. Funcția `ofertare-cantitati-extrage`: `tip_sursa` pe secțiuni** (`sectiuni.ts` nou, `handler.ts`).
- Problema: handlerul punea `tip_sursa='lista_f3'` pe **toate** rândurile unui document `lista_cantitati`. Pe doc 434 rândurile C6–C9 ar fi intrat ca F3. Efectele: ar fi umflat `v_ofertare_pt_stare.lista_f3_m`; `lista_c6_m` ar fi rămas NULL; `controlCantitati` (`src/ofertareControale.js:30`) ar fi comparat greșit.
- Schema nu se schimbă. Constrângerea `ofertare_cantitati_tip_sursa_check` permite deja `lista_f3`, `lista_c6`, `lista_alt`, `memoriu`, `plansa`, `caiet` și `alt` (`pg_constraint`). Valorile sunt cele din backfill-ul 13.09 (migrarea `ofertare_cantitati_tip_sursa_h2_lista`), folosite pe Domnești: C6 → `lista_c6`, C8/C9 → `lista_alt`.
- Regula: **tipul se decide în cod, din antetele din text, nu din ce răspunde modelul.** „Formular F3” / „Lista cu cantitati de lucrari…” dă `lista_f3`. „Formular C6” / „Lista cuprinzand consumurile de resurse materiale” dă `lista_c6`. „Formular C7/C8/C9” / „…consumurile cu mana de lucru / de ore de functionare / privind transporturile” dă `lista_alt`.
- Ultimul antet întâlnit decide secțiunea. Granița se pune la începutul paginii antetului. Textul dinaintea primului antet ține de primul formular.
- **Feliile nu mai trec peste o graniță de secțiune**, deci fiecare felie are un singur tip, scris și în `raport[].tip_sursa`. Răspunsul are acum și `pe_tip_sursa`.
- La începutul unei secțiuni noi, obiectul F3 nu se mai moștenește: C6 e pe investiție, nu pe Obj6.
- **Varianta aleasă e cea sigură.** Nu am ales „excludere” sau „marcaj în `diferenta_nota`”, pentru că există o valoare permisă care se potrivește exact. Un document fără antete diferite se feliază **identic** cu varianta veche (test). Documentele `cs_volum`/`alta` rămân fără `tip_sursa`, ca înainte. Rândurile existente nu se ating, pentru că upsert-ul folosește `ignoreDuplicates`.
- Ce se schimbă concret în BD (`regexp_matches` pe toate cele 13 documente `lista_cantitati` cu text):
  - **Doc 434:** se schimbă felierea, din 3 felii în 5 (F3 3 + C6 1 + C7–C9 1). Caracterele trimise rămân aceleași: 145.697.
  - **Fișierele C6/C7/C8/C9 de pe Domnești (doc 165–168):** la o nouă rulare ar primi `lista_c6`/`lista_alt`, nu `lista_f3` ca în codul vechi. Rândurile existente au deja tipul corect, din backfill.
  - **Restul documentelor** (lic. 3, 5, 15): o singură secțiune, felii identice.

**Teste** (rulate pe ramură):
- `npx vitest run`: 393/393, dintre care 21 în `src/ofertareExtragereCantitati.test.js` (runda 3: +4 teste pentru reluarea la 401/403; cu regula veche, care întorcea null la 401/403, 3 dintre ele pică)
- `npm install && npx vite build`: OK
- `deno test --node-modules-dir=none --no-lock supabase/functions/ofertare-cantitati-extrage/`: 25/25 (12 pentru poartă + 13 pentru secțiuni)
- `supabase/functions/ofertare-plansa-citeste/`: 44/44, pentru că `_test/fake_supa.ts` înregistrează acum și payload-ul de upsert
- Test de mutație: cu vechea regulă `tip_sursa='lista_f3'`, 2 teste de handler pică

## 4. Cum se populează cantitățile Jilavei (decizia și apăsarea îi aparțin lui Razvan)
**Cine poate porni (poarta pe cheltuială, `poarta.ts` + `handler.ts`):** doar ownerii, **Razvan Trusu** și **Tudorache Marilena Claudia** (`profiles.is_owner`), sau responsabila lic. 93, **Cristina Dumitrescu** (`ofertare_licitatii.responsabil_id`). Contul „Claude” primește 403. Calea `x-radar-secret` (worker) sare peste poarta de owner și cere OK explicit de la Razvan.

**Ordinea contează.** Funcția live e cea veche până la PR + merge + **deploy** pentru `ofertare-cantitati-extrage` (cu `sectiuni.ts`). O rulare înainte de deploy scrie C6–C9 ca `lista_f3`. Asta se repară doar cu retipizare prin UPDATE, cu preview și confirmare (SQL-ul (4) din §5).

**După retipizare NU se reia extragerea pe feliile C6–C9 (indicii 20–21 după deploy).** Altfel rândurile se dublează, din cauza cheii de upsert:
- Cheia este indexul unic `uq_ofertare_cantitati_sursa` pe (`licitatie_id`, `denumire`, `sursa`), iar `sursa` = `nume — obiect | cod | loc`.
- În codul vechi, rândurile C6–C9 moștenesc obiectul F3 de dinainte (ex. „Obj6 …”), care intră în `sursa`.
- Codul nou golește obiectul la începutul secțiunii, deci `sursa` iese, de regulă, alta. Upsert-ul nu mai prinde conflictul și rândurile C6–C9 intră a doua oară.
- `obiect = NULL` din UPDATE (opțional) nu schimbă `sursa`, deci nu previne dublarea.

Același lucru, mai slab, pentru restul doc 434:
- Feliile F3 17–18 au același text în ambele coduri.
- Felia 19 nu mai are același text: în codul vechi conținea și C6–C9, în cel nou se oprește înainte de pag. 76.
- Modelul nu e determinist, deci o re-rulare nu garantează aceeași `sursa`.

**Regula: după o rulare pe codul vechi, doc 434 nu se mai extrage deloc (nici B, nici butonul A); se repară doar prin UPDATE.** Dacă totuși se vrea o extragere curată, întâi se șterg rândurile vechi ale doc 434 (DELETE cu preview, confirmare și `array_agg(id)`), apoi se rulează. Variantele de mai jos presupun că nu s-a rulat nimic înainte de deploy (azi, 25.09 seara: 0 rânduri pe lic. 93).

| Varianta | Ce face | Cost (gpt-5-mini) |
|---|---|---|
| **B. Doar doc 434, după deploy** (recomandat) | **5 apeluri separate**, fiecare `{licitatie_id:93, de_la:N, max_felii:1}` pentru N = 17, 18, 19, 20, 21 (doc 434 ocupă feliile 17–21 din 54 după deploy; înainte ocupa 17–19 din 52). Apelul se face cu JWT-ul unui owner sau al responsabilei. Tipurile așteptate pe felii: `lista_f3`, `lista_f3`, `lista_f3`, `lista_c6`, `lista_alt`. **Verificare după FIECARE apel:** `raport[0].doc` = „…LST-002-00-R Cantitati de lucrari.pdf”, `raport[0].bucata` = „k/5”, `raport[0].tip_sursa` cel așteptat, fără `raport[].eroare`, `stop` ≠ `max_output_tokens`, apoi `cost_usd`, `pe_tip_sursa` și durata (trebuie să fie mult sub ~150 s). Dacă o felie iese „raspuns neinterpretabil” / `max_output_tokens` (riscul e mai ales pe N=18: ~178 de rânduri candidate, ~12,5k tokeni de ieșire din plafonul de 16k), se reia **o singură dată** doar felia respectivă. Dacă pică din nou, **nu se mai reia**: se decide o felie mai mică, ceea ce înseamnă cod | estimat ~0,075 $; plafon ~0,17 $ |
| **A. Butonul din UI** | Procesează **43 de documente / 54 de felii** (52 înainte), adică `lista_cantitati`, `cs_volum` și `alta`, inclusiv Plan SSM, bibliografie, acorduri și 23 de planșe tipizate `alta`. Rezultă și rânduri-zgomot fără `tip_sursa`. După fix, butonul nu reia singur: după o eroare trecătoare oferă «Continuă de la felia X» (eticheta „🤖 Continuă extragerea (felia X)”), cu clic și confirmare, fără să replătească feliile făcute | plafon ~1,81 $ |
| **C. Cod: parametru `doc_ids`** + opțiunea „doar lista F3” în UI | Face A la fel de curată și de ieftină ca B. Cere PR și deploy (funcție + front) | ca B |

Baza estimărilor:
- Tarif 0,25 $/2 $ per M tokeni (`handler.ts`, `MODELE.openai_mini`). ~3,2 caractere/token: presupunere, nemăsurată pe Jilava. Prompt de ~900 de tokeni pe felie. Plafonul de ieșire e 16.000 de tokeni pe felie (`max_output_tokens`).
- **B:** intrarea e 145.697 de caractere, adică ~45,5k tokeni, plus 5 × 900, deci ~50k (0,0125 $). Ieșirea: ~441 de rânduri (F3 ~295 cu sub-rânduri, C6–C9 ~146) × ~70 de tokeni ≈ 31k (0,062 $). Plafon: 5 × 16k × 2 $/M = 0,16 $, plus intrarea.
- Rânduri candidate pe felie (regexurile din §2): 1 → 78, 2 → 178, 3 → 46, 4 (C6) → 127 de linii / 105 distincte, 5 (C7–C9) → 40.
- **A:** 949.739 de caractere cu suprapunere, adică ~297k tokeni, plus 54 × 900, deci ~345k (0,086 $). Plafon de ieșire: 54 × 16k × 2 $/M = 1,728 $.

## 5. După rulare: doar SELECT, apoi UPDATE numai cu preview și confirmare
1. Breakdown pe felie și tip pentru doc 434. Reperul: felii 1–3 `lista_f3` ≈ 190–214 principale + 94–105 sub-rânduri; felia 4 `lista_c6` ≈ 105; felia 5 `lista_alt` ≈ 40.
2. Rândurile `lista_f3` cu `cantitate IS NULL`. Pot veni din paginile DEVIZ GENERAL / CENTRALIZATOR (§2) și sunt zgomot, nu clarificări.
3. Cele 9 anomalii (TSE01C1 121,5 × 100 mp etc.). Apoi `v_ofertare_contradictii` pe 93, plus `lista_f3_m` / `lista_c6_m` din `v_ofertare_pt_stare`.
4. **Doar dacă s-a rulat înainte de deploy:** retipizarea C6–C9 scrise ca `lista_f3`. Se face cu preview și confirmare. După ea, doc 434 nu se mai extrage (§4).
5. Legarea clarificărilor 54–62 la `cantitate_id`: UPDATE cu preview și confirmare. Azi toate 9 au `cantitate_id` NULL.

Coloanele sunt verificate în `information_schema` (25.09, runda 3). Toate SELECT-urile au rulat fără eroare pe BD. Rezultatele de azi: (1), (2), (4) și primele două interogări din (3) întorc 0 rânduri. `v_ofertare_pt_stare` întoarce un rând cu toate cele 4 valori NULL, iar (5) întoarce 9 clarificări. UPDATE-urile sunt comentate. **NEEXECUTAT.**

```sql
-- 1) Breakdown pe felie (în document) și tip pentru doc 434. ordine = nr_felie*100000 + poziție.
--    Reper după deploy: felii 1–3 lista_f3 ≈ 190–214 principale + 94–105 sub-rânduri; felia 4 lista_c6 ≈ 105; felia 5 lista_alt ≈ 40.
SELECT ordine/100000 AS felia, tip_sursa, count(*) n, count(*) FILTER (WHERE cantitate IS NULL) fara_cant
FROM ofertare_cantitati
WHERE licitatie_id = 93 AND sursa LIKE 'PT/pdf/parte scrisa/CLJ-02-2025-DD- CPD-PL-LST-002-00-R%'
GROUP BY 1,2 ORDER BY 1,2;

-- 2) Zgomot posibil din paginile DEVIZ GENERAL / CENTRALIZATOR (rămân în secțiunea F3)
SELECT id, ordine, denumire, um, cantitate, sursa FROM ofertare_cantitati
WHERE licitatie_id = 93 AND tip_sursa = 'lista_f3' AND cantitate IS NULL ORDER BY ordine;

-- 3) Anomaliile + controalele
SELECT id, obiect, cod_articol, denumire, um, cantitate, tip_sursa FROM ofertare_cantitati
WHERE licitatie_id = 93 AND cod_articol IN ('TSE01C1','CMTE01C3','M1L29A1','M1G27A1','W2G01A01','ACB08A1','PIZ-UV','IZ-UV','PC-13mm','IZZ-PC-DN700','MTP-DN350-DN200','CG32A#[1]','TSD06A1') ORDER BY ordine;
SELECT fel, count(*) FROM v_ofertare_contradictii WHERE licitatie_id = 93 GROUP BY fel;
SELECT lista_f3_m, lista_c6_m, memoriu_m, plansa_m FROM v_ofertare_pt_stare WHERE licitatie_id = 93;

-- 4) DOAR dacă s-a rulat ÎNAINTE de deploy. Codul vechi taie doc 434 în 3 felii, iar C6–C9 (de la pag. 76)
--    cad toate în felia 3, scrise ca lista_f3.
--    Preview: felia 3 veche (ordine 300000–399999), în ordinea documentului. `sugestie` e doar un indiciu, luat
--    din obiect + partea de după „ — ” a sursei (fără numele fișierului). Pe Domnești (lic. 5) indiciul
--    potrivește exact: 77/77 lista_c6, 29/29 lista_alt și 0 din 756 lista_f3. Granița F3 → C6 o confirmă
--    omul pe preview. Rezultatul preview-ului (id, obiect) se PĂSTREAZĂ: e rollback-ul pentru obiect=NULL.
--    ATENȚIE: după retipizare NU se reia extragerea pe feliile C6–C9 (indicii 20–21 după deploy) și nici
--    pe restul doc 434. `sursa` rândurilor vechi conține obiectul F3 moștenit (ex. „Obj6 …”), iar cea nouă nu.
--    Cheia de upsert (licitatie_id, denumire, sursa) nu prinde conflictul, deci rândurile se dublează (§4).
SELECT id, ordine, obiect, cod_articol, denumire, um, cantitate, sursa,
       CASE WHEN concat_ws(' ', obiect, split_part(sursa, ' — ', 2)) ~* '\mC\s*6\M|resurse\s+materiale' THEN 'lista_c6'
            WHEN concat_ws(' ', obiect, split_part(sursa, ' — ', 2)) ~* '\mC\s*[789]\M|m[aâă]n[aă]\s+de\s+lucru|ore\s+de\s+func|transporturi' THEN 'lista_alt'
       END AS sugestie
FROM ofertare_cantitati
WHERE licitatie_id = 93 AND tip_sursa = 'lista_f3'
  AND sursa LIKE 'PT/pdf/parte scrisa/CLJ-02-2025-DD- CPD-PL-LST-002-00-R%'
  AND ordine BETWEEN 300000 AND 399999
ORDER BY ordine;
-- Două UPDATE-uri, câte unul pe tip (lista_c6, apoi lista_alt), numai pe id-urile confirmate pe preview:
-- WITH u AS (
--   UPDATE ofertare_cantitati
--      SET tip_sursa = 'lista_c6',      -- respectiv 'lista_alt' pentru C7–C9
--          obiect = NULL,               -- opțional: C6–C9 sunt pe investiție, nu pe Obj6. `sursa` NU se schimbă
--          updated_at = now()
--    WHERE licitatie_id = 93 AND tip_sursa = 'lista_f3' AND id = ANY('{<id-uri confirmate>}'::bigint[])
--   RETURNING id)
-- SELECT count(*), array_agg(id ORDER BY id) AS rollback_ids FROM u;
-- Sanity: se reia (1) și trebuie să apară felia 3 împărțită în lista_f3 / lista_c6 / lista_alt.

-- 5) Legarea clarificărilor 54–62 la cantitate_id: preview, apoi câte un UPDATE per clarificare
SELECT id, nr, intrebare, sursa, cantitate_id, status FROM ofertare_clarificari
WHERE licitatie_id = 93 AND id BETWEEN 54 AND 62 ORDER BY nr;
-- UPDATE ofertare_clarificari SET cantitate_id = <id poziție>, updated_at = now()
--  WHERE id = 54 AND licitatie_id = 93 AND cantitate_id IS NULL RETURNING id, cantitate_id;
```

## 6. Checklist Jilava (2–11): ce depinde de cantități
| # | Depinde? | De ce |
|---|---|---|
| 2 Cerințe susținute | nu (direct) | — |
| 3 Clarificări propagate | **da** | clarificările 10–18 (F3) au `cantitate_id` NULL, deci răspunsul autorității nu are poziție pe care să se propage |
| 4 Dovezi + titular | nu | — |
| 5 Date tehnice/planificare | **da** | GraficPoarta: rândul „Cantități rețea în platformă” e `block` când sunt 0 rânduri, iar butonul „Generează grafic” e inactiv (`src/GraficPoarta.jsx:293,374`). `lista_f3_m` e NULL |
| 6 Redactare trasabilă | indirect | capitolele care citează cantități n-au sursă în platformă |
| 7 Coerență între piese | **da** | `v_ofertare_contradictii` și controlul F3↔C6 n-au ce compara. Cu fixul §3.C, C6 intră separat și controlul devine posibil |
| 8 Pachet verificat după asamblare | **da** | F3-ul din pachet nu are în platformă o referință de comparat |
| 9 Aprobare = exact pachetul | nu | — |
| 10 Drepturi și erori | parțial | poarta 403 funcționează. Afișarea erorilor e reparată pe ramură (nemergeată) |
| 11 Semnare/depunere | nu | — |

## 7. Atenționări (nereparate, de decis)
- **Planșele Jilava (23 de documente, id 441–463, „…parte desenata/…-DWG-…”) sunt tipizate `alta`.** `ghicesteTip` (`src/OfertareLicitatii.jsx:655`, regex `/desene|plans|palnse|\.dwg$|izometri/`) nu prinde „desenata” și nici „-DWG-”, deci controlul planșă↔F3 e imposibil. Fixul regex și retipizarea (UPDATE cu confirmare) cer decizie separată.
- `v_ofertare_contradictii` nu filtrează pe `tip_sursa`. Rândurile C6 fără consum (de ex. „Material marunt | %” gol) vor apărea ca `cantitate_lipsa`, la fel ca rândurile de centralizator. De filtrat după rulare, nu de trimis la clarificări.
- Paginile DEVIZ GENERAL / CENTRALIZATOR rămân în secțiunea F3: nu au antet de formular, iar pag. 1–9 țin de primul formular. Dacă modelul scoate rânduri din ele, acestea apar ca `lista_f3` cu `cantitate` NULL (vezi §5.2).
- `termen_depunere` pentru 93 e stocat `2026-10-02 12:00:00+00`, adică 15:00 ora României. De verificat în anunțul SEAP.
- După extragere trebuie verificat dacă `fn_categorie_cantitate` pune pe rândurile Jilava (tub de protecție DN700) categoria rețea/conductă. Altfel GraficPoarta rămâne pe `block`.
