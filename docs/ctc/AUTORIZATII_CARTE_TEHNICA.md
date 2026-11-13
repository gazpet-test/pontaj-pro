# CTC — autorizațiile sudorilor pentru cartea tehnică (TKT-2026-0389)

Tab-ul „🪪 Autorizații” din CTC: autorizațiile de sudor (angajați și personal extern), doar citire, fără acces la modulul HR.
Piese: migrarea `supabase/migrations/20261222b_ctc_autorizatii_citire.sql` (revenirea în `supabase/revenire/`), funcția edge
`ctc-autorizatie-fisier`, ecranul `src/ctc/CtcAutorizatii.jsx`. Probe: `scripts/pglite/test_ctc_autorizatii_local.mjs`,
`src/ctcAutorizatiiMigrare.test.js`.

## Scanul, pe fiecare rând

| Valoarea `scan` din listă | Ce vede utilizatorul în CTC |
|---|---|
| `atasat` (fișier pe autorizație) | butonul „Deschide” — link semnat de 60 de secunde, într-o filă nouă |
| `dosar_personal` (dovada e doar documentul din dosarul personal) | „scanul e în dosarul personal — cere HR să-l atașeze la autorizație”, fără buton; deasupra tabelului, câte astfel de autorizații sunt |
| `lipsa` | „fără scan” |

Dosarul personal NU se deschide din CTC (nicio semnare în alt bucket). Când HR atașează fișierul la autorizație, rândul trece singur pe
„Deschide”.

Autorizațiile firmelor de control nedistructiv nu sunt încă în platformă.

## Ordinea livrării (coordonatorul)

1. **BASELINE**: `scripts/ctc_autorizatii_amprente.sql` pe producție (READ ONLY); coloana `linie_baseline` în blocul `BASELINE 20261222b`.
   Ultima secțiune dă numărătorile (atașat / dosar personal / lipsă).
2. **Proba pe clonă PG17**, prin runner, plafon 2000: apply → revenire → re-apply.
3. **Migrarea** pe producție: `scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000`.
4. **Funcția edge** `ctc-autorizatie-fisier`, cu `verify_jwt = true`.
5. **Probele după publicare** (cererea: `POST { "autorizatie_id": <id> }`):

   | Cerere | Așteptat |
   |---|---|
   | cont cu CTC, autorizație de sudor cu scan atașat | 200 + `url` (expiră în 60 s) |
   | cont fără CTC | 403 |
   | autorizație de alt tip (ex. ANRE) | 404 |
   | fără JWT | 401 |

6. **Merge** (deploy-ul aplicației vine automat). Test în ERP cu un cont CTC: lista, „Deschide”, rândurile „în dosarul personal”.

## Ce vede utilizatorul în stările intermediare

| Starea | Ecranul |
|---|---|
| după migrare, înainte de merge | nimic nou (aplicația veche nu are tab-ul) |
| după funcția edge, înainte de merge | nimic nou |
| după merge (ordinea de mai sus) | totul funcționează |
| merge FĂRĂ migrare | tab-ul spune „Secțiunea nu e încă activă (se activează odată cu actualizarea bazei de date).” |
| merge cu migrarea, FĂRĂ funcția edge | lista apare; „Deschide” spune „Deschiderea scanului nu e încă activă (se activează odată cu actualizarea serverului).” |
| după revenire | ca „merge fără migrare”; funcția edge răspunde 503 |

## Revenirea

Scoate doar cele trei funcții. Înainte, compară DETALIUL COMPLET al fiecăreia (tip, limbaj, definer, volatilitate, strict, leakproof,
proprietar, configurație, tipul întors, drepturi, corp) cu starea livrată; orice diferență (de exemplu un drept în plus) = refuz, cu
câmpurile care diferă, și nimic șters. Livrarea revenirii: tot prin runner, cu plafon (comanda e în antetul fișierului).
