# R4 — Citirea planșelor pe zone: concurență, versiuni, proveniență, coadă persistentă

Data: 25.09.2026 · Acoperă T4 / T11 / C3 / C4 din `AUDIT_DOCUMENTATIE_OFERTARE_2026-09-25.md` și `MATRICE_ACOPERIRE_AUDIT_OFERTARE.md`.
Stare: pct. 1–5 **implementate în cod + teste** (fără schemă nouă, nimic deployat). Pct. 6 = **design; tabelul cere GO**. R4 **nu** rezolvă independența de browser și nici costul dublu între taburi — doar coada (§2).

> **Limite explicite ale R4 (ce NU rezolvă codul livrat):**
> - **Independența de browser — NU.** Bucla de citire rulează tot în browser: tab închis ⇒ citirea se oprește și se reia manual („continuă”). CAS-ul doar împiedică suprascrierea; nu continuă nimic singur.
> - **Costul dublu între taburi — NU.** Două taburi care citesc aceleași zone plătesc de două ori; CAS + fuziunea păstrează rezultatul o singură dată, dar banii s-au cheltuit. Lease-ul de transfer (§1.1) serializează doar scrierea în `ofertare_cantitati`, nu citirea AI.
> - Ambele se rezolvă **doar** prin coada persistentă (§2) = **schemă nouă ⇒ cere GO** de la Razvan. Până atunci rămân riscuri deschise.
>
> **Actualizare runda 3 (25.09, noapte) + corecturi după verificator — vezi `docs/R4_REZERVARE_ZONE_SI_COADA_NAS.md`:**
> costul dublu între taburi e **remediat în cod, nedeployat și netestat LIVE** — FĂRĂ schemă nouă: rezervare per
> (document, zonă, tăiere) în `analiza.rezervari_zone`, prin CAS, înainte de apelul AI (al doilea tab primește 409 „în lucru
> în alt tab”, zero AI; rezervarea expiră în 7 min, cu plafon, și se poate prelua; „citește” de la zero nu cooperează).
> Se închide abia după deploy + testul LIVE cu 2 taburi. Reziduu: fereastra tăiere+upload din `/api/plansa-felii`.
> Independența de browser rămâne deschisă: coada pe NAS e proiectată acolo (§3) + migrare propusă, neaplicată (cere GO).

## 1. Ce s-a implementat

### 1.1 Două taburi / două rulări nu se mai suprascriu (compare-and-set)
- Jeton: `analiza.citire_ai.rev` (UUID nou la FIECARE scriere a citirii). Fără coloană nouă.
- Scriere condiționată (`concurenta.ts → scrieCAS`):
  `update(...).eq('id', doc).eq('analiza->citire_ai->>rev', revCitit).select('id')` (sau `.is(..., null)` pentru citirile vechi fără jeton); se verifică **exact 1 rând afectat**.
- La conflict: se recitește documentul, rezultatele rundei se **fuzionează pe cheia zonei** (`fuzioneazaZone`: ce e salvat rămâne; zona nouă o înlocuiește pe cea veche; o **eroare nouă nu înlocuiește un rezultat bun**), apoi sumarul/statusul/rezultatul se recalculează din fuziune și se reîncearcă — max. 3 încercări, apoi 409.
- Retăierea (`/api/plansa-felii`) schimbă și ea `rev` ⇒ o rundă în zbor pe tăierea veche nu scrie peste; la recitire vede alt `taiat_la` ⇒ 409 (nu amestecă zonele a două grile).
- Pasul „lipește notele” scrie tot prin CAS (notele se refac peste citirea proaspătă).
- Transferul în `ofertare_cantitati` se face **după** scrierea câștigătoare și e **serializat printr-un lease**: înainte de transfer, invocarea obține prin CAS `citire_ai.transfer = {stare:'in_curs', de_la, rulare}` (refuzat dacă altă invocare are `in_curs` de <5 min sau a terminat `facut` după ce a pornit invocarea curentă). Doar deținătorul transferă; ceilalți sar și raportează `cantitati.sarit = "transfer în curs de altă rulare"`. La final deținătorul scrie (tot prin CAS, doar dacă încă deține lease-ul) `stare: facut|eroare` + `sumar.cantitati`. Lease-ul unei alte rulări nu e șters de scrierea citirii (se păstrează `citire_ai.transfer`). Lease expirat (>5 min, worker omorât) ⇒ se poate relua.
- `/api/plansa-felii` scrie tot prin CAS — funcția e în `api/_cas.js` (`scrieAnalizaCAS`, 3 încercări, apoi **409 explicit**, nimic suprascris), importată efectiv de handler și testată separat.
- Răspunsul are `scriere_concurenta: {incercari}` când a fost conflict.

