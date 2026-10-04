# Audit read-only Magazie + AchiziÈ›ii â€” Jakarinos, 04.10.2026 (raport brut)

Generat de Jakarinos (Codex, sandbox read-only) dupÄƒ C:\Users\Public\paw\noapte\BRIEF_C.md, pe origin/main 79a5f09.
Neverificat Ã®ncÄƒ de Claude, cu o excepÈ›ie: magazie_bucati.provenienta (CHECK gazpet|beneficiar) â€” confirmat È™i reparat Ã®n 7067f10.

## Partea 1 — Magazie și apelurile de transfer

**1. [major] `src/MagazieProductie.jsx:479` — lot finalizat înaintea creării stocului. P5, P8**

Finalizarea marchează lotul `finalizat`, apoi creează separat fiecare bucată, seria și mișcarea agregată. O eroare intermediară lasă un lot finalizat cu stoc incomplet. După reîncărcare, UI ascunde finalizarea; înainte de reîncărcare, reîncercarea poate recrea bucăți.

```js
const { error } = await supabase.from('productie_loturi').update({ status:'finalizat', data_finalizare: azi }).eq('id', lot.id)
const { data: bucata, error: eB } = await supabase.from('magazie_bucati').insert({
const { error: e2 } = await supabase.from('productie_stoc_miscari').insert({
```

Fix minim: operație tranzacțională, idempotentă pe `lot.id`, cu schimbarea statusului la final. **[de verificat în BD]** constrângerile pe serii și protecția împotriva refinalizării.

**2. [major] `src/MagazieProductie.jsx:735` — factură confirmată chiar dacă intrarea în stoc rămâne incompletă. P2, P5, P8**

Factura devine `confirmata: true` înaintea procesării liniilor. Erorile de actualizare a materialului și de inserare a mișcării sunt ignorate, iar contorul de succes crește. Factura dispare din lista celor neconfirmate. Dacă o linie nouă produce o eroare verificată, reîncercarea reprocesează liniile deja aplicate.

```js
ai_jsonb: pending ? { ...ex, _mail: pending.ai_jsonb?._mail } : ex, confirmata: true,
await supabase.from('productie_materiale').update({ cantitate: cTot, cost_mediu: cost, updated_at: new Date().toISOString() }).eq('id', exist.id)
await supabase.from('productie_materiale_miscari').insert({
```

Fix minim: confirmare și toate intrările într-o tranzacție, cu identificator unic pentru fiecare linie de factură; verificarea tuturor erorilor.

**3. [major] `src/MagazieProductie.jsx:435` — consumul poate exista doar în costul lotului sau doar în istoricul mișcărilor. P2, P8**

Componenta lotului se inserează prima. Dacă inserarea mișcării eșuează, componenta rămâne. Dacă actualizarea cantității eșuează, eroarea este ignorată, iar interfața scade totuși cantitatea locală.

```js
const { data: comp, error: e1 } = await supabase.from('productie_lot_componente').insert({
const { error: e2 } = await supabase.from('productie_materiale_miscari').insert({
if (!e2) await supabase.from('productie_materiale').update({ cantitate: Number(mat.cantitate) - cant, updated_at: new Date().toISOString() }).eq('id', mat.id)
```

Fix minim: componentă, mișcare și decrement într-o singură tranzacție; la eroare, niciuna nu rămâne aplicată.

**4. [major] `src/MagazieProductie.jsx:444` — două consumuri concurente suprascriu cantitatea. P8**

Doi operatori citesc stoc 10 și consumă câte 3. Ambii trimit valoarea absolută 7, deși mișcările însumează −6. Același model apare la intrarea facturilor, linia 762, inclusiv pentru costul mediu.

```js
cantitate: Number(mat.cantitate) - cant
const cTot = Number(exist.cantitate) + cant
```

Fix minim: calcul și validare în server, sub blocare de rând, împreună cu mișcarea. **[de verificat în BD]** dacă există deja un trigger care respinge sau recalculează aceste actualizări.

**5. [major] `src/Logistica.jsx:5448` — confirmarea transportului și transferul stocului nu sunt atomice. P2, P5, P8**

Transportul devine livrat înaintea RPC-ului. Dacă RPC-ul eșuează, rămâne livrat fără transfer. Dacă transferul reușește, dar salvarea `transfer_id` eșuează, eroarea este ignorată și se anunță succes; o nouă executare poate repeta transferul.

```js
if (liniiStoc.length > 0 && !T.transfer_id) {
const { data: trId, error: trErr } = await supabase.rpc('fn_transfer_executa', {
await supabase.from('logistica_transporturi').update({ transfer_id: trId }).eq('id', T.id)
```

Fix minim: confirmare și transfer într-o tranzacție idempotentă pe ID-ul transportului. Verificarea erorii de legare este necesară, dar singură nu rezolvă concurența.

**6. [major] `src/MagazieProductie.jsx:462` — finalizarea folosește cantitatea nesalvată, diferită de lot. P8**

Operatorul deschide un lot salvat cu 10 bucăți, schimbă cantitatea la 12 și apasă direct „Finalizează”. Se creează 12 bucăți și mișcare de 12, dar actualizarea lotului nu salvează noua cantitate. Documentele ulterioare citesc `lot.cantitate`.

