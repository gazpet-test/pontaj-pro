# R3 — Stările citirii planșelor (analiză + propunere, NIMIC aplicat)

Data: 25.09.2026 · BD: doar SELECT · Cod: neatins.

## 1. Stare actuală (cum se stabilesc azi)

| Stare | Unde se scrie | Regula de azi |
|---|---|---|
| `plansa.citibila` | `api/plansa-felii.js` | `esteCitibila()`: sonde de variație locală, citibilă dacă ≥25% din sonde au desen. `false` și la „nicio imagine” / imagine care nu se deschide. |
| `plansa.vectorial` | `api/plansa-felii.js` | PDF + (niciun JPEG SAU cel mai mare JPEG < `MIN_LATURA_SCAN`=2000px pe latura mare) ⇒ se randează pdf.js (`_randare-pdf.js`, 200 dpi, max 6 pagini). Se setează `true` doar când ruta vectorială rulează. |
| `plansa.randare_esuata` | `api/plansa-felii.js` | `true` dacă `randeazaVectorial` aruncă; se scrie doar pe ramura „nicio pagină citibilă”. |
| `eroare='citită fără rezultat'` | edge `ofertare-plansa-citeste` (l.711) | la `gata`: 0 tronsoane, 0 tabele, 0 m ⇒ rămâne `procesat` + eroarea asta. Declanșează RPC-ul de clarificare. |
| `status_procesare` | edge (l.700–713) | `eroare` dacă sursa nevectorială <2000px („probabil sigla”) sau toate zonele căzute; `partial` dacă zone căzute/lipsă; altfel `procesat`. |
| UI `peSigla` | `src/OfertareLicitatii.jsx:1111` | `!vectorial && max(latime,inaltime) ∈ (0,2000)` ⇒ ascunde „recitește” și nu o socotește citită. |

Probleme:
- **Sigla e detectată după mărime, nu după conținut.** 472–474 au fost citite ÎNAINTE de gardă ⇒ azi sunt `procesat`, `eroare=NULL`, 0 tronsoane — trec drept planșe OK în BD (UI le prinde doar prin `peSigla`). Funcția SQL nu le vede deloc (nu au `citibila=false`, nici „citită fără rezultat”).
- O scanare reală mică (ex. 1800px) ar fi tratată drept siglă; o siglă mare (≥2000px) ar fi tratată drept planșă.
- **„citită fără rezultat” amestecă** „desen corect fără cote” (plan topografic PL1/PL5) cu „nu s-a putut citi”. Funcția SQL scrie același text de clarificare („textul e convertit în elemente grafice sau nu este lizibil”) — fals pentru un plan topografic lizibil care pur și simplu nu conține lungimi.

## 2. Detectare siglă EasySign după CONȚINUT (propunere)

Calibrare BD: 472/473/474 → `latime=900, inaltime=450` (raport 2.00), 1 felie, nevectorial, 0 tronsoane. Planșele reale din același set (471, 475) randate vectorial: 7017×9934 / 7017×4963.

Scor `sigla` (în `plansa-felii.js`, înainte de alegerea sursei) — siglă dacă ≥3 semnale:
1. raport aspect al imaginii în [1.8, 2.2] și latura mare < 1500px;
2. imaginea ocupă < 10% din aria paginii (din matricea de plasare pdf.js `getOperatorList` → `paintImageXObject` + transform curent);
3. pagina are ALTE operatori de desen (paths `constructPath` > ~500) sau altă imagine de ≥4× arie;
4. stratul de text pdf.js (`getTextContent`) conține `/EasySign|Semnat digital|Digitally signed|Signature valid/i` în jurul imaginii;
5. PDF-ul are dicționar `/Sig` / `/ByteRange` (semnătură PAdES).

