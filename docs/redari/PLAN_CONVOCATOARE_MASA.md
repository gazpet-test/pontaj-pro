# Plan — convocatoarele în masă pe UAT (L1, BRIEF §4.1)

04.11.2026 · branch `redari/convocatoare-masa` · fără migrări, fără reguli noi în client.

## Ce face
Pe tab-ul **🏛️ UAT-uri**, un panou nou (admin / editor): alegi UAT-ul → **Verifică** (citește, nu scrie nimic) → **📦 Generează
convocatoarele UAT-ului** → la final descarcă un singur zip:
`convocatoare_{proiect}_{UAT3}_{data}.zip` = DOCX-urile (`{nr_document}_{id_parcela}.docx`, același nume ca la generarea pe rând)
+ `borderou.csv` (formatul existent `borderouCsv`, contract §8) + `opis.xlsx` (foi: „Opis” = toate rândurile cu stare și motiv,
„Borderou” = doar convocările din zip).

Locul: tab-ul UAT-uri (un rând schimbat în `Redari.jsx`, la randarea tab-ului), ca să nu ating zona convocatorului din Registru
(~390–420), `docx.js` sau `PlicuriEcran.jsx`. Logica pură: `src/redari/convocatoareMasa.js`; UI: `src/redari/ui/ConvocatoareMasa.jsx`.

## Pași
1. **Pregătire (read-only)**: rândurile UAT-ului din `red_v_stare_parcela` (paginat), apoi în loturi de 100 id-uri: `red_detinatori`
   (COL_DETINATOR), `red_parcele`, `red_detinatori_contact`, `red_detinatori_token`, `red_convocari` active.
2. **Gărzi, aceleași ca la generarea pe rând** (funcțiile existente, importate):
   - pe UAT / proiect: `motivBlocareConvocator(proiect, uat, null)` — fără împuternicire, fără zi de sesiune cu program, fără contract,
     contact, GDPR sau reprezentant TGZ → **tot lotul blocat**, cu motivul, nimic consumat (azi LOT1 se oprește aici: fără împuternicire);
   - pe rând: `motivBlocareConvocator(proiect, uat, rand)` (neidentificat, adresă necunoscută) și `verificaDateConvocator(...)` cu
     contactul PII și tokenul (adresă, calitate, token etc.) → rândul e **exclus cu motiv**, fără număr consumat.
3. **Idempotență** (pe convocările poștale `stare = 'activ'` ale deținătorului):
   - una neexpediată **cu fișier** → **nu primește număr nou**; documentul existent se descarcă din bucket și intră în zip („reluat”);
   - una neexpediată **fără fișier** (upload / legare eșuate anterior) → același număr, documentul se regenerează cu data convocării
     și se încarcă prin `reincarcaConvocator` (calea versionată existentă), apoi intră în zip („reîncărcat”);
   - mai multe neexpediate → exclus, „rezolvă în Fișa parcelei” (nu alegem noi);
   - una deja **expediată** → exclus („are deja convocare poștală expediată”); re-trimiterea rămâne pe rând, din Fișă;
   - altfel → **nou**: `supabase.rpc('fn_red_numar_document', { p_tip:'C', p_uat3, p_tronson })` (EXACT apelul din `ModalConvocator`)
     → `genereazaConvocator` → `salveazaConvocator(..., canal:'posta')` (INSERT → upload v1 → UPDATE, ca pe rând).
   Rerularea aceluiași UAT după o întrerupere reia de unde a rămas: ce s-a generat devine „reluat”, nu consumă alt număr.
4. **Limită pe lot**: implicit și maxim **200** de rânduri acționabile pe rulare; restul rămân „amânat — rulează din nou”.
5. **Progres + oprire**: contor `i / n` și pasul curent; butonul **Oprește** se verifică înainte de fiecare rând (rândul în lucru se
   termină, restul → „neprocesat (oprit)”). Zip-ul se face și după oprire, cu ce s-a generat.
6. **Erori per rând**: o eroare (RPC, generare, upload, legare, descărcare) se notează pe rând (cu numărul deja rezervat, dacă e cazul)
   și lotul continuă. Raport final în panou + în foaia „Opis”: generate / reluate / reîncărcate / excluse / erori / amânate.
   Un rând cu număr rezervat dar fără convocare salvată = gol în numerotare (exact ca la generarea pe rând); cu rând salvat dar
   fără fișier → următoarea rulare îl ia pe „reîncărcat”.

## Ce NU face
- nu marchează nimic expediat (`data_expediere` rămâne NULL), nu trimite nimic (poștă, SMS, e-mail);
- nu schimbă RLS, schema, RPC-uri, numerotarea sau gărzile (doar le importă);
- nu generează pentru alt canal decât poșta; afișarea la primărie rămâne pe fluxul ei (Adresa UAT).

## Teste (vitest, client fals, fără BD)
Blocare pe proiect (fără împuternicire → zero RPC), excluderi cu motiv, idempotență (reluat / reîncărcat / nou), limita, oprirea,
eroare pe un rând fără oprirea lotului, zip + opis + borderou. Notă: `fn_red_numar_document('C')` are un contor **global** (cheia `C`,
nu pe proiect) — o probă reală pe TEST-RAZVAN consumă numere din aceeași serie cu LOT1, deci nu s-a făcut nicio probă reală.