```js
const cant = Number(f.cantitate)
const { error } = await supabase.from('productie_loturi').update({ status:'finalizat', data_finalizare: azi }).eq('id', lot.id)
for (let i = 0; i < cant; i++) {
```

Fix minim: finalizarea să valideze și să persiste aceeași cantitate folosită la creare, atomic; impune număr întreg pozitiv pentru bucăți.

**7. [major] `src/Magazie.jsx:98` — ștergerea poziției poate distruge istoricul fără să șteargă poziția. P8**

Prima cerere șterge mișcările. Dacă a doua este refuzată sau conexiunea se întrerupe, poziția rămâne fără istoricul șters.

```js
let qM = supabase.from('stocuri_miscari').delete()
const { error: eM } = await qM
const { error } = await supabase.from('stocuri').delete().eq('id', s.id)
```

Fix minim: operație atomică pentru cele două ștergeri, în cadrul regulilor de autorizare existente. **[de verificat în BD]** și efectul triggerelor la ștergerea mișcărilor.

**8. [major] `src/Magazie.jsx:1245` — reîncercarea transferului nu are identitate stabilă. P5 — [de verificat în BD]**

Dacă serverul execută transferul, dar răspunsul se pierde, utilizatorul poate reîncerca. Clientul nu trimite o cheie de operație; `busy` protejează doar cât timp cererea este în curs. Același risc există la consum și ajustare.

```js
p_de_la_tip: dTip, p_de_la_id: dId, p_la_tip: lTip, p_la_id: lId,
p_obs: obs.trim() || null, p_linii,
```

Fix minim: cheie stabilă generată pentru operație, păstrată la retry și deduplicată în RPC. Claude trebuie să confirme implementarea efectivă a `fn_transfer_executa`, `fn_consum_executa` și `fn_stoc_ajustare`.

**9. [major] `src/ReceptieBucatiModal.jsx:267` — butonul se reactivează după succes, înainte de închidere. P5**

După inserare, închiderea se programează peste 900 ms, dar `saving` revine imediat la `false`; liniile rămân în formular. În Magazie, părintele doar reîncarcă datele. Un al doilea click în această fereastră retrimite aceleași rânduri.

```js
setTimeout(() => onClose?.(), 900)
setSaving(false)
```

Fix minim: păstrează formularul blocat după succes sau închide-l imediat; adaugă idempotentă pentru recepție. **[de verificat în BD]** unicitatea recepțiilor, mai ales pentru bucăți fără serie.

**10. [major] `src/MagazieProductie.jsx:453` — eliminarea unei componente consumate nu compensează stocul. P8 — [de verificat în BD]**

Operatorul consumă material pe lot, apoi șterge componenta cu „✕”. Clientul elimină doar componenta: costul dispare din lot, dar nu există operație de retur a materialului sau anulare a consumului.

```js
const { error } = await supabase.from('productie_lot_componente').delete().eq('id', c.id)
setComp(comp.filter(x => x.id !== c.id))
```

Fix minim: pentru componente provenite din stoc, anulare tranzacțională cu mișcare compensatoare și legătură explicită la consum; alternativ, interzicerea ștergerii simple. Verificat dacă există trigger compensator.

**11. [minor] `src/ReceptieBucatiModal.jsx:259` — packing list neatașat comenzii, fără avertizare. P2, P8**

Recepția reușește, dar actualizarea comenzii poate întoarce `error`. `try/catch` nu tratează eroarea returnată normal de Supabase; utilizatorul vede doar succesul recepției.

```js
await supabase.from('comenzi_furnizor')
  .update({ packing_list_path: mtcPath, updated_at: new Date().toISOString() })
  .eq('id', comandaFurnizorId)
```

Fix minim: citește `error`, avertizează despre atașarea eșuată și permite reîncercarea exclusiv a atașării.

**12. [minor] `src/MagazieProductie.jsx:871` și `:991` — salvări de documente raportate ca reușite fără verificarea rezultatului. P2**

La agrement, documentul se salvează, dar numărul de pe produs poate rămâne vechi. La declarație/certificat, PDF-ul se descarcă, dar înregistrarea emiterii poate lipsi.

```js
await supabase.from('productie_produse').update({ agrement_nr: f.denumire.trim() }).eq('id', Number(f.produs_id))
await supabase.from('productie_documente').insert({
```

Fix minim: verificarea erorilor și mesaj distinct pentru rezultatul parțial; retry doar pentru scrierea lipsă.

## Partea 2 — Achiziții

**1. [major] `src/Achizitii.jsx:2011` — retry poate omite definitiv transferul către proiect. P5, P8**

Intrarea în sediu reușește, RPC-ul de transfer eșuează. La retry, `dejaIntrat` este pozitiv și sare peste întregul bloc, inclusiv transferul. Creează transportul și poate marca ulterior comanda `in_stoc`, deși materialele au rămas în sediu.

```js
if (!dejaIntrat) {
const { error: eIn } = await supabase.from('stocuri_miscari').insert(intrari)
const { error: eTr } = await supabase.rpc('fn_transfer_executa', {
```

Fix minim: intrare și transfer atomice, idempotente pe comandă; existența intrării nu trebuie tratată ca dovadă a transferului.

**2. [major] `src/Achizitii.jsx:2011` — verificarea deduplicării ignoră erorile și permite concurență. P2, P5**

