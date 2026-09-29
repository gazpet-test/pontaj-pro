# JAK-V2-07c — corecții NO-GO PR #516

Implementat conform `C:\Users\Public\spec_v2_07c.md`. Fără git, acces la producție sau modificări în afara directorului de lucru. Nu au fost identificate contradicții care să necesite `BLOCKED_DECISION`.

## Modificări

- `supabase/migrations/20260928p_ofertare_rls_scriere_r_v2_07.sql`: triggerul permite integral sesiunea `postgres` și accesul Ofertare/owner; identifică `service_role` din claims, cu fallback legacy, și limitează diferențele la `termen_depunere`, `documentatie_adusa_la`, `updated_at`. Financiar este verificat explicit și poate modifica doar `contract_id`, `updated_at`. Celelalte contexte sunt refuzate cu `P0001`. Comparațiile folosesc întregul rând JSONB minus coloanele permise.
- Secțiunea B: cele 21 de politici `ALL` devin 21 de politici `SELECT` cu condiția și rolurile originale, plus 63 de politici INSERT/UPDATE/DELETE. Cele 12 politici deja per-comandă rămân neschimbate: total 75 politici de scriere, 21 SELECT noi, plus SELECT preexistente.
- Fișierul `_ROLLBACK.sql`: elimină politicile rezultate din separare și reface exact politicile originale, inclusiv rolurile `public`.

## Aserții în `scripts/pg/test_jakv207_rls.mjs`

- Service: termen/documentație/updated_at permise; status, responsabil, contract și UPDATE combinat termen + status refuzate cu mesajul exact și `P0001`. Refuzurile compară întregul rând înainte/după.
- Rol legacy cu claims goale: termen permis, status refuzat; rolul explicit din claims are prioritate.
- Context fără UID și rol JWT, sesiune diferită de `postgres`: status, contract și updated_at refuzate. Rolul observer din fixture are BYPASSRLS, fără SUPERUSER, astfel încât testul verifică triggerul efectiv.
- Fără modul: SELECT cantități întoarce rânduri; INSERT refuzat, UPDATE/DELETE afectează zero rânduri, datele rămân neschimbate.
- Catalog: 75 politici de scriere, 21 SELECT cu USING/roles originale, SELECT preexistente intacte, fără ALL sau politici suplimentare în B.
- Păstrate probele postgres, Financiar, Ofertare, owner/cascadă, granturi, rerulare și egalitatea exactă a catalogului după rollback.

## Verificări executate și limite

- `node --check scripts/pg/test_jakv207_rls.mjs`: PASS.
- Verificare statică în memorie: generarea șabloanelor JS, structura politicilor, rolurile/condiția SELECT, simularea secvenței apply de două ori → rollback de două ori → reapply: PASS. Aceasta nu execută și nu validează SQL în PostgreSQL.
- Testul pe PostgreSQL 16 nu a fost rulat; conform specificației, îl rulează Claude. Fixture-ul rămâne minimal și nu reproduce toate triggerele de business din producție. Migrarea nu a fost aplicată pe nicio bază de date.