**De ce CAS și nu lacăt** (`citire_ai.lock {de_la, pana_la, uid}`): o rundă ține 1–3 min; un lacăt fie blochează al doilea tab tot timpul ăsta, fie rămâne agățat când funcția e oprită (worker killed — exact cazul pe care îl evităm în Edge), fie expiră prea devreme și nu mai protejează. CAS nu ține nimic ocupat, nu are stare de curățat și nu pierde nimic plătit. Limita: nu previne **plata dublă** (două taburi pe `continua` citesc aceleași zone) — rezultatul se păstrează o dată, costul se plătește de două ori. Asta o rezolvă coada (§2), nu un lacăt pe JSON.

### 1.2 Versiuni incompatibile nemixate
- Versiunea curentă `{cod: COD_VERSIUNE, model, prompt_sha}` se calculează **înainte** de orice citire.
- `continua` / `reia_erori` / `de_la > 0` pe o citire salvată cu altă cheie `cod|model|prompt_sha` (sau fără versiune = necunoscută) ⇒ **409**, zero AI, zero scrieri. Mesaj: „pornește «citește» din nou”. Parametrul explicit `mixare_permisa: true` permite amestecul **doar pentru model / prompt_sha / cod**; atunci `sumar.versiuni_mixte` listează cheile.
- `mixare_permisa` **nu** trece peste diferențe de `taiat_la`, `cale_felii`, geometria zonelor (`geom_sha` = SHA pe `zone_geom` + `zone_asteptate`), `fisier` / `fisier_path` ⇒ 409 indiferent de parametru (`CAMPURI_NEMIXABILE`, `diferenteNemixabile` în `concurenta.ts`). Citirile salvate fără aceste câmpuri (dinaintea schimbării) ⇒ 409 la reluare: se pornește „citește”.
- Fiecare zonă citită poartă `_versiune` (`cod|model|prompt_sha`). `COD_VERSIUNE` → `2026-09-25.5`.
- ⚠ Efect la deploy: citirile rămase la jumătate pe versiunea `.4` vor primi 409 la „continuă / reia zonele căzute” — intenționat; se pornește „citește”.

### 1.3 Proveniență pe regiune
- `/api/plansa-felii` salvează acum în `analiza.plansa`: `zone_geom {zona: [left, top, width, height, iSursa]}` (pixeli sursă), `surse_geom [{pagina, latime, inaltime, dpi, latime_pt, inaltime_pt}]`, `suprapunere`. `_randare-pdf.js` întoarce dimensiunea paginii în puncte (viewport scale 1).
- Fiecare tronson are `_zona` și `_regiune {pagina, unitate:'pt', x0, y0, x1, y1}` — puncte PDF, origine stânga-jos (y în sus, ca în PDF). Scara: `latime_pt/latime` (exact) sau `72/dpi`.
- Limite: la **scanările încorporate** nu știm dimensiunea paginii în pt ⇒ regiunea rămâne în pixeli sursă (`unitate:'px'`, origine stânga-sus). Planșele tăiate înainte de schimbare nu au `zone_geom` ⇒ fără `_regiune` până la retăiere. Paginile rotite: coordonatele sunt ale viewport-ului pdf.js (orientarea afișată).

### 1.4 Teste (`concurenta_test.ts`, deps simulate, fără rețea)
Două rulări concurente pe zone diferite (A `continua` 1_5/1_6, B `reia_erori` 1_2) ⇒ ambele păstrate, B reîncearcă o dată, planșa `gata`; eroare nouă nu înlocuiește rezultat bun; versiune diferită ⇒ 409 pe `continua`/`reia_erori`/`de_la`; `_versiune`/`_zona`/`_regiune` pe rularea completă; `regiuneZona` pe caz simplu + fallback dpi/px; retăiere în timpul rundei ⇒ 409 și tăierea nouă nu e suprascrisă; `rezultatCitire` pe ok / partial / ilizibil / citita_fara_date_cantitative / sursa_gresita_sigla.
Plus (Copilot, runda 2): epuizarea celor 3 reîncercări CAS ⇒ 409 explicit, zonele salvate și tăierea intacte; `mixare_permisa` refuzat pe tăiere/grilă/geometrie/fișier diferite (unitar + handler, zero AI); două rulări „citește” simultane ⇒ **o singură inserare** pe Dn nou în `ofertare_cantitati` (lease; testul pică dacă lease-ul e dezactivat); `leaseTransferOcupat` pe cazuri.
`deno test --node-modules-dir=none -A supabase/functions/` ⇒ **50 passed, 0 failed**. `node scripts/test-cas-felii.mjs` ⇒ 14/14 (traseul complet al scrierii din `/api/plansa-felii`). `node scripts/test-detector-sigla.mjs` ⇒ 17/17. `deno.lock` readus.