Dacă numărarea eșuează, `count` poate fi `null`, deci codul intră pe ramura de inserare. Două sesiuni pot și citi simultan zero, apoi insera ambele.

```js
const { count: dejaIntrat } = await supabase.from('stocuri_miscari')
  .select('id', { count: 'exact', head: true })
if (!dejaIntrat) {
```

Fix minim: oprește fluxul la eroarea citirii; deduplicare atomică în server, la nivel de operație/linie. **[de verificat în BD]** constrângerile existente pe referințele mișcărilor.

**3. [major] `src/Achizitii.jsx:2128` — cantitate marcată „intrată” fără mișcare de stoc. P2, P8**

Rezervarea liniei reușește, apoi pagina se închide înaintea inserării mișcării. Sau inserarea eșuează și compensarea eșuează și ea, fără verificare. La următoarea încercare, diferența calculată este zero și marfa nu mai intră.

```js
.update({ cantitate_intrata_stoc: tinta }).eq('id', l.id).eq('cantitate_intrata_stoc', deja).select('id').maybeSingle()
const { error } = await supabase.from('stocuri_miscari').insert({
await supabase.from('comenzi_furnizor_linii').update({ cantitate_intrata_stoc: deja }).eq('id', l.id).eq('cantitate_intrata_stoc', tinta)
```

Fix minim: actualizarea contorului și inserarea mișcării în aceeași tranzacție. Compararea versiunii protejează concurența pe linie, dar nu acoperă întreruperea între cereri.

**4. [major] `src/Achizitii.jsx:1775` — eroarea citirii aprobărilor este interpretată drept aprobare completă. P2**

Un aprobator aprobă. Citirea listei de aprobări eșuează; `rest` devine `null`, iar `[].every(...)` este `true`. Dacă recitirea comenzii reușește, fluxul apelează emiterea fără reverificarea aprobărilor din `cFresh`.

```js
const { data: rest } = await supabase.from('comenzi_furnizor_aprobari')
const toateOk = (rest || []).every(r => r.status === 'aprobat')
await emiteComanda(cFresh)
```

Fix minim: verifică eroarea, cere listă nevidă și verifică aprobările recitite; poartă obligatorie și pe server. **[de verificat în BD]** dacă triggerul blochează deja emiterea prematură.

**5. [major] `src/Achizitii.jsx:634` — editarea unei comenzi poate șterge toate reperele. P8**

Salvarea actualizează antetul, șterge liniile vechi și abia apoi inserează liniile noi. Dacă inserarea eșuează, comanda rămâne fără repere. La creare, eșecul liniilor lasă un draft; retry pornește cu alt antet nou.

```js
const { error: eDel } = await supabase.from('comenzi_furnizor_linii').delete().eq('comanda_furnizor_id', comandaId)
const { error: eLin } = await supabase.from('comenzi_furnizor_linii').insert(rows)
```

Fix minim: salvare tranzacțională antet + linii și identitate stabilă pentru retry-ul creării.

**6. [major] `src/Achizitii.jsx:2028` — proiectul creditat în stoc poate diferi de destinația transportului. P8**

Formularul permite alegerea oricărui șantier. Transferul creditează însă proiectul comenzii, independent de șantierul ales. Marfa apare în stocul proiectului A, iar transportul este trimis către B.

```js
p_de_la_tip: 'sediu', p_de_la_id: null, p_la_tip: 'proiect', p_la_id: c.proiect_id,
destinatie_tip: 'site', destinatie_site_id: Number(destinatieSiteId),
```

Fix minim: validează corespondența destinație–proiect sau determină explicit proiectul destinației înaintea operației.

**7. [major] `src/Achizitii.jsx:2036` și `:2077` — transporturi incomplete și duplicate la retry. P5, P8**

Crearea antetului transportului reușește, inserarea conținutului eșuează. Antetul rămâne. Retry creează alt transport. În recepția directă, același lucru se întâmplă dacă transportul complet există, dar actualizarea finală a comenzii eșuează.

```js
const { data: tr, error: eT } = await supabase.from('logistica_transporturi').insert({
const { error: eC } = await supabase.from('logistica_transporturi_continut').insert(cont)
if (eC) throw eC
```

Fix minim: antet și conținut atomice, cheie de operație pentru retry și legătură persistentă cu comanda.

**8. [major] `src/Achizitii.jsx:1879` — PDF-uri șterse înainte de confirmarea ștergerii comenzii. P2, P8**

Ștergerea fișierelor reușește, dar ștergerea comenzii este refuzată: comanda rămâne cu documente inaccesibile. Invers, eroarea Storage este ignorată și se poate raporta ștergere completă cu fișiere rămase.

```js
if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
const { error } = await supabase.from('comenzi_furnizor').delete().eq('id', c.id)
```

Fix minim: nu elimina fișierele înaintea rezultatului operației BD; păstrează lista pentru curățare reluabilă și verifică rezultatul Storage.

**9. [major] `src/Achizitii.jsx:1753` — trimiterea în aprobare poate rămâne aplicată doar pe jumătate. P5, P8**

Aprobările sunt inserate, dar actualizarea statusului eșuează. Comanda rămâne în starea anterioară; retry încearcă să insereze din nou aprobările, producând duplicate sau eroare de unicitate.

