# E4c GPS — pachetul de livrare (run_mig DRY → „da” → apply)

Decizia lui Răzvan din 24.10 (Q-E4-15 B): coordonatele GPS ale unei declarații de pe tabletă se șterg la 60 de zile după decizie.

Branch `izometrie/e4c-gps`, PR-ul draft al acestui pachet. Copilot: **GO** (P0 0, P1 0). Harness PG16 **prodlike**: PASS.

## Artefacte

| Fișier | sha256 (blob git, LF) | octeți |
|---|---|---|
| `supabase/migrations/20261111a_izometrie_gps_curatare.sql` | `ee7b00e308af03636f4b2f6c6d373540f21f17aca55fa05bdebf85e8bbe8e7e1` | 63324 |
| `supabase/revenire/20261111a_izometrie_gps_curatare_ROLLBACK.sql` | `140ce4e52ca0faf88f1c87f52255269cc88dfc1a762fa0bebe3a9d568d83ba6a` | 50600 |

Fișierele sunt generate de `scripts/izometrie/e4_gen/gen_e4c_gps.py`.

Runner: `scripts/livrare_migrare.sh`. Propunere: `--nume 20261111a_izometrie_gps_curatare --versiune 20261111120000 --tinta-db postgres --tinta-sistem 7632885393857617092`.

**Armarea revenirii**, în aceeași tranzacție, ca postgres: `SELECT set_config('gazpet.revenire_20261111a','IZO_E4C_GPS_SCOATE:'||txid_current(),true);`.

## Precondiții (verificate pe prod read-only, 24.10)

- `fn_izo_porti_lipsa()` = `{}`.
- md5-urile LIVE se potrivesc cu migrarea:
  - `fn_izo_teren_imuabil` `741899c1…`
  - `fn_izo_porti_e4_lipsa` `8507918c…`
  - `fn_izo_porti_e4b_definitii` `a526b6e2…`
- Nu există `izo_gps_stergeri` și nici jobul cron. Ultima versiune din istoric e `20261110120000`.
- `izo_declaratii_gps` are 0 rânduri. Primele coordonate vor veni din repetiția de pe T15.
- pg_cron rulează în GMT (`cron.timezone`): `23 3 * * *` = 06:23 ora României.

## Ce schimbă

- **Funcție nouă** `fn_izo_gps_curata(p_limita int DEFAULT 5000)`:
  - SECURITY DEFINER, proprietar `izo_montaj_writer`, EXECUTE doar pentru `postgres`;
  - șterge în loturi rândurile GPS ale declarațiilor `aprobata` / `respinsa` cu `decis_la` mai vechi de 60 de zile, și ale celor `stearsa` cu `updated_at` mai vechi de 60 de zile;
  - nedecisele și cele cu `decis_la` NULL rămân neatinse.
- **Garda `fn_izo_teren_imuabil`** primește o excepție îngustă: DELETE pe `izo_declaratii_gps` e permis doar sub contextul curățării (legat de txid, de declarație și de versiune) și doar pentru rolul writer. Corpul vechi se restaurează exact la rollback.
- **Tabel nou** `izo_gps_stergeri`: jurnal imuabil, **fără coordonate**, cu RLS și fără acces API.
- **Job pg_cron** `izo_gps_curatare_zilnic`, `23 3 * * *`, `SELECT public.fn_izo_gps_curata();` (username postgres).
- La apply nu se șterge nimic: prima rulare e a jobului.
- Re-ștampilarea porților; `control_0e` = 0.

## Ce NU atinge

Date existente, drepturi, `user_module_access`, `storage.*`.

## Rollback

- Scoate jobul, funcția, tabelul și excepția și restaurează exact corpurile și ștampilele.
- **Refuză dacă jurnalul are deja ștergeri.** Coordonatele șterse nu se mai pot reconstrui, iar auditul nu se pierde.

## Registrul automatizărilor (CLAUDE.md pct. 7)

Le aplică chat-ul, după apply, cu „da”. Valorile de mai jos sunt propuse.

**Rând nou în `public.automatizari`** (coloanele reale ale tabelului):

```sql
INSERT INTO public.automatizari(cod, nume, tip, unde, program, referinta, ce_face, responsabil, citeste_extern, ce_scrie,
  identitate, cine_porneste, confirmare_umana, secrete_nume, stare, decis_de, decis_la, verificat_la, registru_sectiune, observatii)
VALUES ('cron_izo_gps_curatare', 'Izometrie — ștergerea coordonatelor GPS la 60 de zile', 'cron_bd', 'Supabase pg_cron (jobname izo_gps_curatare_zilnic)',
  '23 3 * * * (GMT) = 06:23 RO', 'migrarea 20261111a_izometrie_gps_curatare; docs/izometrie/E4C_GPS_LIVRARE.md',
  'Șterge rândurile din izo_declaratii_gps ale declarațiilor decise (aprobată / respinsă / ștearsă) de peste 60 de zile; jurnal fără coordonate în izo_gps_stergeri',
  'Izometrie (programare) / Răzvan',
  'nimic extern (doar tabele proprii: izo_declaratii, izo_declaratii_gps)',
  'DELETE izo_declaratii_gps + INSERT izo_gps_stergeri; fără mail, fără bani, fără drepturi',
  'pg_cron ca postgres → fn_izo_gps_curata SECURITY DEFINER al izo_montaj_writer (fără service_role; RLS respectat de writer)',
  'doar pg_cron / postgres (EXECUTE revocat de la PUBLIC, anon, authenticated, service_role)',
  'nu: decizia de retenție e a lui Răzvan (24.10); ștergerea e predicat fix, fără input extern',
  NULL, 'activ', 'Răzvan', '2026-10-24', now(), 'Izometrie', 'Q-E4-15 B; rollback refuzat după prima ștergere');
```

**Secțiune nouă în `claude_docs.registru_automatizari`** (text de adăugat):

> **Izometrie — ștergerea GPS** (`izo_gps_curatare_zilnic`, pg_cron, 23 3 * * * GMT). `fn_izo_gps_curata()` șterge coordonatele GPS ale declarațiilor de pe tabletă la 60 de zile după decizie (Q-E4-15 B, Răzvan 24.10). Jurnalul `izo_gps_stergeri` nu păstrează coordonate. Fișa:
> - (a) conținut extern: nu;
> - (b) scrie doar DELETE pe GPS + jurnal;
> - (c) rulează ca postgres, apoi ca writer-ul DEFINER, fără service_role;
> - (d) o pornește doar pg_cron / postgres;
> - (e) confirmare umană: nu e nevoie, predicatul e fix.
>
> Migrarea `20261111a`; rollback-ul e refuzat după prima ștergere.

## Ordinea

1. DRY pe prod: prolog + migrare + porți + `control_0e`, apoi **revenirea armată în aceeași tranzacție**, apoi ROLLBACK.
2. „Da”-ul lui Răzvan.
3. Apply prin runner + verificare:
   - jobul există în `cron.job`, `active`;
   - porțile `{}`;
   - `fn_izo_gps_curata` nu e executabilă de authenticated.
4. Rândul din `automatizari` și registrul.
5. Merge.