### 1.5 Acoperirea paginii (`acoperire_demonstrata`)
- Scanare din PDF cu ≥50% din pagină: procentul **decide doar ruta** (`decideRuta`), nu mai dă acoperire.
- `true` doar dacă: (a) randare completă a tuturor paginilor (`acoperire_tip: 'randare_completa'`), sau (b) imaginea acoperă ≥95% din aria paginii în coordonate PDF **și** operatorList nu are path-uri / text / alte imagini în afara bbox-ului ei (`acoperire_tip: 'imagine_pagina_intreaga'`; `_randare-pdf.js → acoperire_pdf`, `plansa-felii.js → acoperireScanPdf`).
- Imagine încărcată direct (JPG/PNG): `true`, cu `acoperire_tip: 'imagine_originala'` (acoperă imaginea originală, nu o pagină).
- Fixture-uri: scanare 60% + tabel vectorial în rest ⇒ `false` (partial); scanare pe toată pagina fără altceva ⇒ `true`.

### Rămas neatins
- UI (`OfertareLicitatii.jsx`): un 409 apare ca eroare generică `non-2xx` din `functions.invoke` (la fel ca celelalte 409 existente). De citit `error.context` pentru mesaj — mic, separat.

## 2. Design: coadă persistentă pe NAS (independentă de browser) — singura soluție pentru independența de browser și costul dublu; **schemă nouă, cere GO**

Azi bucla rulează în browser: tab închis ⇒ citirea se oprește (se reia manual cu „continuă”). Workerul de pe NAS Terra (`worker/ofertare`, Deno, heartbeat `worker_heartbeat`, deja consumă `ofertare_extragere_coada`, `ofertare_acoperire_coada`, `ofertare_clarificari_coada`) poate rula aceeași logică fără limita de 150 s.

### 2.1 Tabel propus — **CERE GO (schemă nouă)**
```sql
CREATE TABLE public.ofertare_plansa_coada (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id       bigint NOT NULL REFERENCES ofertare_documente_atribuire(id) ON DELETE CASCADE,
  licitatie_id bigint NOT NULL,
  taiat_la     text   NOT NULL,          -- amprenta tăierii
  zona         text   NOT NULL,          -- 'z1_3' / 'zp2_1_3'
  versiune     text   NOT NULL,          -- cod|model|prompt_sha
  stare        text   NOT NULL DEFAULT 'asteapta' CHECK (stare IN ('asteapta','lucru','gata','eroare','anulat')),
  incercari    int    NOT NULL DEFAULT 0,
  max_incercari int   NOT NULL DEFAULT 3,
  urmatoarea_la timestamptz NOT NULL DEFAULT now(),   -- backoff
  luat_de      text, luat_la timestamptz, lease_pana timestamptz,
  rezultat     jsonb, eroare text, cost_usd numeric(10,4) DEFAULT 0,
  cerut_de     uuid NOT NULL REFERENCES auth.users(id),
  creat_la     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_id, taiat_la, zona, versiune)           -- idempotență
);
ALTER TABLE public.ofertare_plansa_coada ENABLE ROW LEVEL SECURITY;
-- SELECT pentru authenticated (auth.uid() IS NOT NULL); INSERT/UPDATE doar prin RPC-ul de înscriere + service_role (worker).
```