```js
const { error: e1 } = await supabase.from('comenzi_furnizor_aprobari').insert(rows)
const { error: e2 } = await supabase.from('comenzi_furnizor').update({ status: 'in_aprobare', updated_at: new Date().toISOString() }).eq('id', c.id)
```

Fix minim: inițializarea aprobărilor și tranziția de status într-o tranzacție idempotentă. Separat, la linia 1771, verifică și eroarea actualizării comenzii la `respinsa`.

## De verificat în BD de Claude

**P4 — valorile următoare sunt scrise de cod, nu declarate aici ca fiind acceptate de producție:**

| Tabel.coloană | Valori scrise — [de verificat în BD] |
|---|---|
| `magazie_echipamente.categorie` | `eip`, `scula`, `echipament`, `it`, `altele` |
| `magazie_echipamente.stare` | `functional`, `defect`, `casat` |
| `magazii.status` | `activa`, `inchisa` |
| `stocuri_miscari.tip` | `corectie_initiala`, `intrare_achizitie` |
| `stocuri_miscari.locatie_tip` | `sediu`, `proiect` |
| `stocuri_miscari.ref_tip` | `comanda_furnizor` |
| `magazie_bucati.provenienta` | `gazpet`, `beneficiar`; Producția scrie **`Producție internă`** |
| `magazie_bucati.stare` / `locatie_tip` | `sosit` / `sediu`, `proiect` |
| `magazie_bucati.izolatie` | `neizolata`, `PEHD`, `GRP` |
| `magazie_bucati.sursa_receptie` | `packing_list`, `aviz`, `mtc`, `manual` |
| `productie_produse.tip` | `flansa_multifunctionala`, `fiting_refulare`, `altul` |
| `productie_loturi.status` | `finalizat` |
| `productie_lot_componente.tip` | `materie_prima`, `prelucrare`, `componenta`, `transport`, `altele` |
| `productie_materiale_miscari.tip` | `iesire_lot`, `intrare_factura` |
| `productie_stoc_miscari.tip` | `intrare_productie`, `iesire_proiect`, `iesire_vanzare`, `iesire_custodie`, `retur`, `ajustare` |
| `productie_documente.tip` | `agrement`, `certificat_calitate`, `declaratie_conformitate`, `certificat_conformitate`, `altul` |
| `comenzi_furnizor.status` | `draft`, `in_aprobare`, `emisa`, `respinsa`, `in_tranzit`, `ajunsa`, `receptionata`, `in_stoc`, `anulata` |
| `comenzi_furnizor.livrare_tip` / `moneda` | `sediu`, `santier` / `RON`, `EUR` |
| `comenzi_furnizor_aprobari.status` | `in_asteptare`, `aprobat`, `respins` |
| `comenzi_furnizor_documente.tip` | `calitate`, `declaratie`, `aviz`, `factura`, `altele` |

Prioritar:

- **`magazie_bucati.provenienta = 'Producție internă'`**: dacă nu este acceptată, finalizarea lotului cade după schimbarea statusului.
- RPC-urile de stoc: idempotentă, blocări concurente și atomicitate; triggerul care aplică `stocuri_miscari`.
- `productie_materiale`: cine actualizează cantitatea — clientul, triggerul sau ambele; compensarea consumurilor șterse.
- `productie_serii.serie`: unicitate și alocare concurentă; clientul calculează următorul număr din ultima serie citită.
- `comenzi_furnizor_linii.cantitate_intrata_stoc`: `NOT NULL`, default și eventuale triggere. Clientul convertește `null` în zero, dar filtrul `.eq(..., 0)` nu găsește un `NULL`.
- Poarta server pentru emitere doar după aprobări și unicitatea aprobărilor per comandă/aprobator.
- **P7:** coloanele/view-urile și relațiile PostgREST folosite, inclusiv `packing_list_path`, `cantitate_intrata_stoc`, `magazie_bucata_id`, `v_stoc_furnizori`, `v_echipament_furnizor`. Existența lor în cod nu confirmă schema instalată.

## Verificat și OK

- **P1:** nu am identificat un caz demonstrabil de identificator folosit în afara scope-ului în fluxurile inspectate.
- **P3:** nu am identificat o dependență omisă care să producă demonstrabil scrieri cu state vechi în callback-urile inspectate.
- **P6:** în clienții OCR verificați, analiza pregătește datele și încarcă fișiere; inserarea bucăților/materialelor este la confirmare. Efectele interne ale Edge Functions nu au fost auditate.
- Toate cele trei apeluri `fn_transfer_executa` verifică eroarea RPC-ului; problemele sunt la retry și operațiile din jur.
- Butoanele principale de transfer/consum folosesc `disabled={busy}`. Nu am tratat simpla lipsă a unui `useRef` ca dovadă de dublu click.
- `actualizeazaEmisa` verifică statusul, recepțiile și versiunea `updated_at`, apoi detectează lipsa rândului actualizat.
- Valorile pentru transport scrise de Achiziții — `materiale`, `cerut`, `alta`, `site`, `marfa` — corespund CHECK-urilor furnizate în brief-ul Logistică.

**Limită:** audit static al fluxurilor indicate, fără teste runtime/PostgREST. Nu am extins partea 2 la implementarea `CereriInterneProiect.jsx` și nici la SQL-ul efectiv instalat sau Edge Functions.
tokens used
103,151
Audit static pe **`origin/main = 79a5f09a683f03a1f69f17551a26414a5802f11a`**. Fără modificări, fără acces la BD sau producție. Referințele de mai jos sunt pe acest commit.