```js
// schiță — api/plansa-felii.js
async function clasificaImagini(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise
  const pag = await doc.getPage(1), vp = pag.getViewport({ scale: 1 })
  const ops = await pag.getOperatorList(), txt = await pag.getTextContent()
  const arePaths = ops.fnArray.filter(f => f === pdfjs.OPS.constructPath).length
  const textSemn = /EasySign|Semnat digital|Digitally signed/i.test(txt.items.map(i => i.str).join(' '))
  const areSemnatura = /\/ByteRange\s*\[/.test(buf.toString('latin1', 0, Math.min(buf.length, 4e6)))
  return { arePaths, textSemn, areSemnatura, ariaPag: vp.width * vp.height }
}
const eSigla = (meta, c) => [
  meta && Math.max(meta.width, meta.height) < 1500 && Math.abs(meta.width / meta.height - 2) < 0.2,
  c.arePaths > 500, c.textSemn, c.areSemnatura,
].filter(Boolean).length >= 3
```
Rezultat: `plansa.sursa_ignorata = { tip: 'sigla_semnatura', latime, inaltime, semnale:[...] }` și se merge pe randare vectorială; pragul de 2000px rămâne doar ca plasă de siguranță.
În edge, garda `prea_mica` devine `plansa.sursa_ignorata?.tip==='sigla_semnatura' && !plansa.vectorial`; în UI `peSigla` citește același câmp (fallback la regula veche pentru docuri istorice).

## 3. Stări distincte (propunere)

Coloană nouă logică în `analiza->'plansa'->>'rezultat'` (fără schimbare de schemă — cheie JSON):

| `rezultat` | Când | status_procesare | Clarificare? |
|---|---|---|---|
| `ok` | ≥1 tronson/tabel/lungime | procesat/partial | nu |
| `sursa_gresita_sigla` | citit pe siglă (semnale §2 sau istoric <2000 nevectorial) | eroare | **nu** — se retaie (problemă a noastră, nu a autorității) |
| `ilizibil` | citibila=false (imagine deteriorată), randare_esuata, toate zonele căzute | eroare | da — „fișier nelizibil/nerandabil” |
| `citita_fara_date_cantitative` | citită corect, are text (toponime, legendă) dar 0 cote/lungimi | procesat | da, dar formulare diferită: „planșa nu conține lungimi/diametre” (nu „nelizibil”) |

Distincția ilizibil vs fără date: în edge, dacă `sumar` are text recunoscut (ex. `note`/legendă/toponime > N, sau felii ne-goale citite fără eroare) ⇒ `citita_fara_date_cantitative`; dacă modelul raportează ilizibil pe majoritatea feliilor ⇒ `ilizibil`.

```ts
// edge ofertare-plansa-citeste, în locul lui `gol ? 'citită fără rezultat'`
const rezultat = prea_mica ? 'sursa_gresita_sigla'
  : (toate.length && sumar.erori >= toate.length) ? 'ilizibil'
  : gol ? (sumar.felii_cu_text > 0 ? 'citita_fara_date_cantitative' : 'ilizibil') : 'ok';
upd.analiza.plansa = { ...plansa, rezultat };
upd.eroare = ... gol ? (rezultat === 'ilizibil' ? 'ilizibilă' : 'citită fără date cantitative') : null;
```

SQL (v4, NEAPLICAT) — filtrul și motivele:
```sql
-- selecție: sigla NU intră în clarificare
WHERE licitatie_id = p_licitatie_id
  AND coalesce(analiza->'plansa'->>'rezultat','') <> 'sursa_gresita_sigla'
  AND NOT (NOT coalesce((analiza->'plansa'->>'vectorial')::boolean,false)
           AND greatest(coalesce((analiza->'plansa'->>'latime')::int,0),coalesce((analiza->'plansa'->>'inaltime')::int,0)) BETWEEN 1 AND 1999)
  AND ( analiza->'plansa'->>'rezultat' IN ('ilizibil','citita_fara_date_cantitative')
        OR (analiza->'plansa'->>'citibila') = 'false'
        OR eroare IN ('citită fără rezultat','citită fără date cantitative')
        OR (status_procesare='eroare' AND analiza ? 'citire_ai') )
-- motiv
CASE
  WHEN analiza->'plansa'->>'rezultat'='citita_fara_date_cantitative' OR eroare IN ('citită fără rezultat','citită fără date cantitative')
    THEN 'fara_date'   -- textul: „planșa nu cuprinde lungimi/diametre/tronsoane”
  ELSE 'ilizibil'      -- textul: „fișierul nu e lizibil / text convertit în curbe”
END
```
Textul clarificării se compune pe două liste separate („Planșe care nu pot fi citite: …” / „Planșe lizibile care nu conțin date cantitative: …”); cererea 3 (DWG/PDF cu text) doar pentru lista ilizibilă.

