# Proveniența datelor DERIVATE pe loturi — plan (follow-up la PR #676)

Status: PLAN, nimic aplicat. Decizia Răzvan 12.10.2026 (prin chat): **B** = merge #676 cu cele 4 P1 din review-ul
Jakarinos r5 cunoscute, mutate aici. Migrarea de aici = „da” separat la aplicare. Fără date reale noi pe 102.

Sursa: `C:\Users\Public\paw-data\out\loturi_mvp_jak_cod_r5_20261012_ofertare.log` (NO-GO pe acae6be, 4 P1, toate reproduse
cu BD + transport AI simulate).

## Principiul comun

Un rând DERIVAT (dispoziție, clarificare generată, exemplu de feedback, cantitate) poate intra într-un prompt plătit
doar dacă **toate** documentele din care provine sunt eligibile ACUM (`fn_ofertare_document_eligibil`, reverificat la
fiecare apel, nu moștenit) și lotul lui trece de participare. Pe `are_loturi`, un derivat **fără proveniență verificabilă
iese** (fail-closed, motiv `fara_provenienta`). Pe `fara_loturi` comportamentul rămâne cel de azi (fără regresie).

Helper nou în `_shared/eligibilLot.ts`: `filtreazaDerivate` primește opțional `surse_document_ids: number[]` pe rând
(pe lângă `sursa_document_id`) și cere eligibilitatea pe TOATE; opțiunea `cereProvenienta` (activă pe `are_loturi`)
exclude rândurile fără nicio sursă documentară care nu sunt marcate manual.

## Impact măsurat pe live (12.10.2026, doar citire)

| Ce | Total | Pe licitații `are_loturi` |
|---|---|---|
| clarificări `origine='platforma'` | 45 | 0 |
| cantități | — | 2 |
| seturi de răspunsuri | — | 0 |
| `ai_feedback` ofertare-cerinte | 2.880 (toate cu `ref_table='ofertare_cerinte'` + `ref_id`) | — |

Deci azi pe 102 expunerea reală e aproape zero; riscul apare după triere și primele extrageri pe loturi.
De aceea PR-ul ăsta trebuie aplicat ÎNAINTE de trierea AI / extragerea cerințelor pe 102.

## P1 #1 — Coada lipită A→B pierde documentul A (ofertare-raspuns-set) — DOAR COD

Fișier: `ofertare-raspuns-set/index.ts` ~238–357. `propunere` e jsonb, deci fără schemă.
- `propunere.coada_doc_ids: number[]` în loc de `coada_doc_id`: la fiecare fragment, dacă s-a folosit coada,
  `coada_doc_ids = coada_doc_ids_anterioare ∪ {doc curent}`; coada nouă moștenește setul.
- Fiecare dispoziție primește `doc_ids: number[]` = `{doc curent}` ∪ `coada_doc_ids` (dacă fragmentul a folosit coada).
- `inventar` și `compara`: `filtreazaDocumente` pe reuniunea tuturor `doc_ids`; o dispoziție cu ORICE document blocat
  iese (cu motiv în răspuns), coada cu orice document blocat e omisă.
- Compatibilitate: `coada_doc_id` vechi (un singur id) se citește ca `[id]`; dispoziții vechi fără `doc_ids` pe
  `are_loturi` = omise (`fara_provenienta`), pe `fara_loturi` = ca azi.
- Teste: A blocat după lipire → dispoziția din B iese; coadă A→B→C cu A blocat → omisă la C.

## P1 #2 — Clarificări generate de platformă fără proveniență structurată — SCHEMĂ + COD