Am verificat fluxurile de scriere din `Magazie.jsx`, componentele importate `MagazieProductie.jsx` și `ReceptieBucatiModal.jsx`, toate cele trei apeluri `fn_transfer_executa` din `src/`, apoi fluxurile principale din `Achizitii.jsx`. Efectele dependente de constrângeri/triggere sunt marcate explicit.

## Partea 1 — Magazie și apelurile de transfer

**1. [major] `src/MagazieProductie.jsx:479` — lot finalizat înaintea creării stocului. P5, P8**

Finalizarea marchează lotul `finalizat`, apoi creează separat fiecare bucată, seria și mișcarea agregată. O eroare intermediară lasă un lot finalizat cu stoc incomplet. După reîncărcare, UI ascunde finalizarea; înainte de reîncărcare, reîncercarea poate recrea bucăți.

```js
const { error } = await supabase.from('productie_loturi').update({ status:'finalizat', data_finalizare: azi }).eq('id', lot.id)
const { data: bucata, error: eB } = await supabase.from('magazie_bucati').insert({
const { error: e2 } = await supabase.from('productie_stoc_miscari').insert({
```

Fix minim: operație tranzacțională, idempotentă pe `lot.id`, cu schimbarea statusului la final. **[de verificat în BD]** constrângerile pe serii și protecția împotriva refinalizării.

**2. [major] `src/MagazieProductie.jsx:735` — factură confirmată chiar dacă intrarea în stoc rămâne incompletă. P2, P5, P8**

Factura devine `confirmata: true` înaintea procesării liniilor. Erorile de actualizare a materialului și de inserare a mișcării sunt ignorate, iar contorul de succes crește. Factura dispare din lista celor neconfirmate. Dacă o linie nouă produce o eroare verificată, reîncercarea reprocesează liniile deja aplicate.

```js
ai_jsonb: pending ? { ...ex, _mail: pending.ai_jsonb?._mail } : ex, confirmata: true,
await supabase.from('productie_materiale').update({ cantitate: cTot, cost_mediu: cost, updated_at: new Date().toISOString() }).eq('id', exist.id)
await supabase.from('productie_materiale_miscari').insert({
```

Fix minim: confirmare și toate intrările într-o tranzacție, cu identificator unic pentru fiecare linie de factură; verificarea tuturor erorilor.

**3. [major] `src/MagazieProductie.jsx:435` — consumul poate exista doar în costul lotului sau doar în istoricul mișcărilor. P2, P8**

Componenta lotului se inserează prima. Dacă inserarea mișcării eșuează, componenta rămâne. Dacă actualizarea cantității eșuează, eroarea este ignorată, iar interfața scade totuși cantitatea locală.

```js
const { data: comp, error: e1 } = await supabase.from('productie_lot_componente').insert({
const { error: e2 } = await supabase.from('productie_materiale_miscari').insert({
if (!e2) await supabase.from('productie_materiale').update({ cantitate: Number(mat.cantitate) - cant, updated_at: new Date().toISOString() }).eq('id', mat.id)
```

Fix minim: componentă, mișcare și decrement într-o singură tranzacție; la eroare, niciuna nu rămâne aplicată.

**4. [major] `src/MagazieProductie.jsx:444` — două consumuri concurente suprascriu cantitatea. P8**

Doi operatori citesc stoc 10 și consumă câte 3. Ambii trimit valoarea absolută 7, deși mișcările însumează −6. Același model apare la intrarea facturilor, linia 762, inclusiv pentru costul mediu.

```js
cantitate: Number(mat.cantitate) - cant
const cTot = Number(exist.cantitate) + cant
```

Fix minim: calcul și validare în server, sub blocare de rând, împreună cu mișcarea. **[de verificat în BD]** dacă există deja un trigger care respinge sau recalculează aceste actualizări.

**5. [major] `src/Logistica.jsx:5448` — confirmarea transportului și transferul stocului nu sunt atomice. P2, P5, P8**

Transportul devine livrat înaintea RPC-ului. Dacă RPC-ul eșuează, rămâne livrat fără transfer. Dacă transferul reușește, dar salvarea `transfer_id` eșuează, eroarea este ignorată și se anunță succes; o nouă executare poate repeta transferul.

```js
if (liniiStoc.length > 0 && !T.transfer_id) {
const { data: trId, error: trErr } = await supabase.rpc('fn_transfer_executa', {
await supabase.from('logistica_transporturi').update({ transfer_id: trId }).eq('id', T.id)
```

Fix minim: confirmare și transfer într-o tranzacție idempotentă pe ID-ul transportului. Verificarea erorii de legare este necesară, dar singură nu rezolvă concurența.

**6. [major] `src/MagazieProductie.jsx:462` — finalizarea folosește cantitatea nesalvată, diferită de lot. P8**

Operatorul deschide un lot salvat cu 10 bucăți, schimbă cantitatea la 12 și apasă direct „Finalizează”. Se creează 12 bucăți și mișcare de 12, dar actualizarea lotului nu salvează noua cantitate. Documentele ulterioare citesc `lot.cantitate`.

