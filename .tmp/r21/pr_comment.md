## r21 (`36d8608a`) — varianta (c) pregătită ca DRAFT, în așteptarea deciziei owner-ului

**SHA-urile celor 4 fișiere SQL se schimbă** (18a, 19a, ambele reveniri) → review nou pe toate. Nimic aplicat.

- **18a**: listă unică a obiectelor pg_net acceptate (`fn_portal_net_rel_aprobat`, md5-urile citite read-only pe producție 12.11), definiție unică a amprentei (`fn_portal_net_rel_amprenta` = secțiunea G din `porti_citire.sql`, text identic, același search_path), predicatele comune `fn_portal_net_rel_acceptat` / `fn_portal_teren_rel_drept` folosite de poartă și de precondiție. Orice drept nou, coloană nouă, tip schimbat, alt proprietar, RLS sau alt obiect în `net` = poartă roșie; mai puțin acces = verde.
- Poarta: setările PostgREST scrise în bază nu au voie să conțină `net`; `scripts/portal/scheme_expuse.sh` citește configurarea proiectului din răspunsul API-ului.
- Postcondițiile 18a / 19a și refuzurile revenirilor spun ce porți lipsesc (`IS DISTINCT FROM`, lista în mesaj).
- Harness: tabelele pg_net în forma producției (PUBLIC inclus) + mutanții ceruți; `porti_citire.sql` secțiunea M; `dry_prod_e1.sh` scrie lista din postcondiție.

**Teste rulate**: statice 76 OK (nou: `test_static_net_rel.py`, 11 mutanți), `test_livrare_validator_plafon.py` PASS, PGlite `net_rel_pglite.mjs` 24 OK (schema falsă dă exact md5-urile producției) + `porti_citire_pglite.mjs` 29 OK, fum PGlite pe 18a / 19a / reveniri OK, `vite build` OK, vitest OK în afara unui test neatins (shebang + CRLF local). **Nerulate**: harness PG17, `bash -n`, `scheme_expuse.sh --test`.

**L01–L25**: L07, L12–L15, L18–L20, L25 — dovezile în `docs/portal_angajat/E1_RAPORT.md`, secțiunea r21; restul n/a.

Merge / aplicare: la sesiunea de chat, după review și „da”-ul owner-ului.