Azi ID-urile cerințelor stau doar în textul `sursa` („(cerințe #12, #15)”); lipsa `fisier_path` e tratată ca „manual”.

Migrare (`ofertare_clarificari`):
- `surse_cerinte_ids bigint[]`, `surse_cantitati_ids bigint[]`, `surse_document_ids bigint[]` (documentele cerințelor/
  cantităților la momentul generării, plus `fisier_path` rezolvat), `provenienta text` CHECK
  (`manual` / `document` / `platforma` / `backfill_text`), NOT NULL după backfill.
- Backfill (preview + „da”): `origine='platforma'` → parsare `cerințe #N` din `sursa` → `surse_cerinte_ids`,
  `provenienta='backfill_text'`; cele cu `fisier_path` → `document`; restul cu `creat_de` uman → `manual`.
  45 de rânduri, toate pe licitații fără loturi.
- Trigger de validare: `provenienta='platforma'` cere cel puțin o sursă; ID-urile trebuie să fie din aceeași licitație.

Cod:
- `ofertare-clarificari-propune/core.ts` ~258: la salvare scrie `surse_*` + `provenienta='platforma'`.
- Reutilizare (`clarCtx` în clarificari-propune, `ofertare-clarificare-aplica`, `ofertare-genereaza-capitol`, exemplele
  din alte licitații): o clarificare intră doar dacă cerințele/cantitățile ei trec `filtreazaDerivate` și documentele
  ei sunt eligibile; `platforma` fără surse = omisă pe `are_loturi`. Lipsa PDF-ului NU mai dovedește origine manuală.

## P1 #3 — Exemplele din `ai_feedback` retransmit conținut blocat (ofertare-cerinte/core.ts:250) — DOAR COD

`ai_feedback` are deja `ref_table`/`ref_id` (2.880/2.880 completate, toate `ofertare_cerinte`).
- Înainte de a pune exemplele în promptul sistem: citește cerințele `ref_id` (`id, licitatie_id, sursa_document_id,
  lot_domeniu, lot_nr, lot`), apoi `filtreazaDocumente` pe `sursa_document_id`-uri (poarta per document funcționează
  peste licitații) și lotul cerinței față de participarea licitației EI (`participareLicitatie`, cache per licitație).
- Exemplu fără `ref_id` rezolvabil, cu document blocat sau lot în afara participării = omis. Eroare de poartă = zero
  exemple (nu exemple nefiltrate).
- Teste: feedback pe cerință din document devenit neeligibil → nu apare în promptul sistem.

## P1 #4 — Cantități fără document-sursă (clarificari-propune/core.ts:128–143) — SCHEMĂ + COD

Migrare (`ofertare_cantitati`):
- `surse_document_ids bigint[]` = documentul din care s-a extras cantitatea ∪ planșa care a dat `cantitate_plansa`
  ∪ documentele invocate de `diferenta_nota`; index GIN; trigger: ID-urile din aceeași licitație.
- Backfill (preview + „da”): potrivire `sursa` („nume_original — loc”) pe `nume_original` din licitație, DOAR la
  potrivire unică; restul rămân NULL (= `fara_provenienta`, ies pe `are_loturi`, intră ca azi pe `fara_loturi`).

Cod:
- Scriitori: `ofertare-cantitati-extrage/handler.ts` ~381 (`d.id`), `ofertare-plansa-citeste` (adaugă planșa când
  scrie `cantitate_plansa`/`diferenta_nota`), worker `plansa_cli_importa.ts`.
- Cititori: `filtreazaDerivate` cu `surse_document_ids` în clarificari-propune, genereaza-capitol, verificare-finala.
- Retrierea unui document nu mai trebuie să invalideze rânduri: eligibilitatea se reverifică la fiecare citire.
  UI-ul (lista de cantități) arată „blocat pe loturi: document X” pentru rândurile excluse.

## Livrare

1. Commit 1: migrarea `2026102Xa_ofertare_provenienta_derivate.sql` + ROLLBACK (drop coloane, după arhivarea lor) +
   harness `supabase/tests/` (validare trigger, ID din altă licitație refuzat, backfill idempotent). Copilot conv. 3
   GO pe SQL ÎNAINTE de apply; apply prin `scripts/livrare_migrare.sh` doar cu „da” Răzvan.
2. Commit 2: cod P1 #1 + #3 (fără schemă, poate intra imediat după GO).
3. Commit 3: cod P1 #2 + #4 (după apply).
4. Review Jakarinos r6 pe tot diff-ul, apoi merge + deploy edge atinse + `verifica-edge-functions`.

Ordinea față de 102: PR-ul ăsta înainte de trierea AI propusă pe 102 și înainte de orice extragere de cerințe/cantități
pe loturi.