```js
const cant = Number(f.cantitate)
const { error } = await supabase.from('productie_loturi').update({ status:'finalizat', data_finalizare: azi }).eq('id', lot.id)
for (let i = 0; i < cant; i++) {
```

Fix minim: finalizarea să valideze și să persiste aceeași cantitate folosită la creare, atomic; impune număr întreg pozitiv pentru bucăți.

**7. [major] `src/Magazie.jsx:98` — ștergerea poziției poate distruge istoricul fără să șteargă poziția. P8**

Prima cerere șterge mișcările. Dacă a doua este refuzată sau conexiunea se întrerupe, poziția rămâne fără istoricul șters.

```js
let qM = supabase.from('stocuri_miscari').delete()
const { error: eM } = await qM
const { error } = await supabase.from('stocuri').delete().eq('id', s.id)
```

Fix minim: operație atomică pentru cele două ștergeri, în cadrul regulilor de autorizare existente. **[de verificat în BD]** și efectul triggerelor la ștergerea mișcărilor.

**8. [major] `src/Magazie.jsx:1245` — reîncercarea transferului nu are identitate stabilă. P5 — [de verificat în BD]**

Dacă serverul execută transferul, dar răspunsul se pierde, utilizatorul poate reîncerca. Clientul nu trimite o cheie de operație; `busy` protejează doar cât timp cererea este în curs. Același risc există la consum și ajustare.

```js
p_de_la_tip: dTip, p_de_la_id: dId, p_la_tip: lTip, p_la_id: lId,
p_obs: obs.trim() || null, p_linii,
```

Fix minim: cheie stabilă generată pentru operație, păstrată la retry și deduplicată în RPC. Claude trebuie să confirme implementarea efectivă a `fn_transfer_executa`, `fn_consum_executa` și `fn_stoc_ajustare`.

**9. [major] `src/ReceptieBucatiModal.jsx:267` — butonul se reactivează după succes, înainte de închidere. P5**

După inserare, închiderea se programează peste 900 ms, dar `saving` revine imediat la `false`; liniile rămân în formular. În Magazie, părintele doar reîncarcă datele. Un al doilea click în această fereastră retrimite aceleași rânduri.

```js
setTimeout(() => onClose?.(), 900)
setSaving(false)
```

Fix minim: păstrează formularul blocat după succes sau închide-l imediat; adaugă idempotentă pentru recepție. **[de verificat în BD]** unicitatea recepțiilor, mai ales pentru bucăți fără serie.

**10. [major] `src/MagazieProductie.jsx:453` — eliminarea unei componente consumate nu compensează stocul. P8 — [de verificat în BD]**

Operatorul consumă material pe lot, apoi șterge componenta cu „✕”. Clientul elimină doar componenta: costul dispare din lot, dar nu există operație de retur a materialului sau anulare a consumului.

```js
const { error } = await supabase.from('productie_lot_componente').delete().eq('id', c.id)
setComp(comp.filter(x => x.id !== c.id))
```

Fix minim: pentru componente provenite din stoc, anulare tranzacțională cu mișcare compensatoare și legătură explicită la consum; alternativ, interzicerea ștergerii simple. Verificat dacă există trigger compensator.

**11. [minor] `src/ReceptieBucatiModal.jsx:259` — packing list neatașat comenzii, fără avertizare. P2, P8**

Recepția reușește, dar actualizarea comenzii poate întoarce `error`. `try/catch` nu tratează eroarea returnată normal de Supabase; utilizatorul vede doar succesul recepției.

```js
await supabase.from('comenzi_furnizor')
  .update({ packing_list_path: mtcPath, updated_at: new Date().toISOString() })
  .eq('id', comandaFurnizorId)
```

Fix minim: citește `error`, avertizează despre atașarea eșuată și permite reîncercarea exclusiv a atașării.

**12. [minor] `src/MagazieProductie.jsx:871` și `:991` — salvări de documente raportate ca reușite fără verificarea rezultatului. P2**

La agrement, documentul se salvează, dar numărul de pe produs poate rămâne vechi. La declarație/certificat, PDF-ul se descarcă, dar înregistrarea emiterii poate lipsi.

```js
await supabase.from('productie_produse').update({ agrement_nr: f.denumire.trim() }).eq('id', Number(f.produs_id))
await supabase.from('productie_documente').insert({
```

Fix minim: verificarea erorilor și mesaj distinct pentru rezultatul parțial; retry doar pentru scrierea lipsă.

## Partea 2 — Achiziții

**1. [major] `src/Achizitii.jsx:2011` — retry poate omite definitiv transferul către proiect. P5, P8**

Intrarea în sediu reușește, RPC-ul de transfer eșuează. La retry, `dejaIntrat` este pozitiv și sare peste întregul bloc, inclusiv transferul. Creează transportul și poate marca ulterior comanda `in_stoc`, deși materialele au rămas în sediu.

```js
if (!dejaIntrat) {
const { error: eIn } = await supabase.from('stocuri_miscari').insert(intrari)
const { error: eTr } = await supabase.rpc('fn_transfer_executa', {
```

Fix minim: intrare și transfer atomice, idempotente pe comandă; existența intrării nu trebuie tratată ca dovadă a transferului.

**2. [major] `src/Achizitii.jsx:2011` — verificarea deduplicării ignoră erorile și permite concurență. P2, P5**

