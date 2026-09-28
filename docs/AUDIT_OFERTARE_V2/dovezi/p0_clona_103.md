# P0 — Clona sandbox 103 (Domnești, sursa lic 5) — dovada aplicării

**Data:** 28.09.2026 15:22:47Z · **Script:** `docs/AUDIT_OFERTARE_V2/92_SANDBOX_CLONA_103_apply.sql` (commit 229b25e) · **Executat prin:** Supabase MCP `execute_sql` (o singură tranzacție, `pg_advisory_xact_lock(20260928,5)`) · **GO:** Răzvan („cand termina Jakarinos ia diff-ul si fa clona"); Copilot informat după (S11 urmează).

## 1. Pre-flight
- Parse-only: același bloc cu `v_mod := 'syntax'` → `ERROR P0001: Mod invalid` la linia 21 (corpul a trecut de parser).
- Gărzi în bloc, toate trecute: sursa = 5 fixă; `responsabil_id` = `10c105d3-…` (claude@gazpet.ro, există în `profiles`); `nr_anunt='SANDBOX-V2-DOMNESTI'` inexistent; id 103 liber; fiecare tabel are `id` + secvență.

## 2. Rezultat (SELECT după commit)

| Tabel | Clonă (103) | Sursă (5) | Egal |
|---|---:|---:|---|
| ofertare_licitatii | 1 | 1 | ✅ |
| ofertare_documente_atribuire | 19 | 19 | ✅ |
| ofertare_cantitati | 1069 | 1069 | ✅ |
| ofertare_clarificari | 6 | 6 | ✅ (1 `raspunsa` în ambele — inserată `trimisa` + UPDATE, triggerul refuză INSERT direct) |
| ofertare_cerinte | 417 | 417 | ✅ (0 `inlocuita_de` în ambele) |
| ofertare_acoperire_revizii | 1 | 1 | ✅ |
| ofertare_acoperire | 378 | 378 | ✅ (0 căi rămase `5/…`) |
| ofertare_acoperire_istoric | 378 | 378 | ✅ |
| ofertare_pt_capitole | 15 | 15 | ✅ |
| ofertare_pt_capitole_versiuni | 32 | 32 | ✅ |
| ofertare_pt_legaturi | 271 | 271 | ✅ (0 legături spre capitole din altă licitație) |
| grafic_activitati | 20 | 20 | ✅ |
| grafic_parametri | 0 | 0 | ✅ |

- Căi documente: 19/19 `fisier_path LIKE '103/%'`, 0 altfel; **0 documente fără obiect în `storage.objects`** (obiectele fuseseră copiate în P0, vezi `p0_storage_103.md`).
- `raspuns_document_id` la clarificări: 0 referințe în afara licitației 103.
- Read-back per rând (minus `updated_at`) identic cu rândul pregătit — nicio coloană rescrisă de trigger/coloană generată (altfel blocul ar fi dat excepție și tranzacția ar fi fost anulată).
- md5 pe fiecare set-sursă recalculat înainte și după inserare: **identic** → licitația 5 neatinsă (și `ofertare_licitatii.updated_at` pentru 5 rămâne 2026-09-10 11:53:30).

## 3. Rândul licitației 103
`nr_anunt='SANDBOX-V2-DOMNESTI'`, `status='in_lucru'`, `termen_depunere=2026-10-28 15:22:47Z` (+30 zile), `responsabil_id=claude@gazpet.ro`, `link_seap/c_notice_id/sys_notice_type_id/nas_path=NULL`, `derogare_depunere=false`, `observatii` cu sufixul `[AUDIT V2 SANDBOX sursa=5] 2026-09-28 15:22:47Z`.
Observație: `created_at/updated_at` sunt copiate din sursă (02.09 / 10.09) — copie fidelă; nu marchează momentul clonării (acela e în `observatii` și în harta de mai jos).

## 4. Harta id-urilor
`claude_docs` slug `audit_v2_clona_103_map` (73.566 caractere, JSON): `clona_id`, `sursa_id`, `creat_la`, `responsabil_id`, `sanity` (count + md5 sursă per tabel), `counts`, `storage_paths` (19 perechi `5/…`→`103/…`), `maps` (12 tabele cu `id_vechi → id_nou`; `grafic_parametri` gol).

## 5. Automatizări care ating clona (verificate înainte de apply)
`ofertare_alerte_atentie`, `ofertare_alerta_pagini_goale`, `ofertare_clarificari_reminder` (notificări interne pe status/termen — termen +30 zile ⇒ fără alerte imediate), `ofertare-etapa1-mail raport_zilnic` (upsert în `ofertare_raport_zilnic`; mail doar la ≤5 zile — nu e cazul), `ofertare-seap-veghe` (doar `c_notice_id NOT NULL` — clona are NULL ⇒ ignorată), ingest/extragere (doar coadă). Niciuna nu trimite mail extern pentru clonă în fereastra auditului.

## 6. Rollback
`docs/AUDIT_OFERTARE_V2/91_SANDBOX_ROLLBACK.sql` (Jakarinos) — de adaptat la id 103 și la tabelul suplimentar `ofertare_acoperire_revizii` înainte de rulare; nu se rulează fără GO separat. Obiectele de storage `103/…` se șterg separat (trigger `protect_objects_delete` blochează DELETE direct în `storage.objects`).