## 4. Rezultate istorice afectate (toate licitațiile)

| lic | id | document | L×H | vect. | citibila | status | eroare | tronsoane | clasificare propusă |
|---|---|---|---|---|---|---|---|---|---|
| 3 | 130 | 8.1 PT 1.1 Schema tehnologică Pl.1 | 9957×14145 | – | true | partial | 1 pagină necitită | 24 (41 920 m*) | **ok** (partial real) |
| 95 | 470 | Schema tehnologică Vâlcelele | 9362×6623 | da | true | procesat | 1 zone necitite | 131 | **ok** |
| 95 | 471 | Plan topografic Vâlcelele (PL) | 7017×9934 | da | true | procesat | citită fără rezultat | 0 | **fără date** (topografic) |
| 95 | 472 | Plan topografic Vâlcelele (PL) | 900×450 | nu | true | procesat | – | 0 | **siglă probabilă** |
| 95 | 473 | Plan topografic Vâlcelele (PL) | 900×450 | nu | true | procesat | – | 0 | **siglă probabilă** |
| 95 | 474 | Plan topografic Vâlcelele (PL) | 900×450 | nu | true | procesat | – | 0 | **siglă probabilă** |
| 95 | 475 | Plan topografic Vâlcelele (PL) | 7017×4963 | da | true | procesat | citită fără rezultat | 0 | **fără date** (topografic) |
| 102 | 1035 | PT Dezvoltare SNT Botoșani / CTGN | – | – | false | neprocesat | – („Nu am găsit nicio imagine scanată”) | – | **ilizibil? → de verificat**: probabil vectorial netrecut prin randare (a rulat înainte de ruta pdf.js) — retăiere, nu clarificare |

\* lungime_totala_m din sumar (41 920 / 49 565) pare în mm sau dublată — de verificat separat, nu ține de R3.

Clarificări automate: **1** — id 63, lic. 95, `auto_planse_1`, status `propunere`, sursa `planse_auto:475,471` → citează doar cele 2 „fără date”, cu text de „ilizibil / convertit în curbe” (motiv greșit). 472–474 nu sunt citate (corect din întâmplare — nu intră în filtru), dar în BD apar ca procesate OK.

Total: 8 docuri cu `plansa`; 2 ok, 3 siglă, 2 fără date, 1 de reprocesat; 1 clarificare cu motiv greșit.

## 5. Ordine sigură de corectare (preview → confirmare Razvan → apply)

1. **Cod** (PR, fără date): detectare siglă după conținut + `rezultat` în edge + UI `peSigla` pe `sursa_ignorata`/`rezultat`. Build + teste edge.
2. **Migrare v4** `ofertare_clarificare_planse_auto` (apply_migration, după confirmare): excludere siglă, două liste, texte diferite. Nu atinge ciornele editate de om (regula v3 păstrată).
3. **Preview date** (SELECT): cele 8 rânduri de mai sus + ce `rezultat` ar primi fiecare.
4. **Confirmare Razvan** pe listă.
5. **Apply** (execute_sql, cu `RETURNING id` + backup `analiza`/`status_procesare`/`eroare` în array pt rollback):
   - 472–474: `status_procesare='eroare'`, `eroare='Citit pe sigla semnăturii — retaie planșa'`, `analiza.plansa.rezultat='sursa_gresita_sigla'`; apoi „citește” din UI (retăiere vectorială — cost AI, poarta owner/responsabil).
   - 471, 475: `eroare='citită fără date cantitative'`, `rezultat='citita_fara_date_cantitative'`.
   - 1035: doar retăiere din UI (ruta vectorială), fără UPDATE manual.
6. **Rulare RPC** v4 pe lic. 95 → clarificarea 63 (status `propunere`, text standard) se regenerează cu motivul corect. Nimic nu se trimite.
7. **Sanity SELECT** + actualizare `claude_context` (lecție: sigla se recunoaște după conținut, nu după pixeli).