Dacă numărarea eșuează, `count` poate fi `null`, deci codul intră pe ramura de inserare. Două sesiuni pot și citi simultan zero, apoi insera ambele.

```js
const { count: dejaIntrat } = await supabase.from('stocuri_miscari')
  .select('id', { count: 'exact', head: true })
if (!dejaIntrat) {
```

Fix minim: oprește fluxul la eroarea citirii; deduplicare atomică în server, la nivel de operație/linie. **[de verificat în BD]** constrângerile existente pe referințele mișcărilor.

**3. [major] `src/Achizitii.jsx:2128` — cantitate marcată „intrată” fără mișcare de stoc. P2, P8**

Rezervarea liniei reușește, apoi pagina se închide înaintea inserării mișcării. Sau inserarea eșuează și compensarea eșuează și ea, fără verificare. La următoarea încercare, diferența calculată este zero și marfa nu mai intră.

```js
.update({ cantitate_intrata_stoc: tinta }).eq('id', l.id).eq('cantitate_intrata_stoc', deja).select('id').maybeSingle()
const { error } = await supabase.from('stocuri_miscari').insert({
await supabase.from('comenzi_furnizor_linii').update({ cantitate_intrata_stoc: deja }).eq('id', l.id).eq('cantitate_intrata_stoc', tinta)
```

Fix minim: actualizarea contorului și inserarea mișcării în aceeași tranzacție. Compararea versiunii protejează concurența pe linie, dar nu acoperă întreruperea între cereri.

**4. [major] `src/Achizitii.jsx:1775` — eroarea citirii aprobărilor este interpretată drept aprobare completă. P2**

Un aprobator aprobă. Citirea listei de aprobări eșuează; `rest` devine `null`, iar `[].every(...)` este `true`. Dacă recitirea comenzii reușește, fluxul apelează emiterea fără reverificarea aprobărilor din `cFresh`.

```js
const { data: rest } = await supabase.from('comenzi_furnizor_aprobari')
const toateOk = (rest || []).every(r => r.status === 'aprobat')
await emiteComanda(cFresh)
```

Fix minim: verifică eroarea, cere listă nevidă și verifică aprobările recitite; poartă obligatorie și pe server. **[de verificat în BD]** dacă triggerul blochează deja emiterea prematură.

**5. [major] `src/Achizitii.jsx:634` — editarea unei comenzi poate șterge toate reperele. P8**

Salvarea actualizează antetul, șterge liniile vechi și abia apoi inserează liniile noi. Dacă inserarea eșuează, comanda rămâne fără repere. La creare, eșecul liniilor lasă un draft; retry pornește cu alt antet nou.

```js
const { error: eDel } = await supabase.from('comenzi_furnizor_linii').delete().eq('comanda_furnizor_id', comandaId)
const { error: eLin } = await supabase.from('comenzi_furnizor_linii').insert(rows)
```

Fix minim: salvare tranzacțională antet + linii și identitate stabilă pentru retry-ul creării.

**6. [major] `src/Achizitii.jsx:2028` — proiectul creditat în stoc poate diferi de destinația transportului. P8**

Formularul permite alegerea oricărui șantier. Transferul creditează însă proiectul comenzii, independent de șantierul ales. Marfa apare în stocul proiectului A, iar transportul este trimis către B.

```js
p_de_la_tip: 'sediu', p_de_la_id: null, p_la_tip: 'proiect', p_la_id: c.proiect_id,
destinatie_tip: 'site', destinatie_site_id: Number(destinatieSiteId),
```

Fix minim: validează corespondența destinație–proiect sau determină explicit proiectul destinației înaintea operației.

**7. [major] `src/Achizitii.jsx:2036` și `:2077` — transporturi incomplete și duplicate la retry. P5, P8**

Crearea antetului transportului reușește, inserarea conținutului eșuează. Antetul rămâne. Retry creează alt transport. În recepția directă, același lucru se întâmplă dacă transportul complet există, dar actualizarea finală a comenzii eșuează.

```js
const { data: tr, error: eT } = await supabase.from('logistica_transporturi').insert({
const { error: eC } = await supabase.from('logistica_transporturi_continut').insert(cont)
if (eC) throw eC
```

Fix minim: antet și conținut atomice, cheie de operație pentru retry și legătură persistentă cu comanda.

**8. [major] `src/Achizitii.jsx:1879` — PDF-uri șterse înainte de confirmarea ștergerii comenzii. P2, P8**

Ștergerea fișierelor reușește, dar ștergerea comenzii este refuzată: comanda rămâne cu documente inaccesibile. Invers, eroarea Storage este ignorată și se poate raporta ștergere completă cu fișiere rămase.

```js
if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
const { error } = await supabase.from('comenzi_furnizor').delete().eq('id', c.id)
```

Fix minim: nu elimina fișierele înaintea rezultatului operației BD; păstrează lista pentru curățare reluabilă și verifică rezultatul Storage.

**9. [major] `src/Achizitii.jsx:1753` — trimiterea în aprobare poate rămâne aplicată doar pe jumătate. P5, P8**

Aprobările sunt inserate, dar actualizarea statusului eșuează. Comanda rămâne în starea anterioară; retry încearcă să insereze din nou aprobările, producând duplicate sau eroare de unicitate.

