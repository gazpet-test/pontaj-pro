# Brief pentru sesiunea de programare: citarea deciziilor CNSC în clarificări (A, apoi B)

> 02.10.2026 · decizia Razvan: întâi brief pentru instanța de programare. Implementarea **cere acordul explicit al lui Razvan pe schemă** (tabel nou), conform CLAUDE.md pct. 3/6. Flux: migrare → `get_advisors` → UI → build → PR.
> Context: registrele de cercetare sunt deja în Supabase (vezi `BRIEF_registre_supabase.md`, secțiunea „✅ Aplicat 02.10.2026”). Ce lipsește e legătura cu ecranul de clarificări din Ofertare.

## Scopul

Când ofertarea pune o clarificare către autoritatea contractantă, să poată invoca practica CNSC **corect și verificabil**: număr de decizie, dată, locul exact din decizie (pagina) și citatul **exact din text**, nu parafrazat. Exportul PDF al adresei de clarificări arată la final secțiunea „Practica CNSC invocată”.

## Ce există deja în BD (live, doar citire pentru utilizatori; scriere doar pentru owner)

| Tabel | Rânduri | Ce folosim |
|---|---|---|
| `cnsc_decizii` | 216 (215 `verificat = true`) | `id` (ex. `CNSC-BO2023_665`), `nr_decizie`, `buletin_oficial`, `data`, `domeniu` (gaze / distributie / apa_canal / lucrari_general), `tema text[]`, `regula`, `citate_cheie jsonb` (toate 216 au citate; format `[{"loc":"p. 19 (din 22)","text":"…"}]`), `comparabilitate`, `control_judiciar`, `avertisment_instanta`, `link_sursa` |
| `clarificari_tipare` | 119 (84 cu precedente) | `pattern_id`, `titlu`, `trigger`, `precedente_cnsc text[]`: conțin **source_id-uri** de forma `SRC-CNSC-…`; `cnsc_decizii.id = substring(x from 5)` (scoți prefixul `SRC-`), `requires_human_legal_review` (40) |
| `ofertare_clarificari` | — | `id, licitatie_id, nr, intrebare, sursa, status, raspuns, cheie, baza_generare jsonb, origine, creat_de …` |

Cod existent relevant: `src/OfertareClarificari.jsx` (panou + export PDF prin RPC `ofertare_clarificari_export(p_licitatie_id bigint) → jsonb`, apoi html2canvas → jsPDF), `src/OfertareClarificariPuncte.jsx`, `supabase/functions/ofertare-clarificari-propune/core.ts` (generatorul; rulat și de workerul NAS: `worker/ofertare/clarificari.ts`).

## Faza A — „⚖️ Adaugă temei CNSC” (manual, omul alege)

### A1. Migrare (cere acordul lui Razvan)

Tabel nou `public.ofertare_clarificari_temeiuri`:

```
id              bigserial PK
clarificare_id  bigint NOT NULL REFERENCES ofertare_clarificari(id) ON DELETE CASCADE
cnsc_decizie_id text   NOT NULL REFERENCES cnsc_decizii(id)
citat_idx       int    NULL      -- indexul în cnsc_decizii.citate_cheie; NULL = doar referința, fără citat
citat_text      text   NULL      -- COPIE înghețată a citatului la momentul alegerii (decizia se poate reimporta)
citat_loc       text   NULL      -- ex. „p. 19 (din 22)”
nota            text   NULL      -- de ce e relevantă (intern, NU intră în export)
sursa           text   NOT NULL DEFAULT 'manual' CHECK (sursa IN ('manual','propus_generator'))
confirmat       boolean NOT NULL DEFAULT true   -- B pune false până bifează omul
creat_de        uuid   DEFAULT auth.uid()
created_at      timestamptz DEFAULT now()
UNIQUE (clarificare_id, cnsc_decizie_id, citat_idx)
```

- Regulile din CLAUDE.md pct. 4: `ENABLE RLS`, `GRANT` pentru authenticated/service_role, `REVOKE` pentru anon. Citire: `auth.uid() IS NOT NULL`. Scriere: **aceeași regulă ca la `ofertare_clarificari`** (de verificat în politicile existente și copiat; nu inventa una nouă).
- CHECK sau trigger: `citat_text` trebuie să fie identic cu `citate_cheie->citat_idx->>'text'` la insert. Garanția că citatul e exact.
- Extinde `ofertare_clarificari_export` ca să întoarcă, per întrebare, temeiurile **confirmate** (`nr_decizie`, `data`, `citat_loc`, `citat_text`, `link_sursa`). E un RPC server-side: modificarea e permisă doar ca parte a acestui task aprobat.
- După migrare: `get_advisors` (security), cu zero constatări noi.

