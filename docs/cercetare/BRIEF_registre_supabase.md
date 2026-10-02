# Brief pentru sesiunea de programare: registrele de cercetare în Supabase (varianta B)

> 02.10.2026 · decizie Razvan: **varianta B** (tabele Supabase separate, importate din JSON-urile din `docs/cercetare/`).
> Sursa de adevăr rămâne în repo până la import; după import, BD-ul devine sursa, iar JSON-urile sunt arhivă.
> Fluxul e cel standard din CLAUDE.md: migrare → preview → confirmarea lui Razvan → import → verificare.

## Ce se importă

| Tabelă nouă | Din fișier | Rânduri | Cheie | Legături |
|---|---|---|---|---|
| `norme_surse` | `registru_surse.json` | 432 | `source_id` (text, PK) | opțional `ofertare_normative_id` → `ofertare_normative.id` |
| `norme_cerinte` | `registru_cerinte.json` | 919 | `requirement_id` (text, PK) | `source_id` → `norme_surse` (FK) |
| `norme_graf` | `graf_aplicabilitate.json` | 313 | `id` bigserial; unic pe (`from_source_id`, `to_source_id`, `relatie`, `locator`) | ambele capete → `norme_surse` (FK) |
| `cnsc_decizii` | `cnsc_practica.json` | 216 | `id` (text, ex. `CNSC-BO2024_11`, PK) | sursa ei e `norme_surse.source_id = 'SRC-' \|\| id` |
| `clarificari_tipare` | `clarificari_tipare.json` | 119 | `pattern_id` (text, PK) | `normative_refs[]` → `norme_cerinte`; `precedente_cnsc[]` → `norme_surse` (FK-uri logice, verificate la import) |

`ofertare_normative` (46 de rânduri, CRUD în UI) **rămâne lista de lucru**; nu se înlocuiește. Corecturile din ea se fac separat (preview → confirmare → apply).

## Câmpuri (mapare 1:1 cu JSON-ul)

- **norme_surse**: `source_id, tip, cod, titlu, emitent, editie, data_publicarii date, effective_from date, effective_to date, status, url_oficial, acces, domenii text[], aplicabilitate_gazpet, motiv_aplicabilitate, snapshot_sha256, snapshot_data date, ultima_verificare date, nota` + `ofertare_normative_id bigint null`.
- **norme_cerinte**: `requirement_id, source_id, editie, locator, cerinta, conditii_aplicabilitate, temei_tip, obligatoriu_de_ce, evidenta_ceruta, verificare, prag jsonb, tip_consum, domeniu, faza, incredere, verificat_pe_sursa bool, necesita_standard_licentiat bool, note, tema`.
  - `temei_tip` ∈ {OBLIGATORIE_LEGE, OBLIGATORIE_DOC_ACHIZITIE, STANDARD_INCORPORAT_PRIN_REFERINTA, VOLUNTAR_BUNA_PRACTICA, GHID_INTERPRETARE, PRACTICA_CNSC} → CHECK constraint.
- **norme_graf**: `from_source_id, to_source_id, relatie, locator, nota, tema`.
- **cnsc_decizii**: toate cheile din `cnsc_practica.json`. Câmpurile-listă/obiect (`tema, temei_legal, citate_cheie, comparabilitate, control_judiciar, ofertare_normative_ids`) intră ca `jsonb` / `text[]`. Se păstrează `snapshot_text_sha256` (amprenta stabilă; `snapshot_sha256` al PDF-ului NU e stabil, portalul îl regenerează) și `alias_buletin_oficial` (2 decizii au și varianta anonimizată din BO).
- **clarificari_tipare**: `pattern_id, cod_vechi text[], tip_problema, titlu, trigger jsonb, documente_de_verificat text[], normative_refs text[], precedente_cnsc text[], intrebare_propusa text null, impact_intern jsonb, confidence, requires_human_legal_review bool, note`.

Recomandare: o coloană `versiune_import` (ex. `cercetare-2026-10-02`) pe fiecare tabelă, ca să se vadă din ce rundă vine un rând.

## Reguli Supabase (CLAUDE.md pct. 4) — obligatorii

- `ENABLE RLS` pe toate cele 5 tabele + `GRANT` pentru `authenticated` și `service_role`.
- Policies: **citire** `auth.uid() IS NOT NULL` (nu `USING(true)`); **scriere doar owner** (`is_owner`) — e cunoaștere juridică, nu date operaționale.
- View-uri noi → `WITH (security_invoker = on)`.
- DDL prin `apply_migration` (nume snake_case, ex. `norme_registre_cercetare_v1`); importul de date e DML prin `execute_sql`, după confirmare.
- După migrare: `get_advisors`.

## Ordinea pașilor

1. **Migrarea** (doar DDL, fără date) → `get_advisors`.
2. **Script de import** (Node sau Python, rulat local/în sesiune) care citește JSON-urile și generează `INSERT … ON CONFLICT DO NOTHING`. Validează înainte:
   - toate `source_id` din cerințe și graf există în surse (azi: 0 orfane);
   - toate `normative_refs` / `precedente_cnsc` din tipare există (azi: 0 lipsă).
3. **Preview pentru Razvan**: COUNT pe fiecare tabelă + 3 rânduri-exemplu → confirmare → import (cu `RETURNING`, pentru rollback).
4. **Verificare**: COUNT-urile = 432 / 919 / 313 / 216 / 119; zero FK orfane.
5. **(P1, separat)** UI read-only în Ofertare: căutare în cerințe + tipare, plus filtrul „verificat_pe_sursa” → abia apoi generatorul `ofertare-clarificari-propune` primește doar tiparele declanșate și cerințele verificate.

## Ce NU face sesiunea de programare

- Nu modifică `ofertare_normative` în același PR (corecturile au flux separat, cu confirmare).
- Nu trimite nimic din tipare către autorități. Tiparele cu `requires_human_legal_review = true` (40) cer review juridic uman înainte de orice export.
- Nu tratează deciziile CNSC ca lege (`temei_tip = PRACTICA_CNSC`).

## Fișiere de referință

`docs/cercetare/propuneri_platforma.md` (decizia A/B/C + P0–P2), `registre_evidenta.md` (regula evidence-first), `clarificari_matrice_model.md` (tabela per licitație `ofertare_matrice_cerinte`, pasul următor după import).