### 2.2 Înscriere (poartă de rol) — RPC `ofertare_plansa_inscrie(p_doc_id, p_mod)`
`SECURITY DEFINER SET search_path = public, pg_temp`. Verifică **în SQL** aceeași poartă ca `poateCheltui`: `is_owner` sau `responsabil_id` al licitației = `auth.uid()`; altfel excepție. Citește `zone_asteptate` + `taiat_la` din `analiza.plansa`, versiunea curentă (constantă publicată de worker într-un rând de config) și face `INSERT ... ON CONFLICT (doc_id, taiat_la, zona, versiune) DO NOTHING` — a doua apăsare / al doilea tab nu dublează nimic (rezolvă și plata dublă din §1.1). `p_mod='reia_erori'` ⇒ `UPDATE ... SET stare='asteapta', incercari=0 WHERE stare='eroare'`.

### 2.3 Claim atomic (worker)
```sql
UPDATE ofertare_plansa_coada q SET stare='lucru', luat_de=$worker, luat_la=now(), lease_pana=now()+interval '10 min', incercari=incercari+1
WHERE q.id IN (
  SELECT id FROM ofertare_plansa_coada
  WHERE (stare='asteapta' AND urmatoarea_la<=now()) OR (stare='lucru' AND lease_pana<now())   -- lease expirat = worker căzut
  ORDER BY creat_la LIMIT $n FOR UPDATE SKIP LOCKED)
RETURNING *;
```
Prin RPC `ofertare_plansa_claim(p_worker, p_n)` apelabil DOAR de service_role (REVOKE EXECUTE FROM PUBLIC, authenticated).

### 2.4 Execuție, retry, idempotență
- Workerul citește zona cu **același cod** (`citesteFelie` extras într-un `core.ts` partajat, ca la `ofertare-cerinte`), scrie `rezultat` + `cost_usd` pe rândul cozii, `stare='gata'`.
- Eroare de furnizor (429/529/5xx): `stare='asteapta'`, `urmatoarea_la = now() + 2^incercari min`; peste `max_incercari` ⇒ `eroare`. Eroare de business ⇒ scrisă în rând, nu throw.
- Dacă `taiat_la` sau versiunea curentă nu mai corespund documentului ⇒ `anulat` (fără apel AI).
- Agregarea: când toate zonele unei `(doc, taiat_la, versiune)` sunt `gata|eroare`, workerul compune `citire_ai` din rânduri (aceeași funcție de sumar ca edge-ul) și scrie prin **CAS pe rev** (§1.1). Rezultatul pe zonă stă în coadă ⇒ agregarea e reluabilă oricând, fără cost.

### 2.5 Cost cap
- Pe document: la claim se sumează `cost_usd` pe `(doc_id, taiat_la)`; peste plafon (ex. 8 $/planșă, config) ⇒ restul zonelor `anulat` + notificare către `cerut_de`.
- Pe zi/licitație: sumă din `ai_usage_log` (`function_name='ofertare-plansa-citeste'`); peste plafon ⇒ workerul nu mai ia rânduri, notifică ownerul.
- Concurența la furnizor: `p_n` = paralelismul (2 implicit, 4 măsurat), setat în worker, nu din browser.

### 2.6 Fișa de securitate (CLAUDE.md pct. 7)
(a) conținut extern: imaginea planșei (document SEAP) — text scris de altcineva, trimis la AI; rezultatul e DATE. (b) scrie: `ofertare_plansa_coada`, `analiza.citire_ai`, `ofertare_cantitati` (transfer), `ai_usage_log`; nu trimite mail, nu atinge bani/drepturi. (c) identitate: service_role în worker (necesar: scrie pe documente ale oricărui responsabil); înscrierea rulează ca utilizatorul. (d) pornire: doar prin RPC cu poarta owner/responsabil verificată în SQL. (e) cheltuiala e pornită doar de om (înscriere) și plafonată. Se trece în `registru_automatizari` la livrare.

### 2.7 Ce se poate face FĂRĂ schemă nouă
- Coada „săracă” în JSON: `analiza.plansa_coada {cerut_de, cerut_la, versiune, mod}` scrisă de edge (după poartă) + workerul caută documentele cu cheia prezentă și rulează bucla `continua` apelând edge-ul cu service key până la `continua=false`. Idempotența vine din §1.1–1.2 (CAS + zone fuzionate + versiune), claim-ul prin CAS pe `rev` (workerul își pune `luat_de` + `lease_pana` în același JSON). Merge, dar e mai fragil decât tabelul (fără SKIP LOCKED, fără istoric de încercări pe zonă, cost cap doar din `ai_usage_log`).
- Recomandare: tabelul (§2.1) — cere GO.