```js
const { error: e1 } = await supabase.from('comenzi_furnizor_aprobari').insert(rows)
const { error: e2 } = await supabase.from('comenzi_furnizor').update({ status: 'in_aprobare', updated_at: new Date().toISOString() }).eq('id', c.id)
```

Fix minim: inițializarea aprobărilor și tranziția de status într-o tranzacție idempotentă. Separat, la linia 1771, verifică și eroarea actualizării comenzii la `respinsa`.

## De verificat în BD de Claude

**P4 — valorile următoare sunt scrise de cod, nu declarate aici ca fiind acceptate de producție:**

| Tabel.coloană | Valori scrise — [de verificat în BD] |
|---|---|
| `magazie_echipamente.categorie` | `eip`, `scula`, `echipament`, `it`, `altele` |
| `magazie_echipamente.stare` | `functional`, `defect`, `casat` |
| `magazii.status` | `activa`, `inchisa` |
| `stocuri_miscari.tip` | `corectie_initiala`, `intrare_achizitie` |
| `stocuri_miscari.locatie_tip` | `sediu`, `proiect` |
| `stocuri_miscari.ref_tip` | `comanda_furnizor` |
| `magazie_bucati.provenienta` | `gazpet`, `beneficiar`; Producția scrie **`Producție internă`** |
| `magazie_bucati.stare` / `locatie_tip` | `sosit` / `sediu`, `proiect` |
| `magazie_bucati.izolatie` | `neizolata`, `PEHD`, `GRP` |
| `magazie_bucati.sursa_receptie` | `packing_list`, `aviz`, `mtc`, `manual` |
| `productie_produse.tip` | `flansa_multifunctionala`, `fiting_refulare`, `altul` |
| `productie_loturi.status` | `finalizat` |
| `productie_lot_componente.tip` | `materie_prima`, `prelucrare`, `componenta`, `transport`, `altele` |
| `productie_materiale_miscari.tip` | `iesire_lot`, `intrare_factura` |
| `productie_stoc_miscari.tip` | `intrare_productie`, `iesire_proiect`, `iesire_vanzare`, `iesire_custodie`, `retur`, `ajustare` |
| `productie_documente.tip` | `agrement`, `certificat_calitate`, `declaratie_conformitate`, `certificat_conformitate`, `altul` |
| `comenzi_furnizor.status` | `draft`, `in_aprobare`, `emisa`, `respinsa`, `in_tranzit`, `ajunsa`, `receptionata`, `in_stoc`, `anulata` |
| `comenzi_furnizor.livrare_tip` / `moneda` | `sediu`, `santier` / `RON`, `EUR` |
| `comenzi_furnizor_aprobari.status` | `in_asteptare`, `aprobat`, `respins` |
| `comenzi_furnizor_documente.tip` | `calitate`, `declaratie`, `aviz`, `factura`, `altele` |

Prioritar:

- **`magazie_bucati.provenienta = 'Producție internă'`**: dacă nu este acceptată, finalizarea lotului cade după schimbarea statusului.
- RPC-urile de stoc: idempotentă, blocări concurente și atomicitate; triggerul care aplică `stocuri_miscari`.
- `productie_materiale`: cine actualizează cantitatea — clientul, triggerul sau ambele; compensarea consumurilor șterse.
- `productie_serii.serie`: unicitate și alocare concurentă; clientul calculează următorul număr din ultima serie citită.
- `comenzi_furnizor_linii.cantitate_intrata_stoc`: `NOT NULL`, default și eventuale triggere. Clientul convertește `null` în zero, dar filtrul `.eq(..., 0)` nu găsește un `NULL`.
- Poarta server pentru emitere doar după aprobări și unicitatea aprobărilor per comandă/aprobator.
- **P7:** coloanele/view-urile și relațiile PostgREST folosite, inclusiv `packing_list_path`, `cantitate_intrata_stoc`, `magazie_bucata_id`, `v_stoc_furnizori`, `v_echipament_furnizor`. Existența lor în cod nu confirmă schema instalată.

## Verificat și OK

- **P1:** nu am identificat un caz demonstrabil de identificator folosit în afara scope-ului în fluxurile inspectate.
- **P3:** nu am identificat o dependență omisă care să producă demonstrabil scrieri cu state vechi în callback-urile inspectate.
- **P6:** în clienții OCR verificați, analiza pregătește datele și încarcă fișiere; inserarea bucăților/materialelor este la confirmare. Efectele interne ale Edge Functions nu au fost auditate.
- Toate cele trei apeluri `fn_transfer_executa` verifică eroarea RPC-ului; problemele sunt la retry și operațiile din jur.
- Butoanele principale de transfer/consum folosesc `disabled={busy}`. Nu am tratat simpla lipsă a unui `useRef` ca dovadă de dublu click.
- `actualizeazaEmisa` verifică statusul, recepțiile și versiunea `updated_at`, apoi detectează lipsa rândului actualizat.
- Valorile pentru transport scrise de Achiziții — `materiale`, `cerut`, `alta`, `site`, `marfa` — corespund CHECK-urilor furnizate în brief-ul Logistică.

**Limită:** audit static al fluxurilor indicate, fără teste runtime/PostgREST. Nu am extins partea 2 la implementarea `CereriInterneProiect.jsx` și nici la SQL-ul efectiv instalat sau Edge Functions.