### A2. UI în `OfertareClarificari.jsx`

- Pe fiecare întrebare: buton „⚖️ Temei CNSC” care deschide un modal de căutare:
  - filtre: `domeniu`, `tema` (chips din valorile existente), text liber în `regula` / `problema` / `citate_cheie`;
  - **implicit doar `verificat = true`**; deciziile neverificate apar doar cu bifa „arată și neverificate” și o etichetă vizibilă;
  - fiecare rezultat: `nr_decizie` + data + `regula` (2 rânduri) + citatele cu `loc`; afișează `avertisment_instanta` / `control_judiciar` dacă există (ex. decizie desființată sau menținută în instanță).
- Omul alege decizia și, opțional, un citat → INSERT în tabelul nou.
- Sub întrebare apar chip-uri cu temeiurile alese (șterge = DELETE pe rând).
- **Nu se modifică automat textul `intrebare`.** Citarea se adaugă la export, nu în text, ca să nu se strice amprenta `baza_generare` și reconfirmarea (R5 runda 9).

### A3. Export PDF

- După întrebări, secțiunea **„Practica CNSC invocată”**, numerotată, cu formatul:
  `Decizia CNSC nr. {nr_decizie}, din {data} — {citat_loc}: „{citat_text}”` (+ `link_sursa` dacă există).
- Sub titlul secțiunii, o frază fixă: *„Deciziile CNSC sunt invocate ca practică de interpretare a legislației achizițiilor publice, nu ca normă obligatorie.”*
- La întrebarea respectivă: trimitere scurtă „(a se vedea practica CNSC nr. 1, 3)”.
- Ce apare în export: doar temeiurile cu `confirmat = true`.

## Faza B — generatorul propune (după ce A e pe main)

- În `core.ts` (`propuneClarificari`): pentru fiecare întrebare generată dintr-un tipar care are `precedente_cnsc`, inserează în `ofertare_clarificari_temeiuri` maximum 3 rânduri cu `sursa = 'propus_generator'`, `confirmat = false`, `citat_idx = 0`.
  - Ordonare: întâi domeniul licitației (`gaze` / `distributie`), apoi cele mai recente.
  - Doar decizii cu `verificat = true`.
- UI: propunerile apar ca chip-uri gri „propus — bifează”. Omul confirmă (`confirmat = true`) sau șterge.
- **Tiparele cu `requires_human_legal_review = true`**: banner „Cere review juridic”. Exportul refuză întrebarea până când un owner bifează explicit review-ul. Se reutilizează mecanismul de reconfirmare existent; dacă nu se potrivește, întreabă înainte.
- **Fără apel AI nou.** Legătura e deterministă, din tabelul `clarificari_tipare`, deci fără cost și fără halucinații de numere de decizie. Fișa de securitate din `registru_automatizari` nu se schimbă (aceeași funcție, aceeași poartă de rol). Notează totuși în registru că scrie și în tabelul nou.
- Test în `core_test.ts`: un tipar cu precedente → 3 rânduri neconfirmate; un tipar fără precedente → 0; un precedent cu `verificat = false` → exclus.

## Ce NU face sesiunea de programare

- Nu modifică `cnsc_decizii` / `clarificari_tipare` (scriere doar pentru owner; actualizarea vine din rundele de cercetare).
- Nu generează citate din AI și nu parafrazează. Citatul vine **doar** din `citate_cheie`.
- Nu trimite nimic către autorități. Adresa se depune în SEAP de om, ca până acum.
- Nu face faza C (matricea per licitație, `clarificari_matrice_model.md`); e un pas separat, după ce A și B sunt folosite.

## Criterii de acceptare

1. Pe o licitație de test: adaugi 2 temeiuri la o întrebare, exporți PDF-ul, iar secțiunea apare cu citatele exacte (comparate caracter cu caracter cu `citate_cheie`).
2. Un utilizator fără drept de scriere pe clarificări nu poate insera temeiuri (test RLS).
3. `npx vite build` și testele existente din `src/*Clarificari*.test.js` trec.
4. B: rulezi generatorul pe o licitație cu o problemă de experiență similară → propuneri neconfirmate. Nu apar în PDF până nu sunt bifate.

## Referințe

`docs/cercetare/BRIEF_registre_supabase.md` · `propuneri_platforma.md` · `clarificari_matrice_model.md`. Documentul Word pentru colegii de la ofertare („Practica CNSC – ofertare clarificări”) e la Razvan; nu e în repo, pentru că repo-ul e public.
