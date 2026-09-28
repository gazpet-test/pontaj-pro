# JAK-V2-01 — confirmare statică pe BD live (28.09.2026, SELECT-only)

**Afirmația (Jakarinos, a doua opinie S09):** pe `ofertare_pt_pachet`, cele două politici UPDATE PERMISSIVE se combină cu OR ⇒ `aprobat → propus` (și `propus → depus`) permise oricărui user cu modul.

## pg_policies live (`tablename='ofertare_pt_pachet'`)
| policy | cmd | USING | WITH CHECK |
|---|---|---|---|
| ofertare_pt_pachet_insert | INSERT | — | `fn_are_acces_ofertare() AND stare='propus' AND aprobat_de IS NULL AND aprobat_la IS NULL` |
| ofertare_pt_pachet_select | SELECT | `auth.uid() IS NOT NULL` | — |
| ofertare_pt_pachet_update | UPDATE (PERMISSIVE) | `fn_are_acces_ofertare() AND stare='propus'` | `fn_are_acces_ofertare() AND (stare='propus' OR (stare='aprobat' AND aprobat_de=auth.uid()))` |
| ofertare_pt_pachet_depune | UPDATE (PERMISSIVE) | `fn_are_acces_ofertare() AND stare='aprobat'` | `fn_are_acces_ofertare() AND stare='depus'` |

Semantica Postgres: pentru UPDATE, rândul vechi trebuie să treacă **oricare** USING permisiv; rândul nou trebuie să treacă **oricare** WITH CHECK permisiv — cele două verificări sunt independente. Deci:
- `aprobat → propus`: USING satisfăcut de `_depune` (vechi = aprobat), CHECK satisfăcut de `_update` (nou = propus) ⇒ **permis**.
- `propus → depus`: USING din `_update`, CHECK din `_depune` ⇒ **permis** (sare peste aprobare).
- `aprobat → aprobat` cu alt `aprobat_de` ≠ auth.uid(): CHECK `_update` cere aprobat_de=auth.uid(); `_depune` cere depus ⇒ refuzat (bine). Dar `aprobat → propus → aprobat(eu)` în doi pași e permis.

## Triggere live pe `ofertare_pt_pachet`
- `trg_ofertare_pt_pachet_poarta_documentatie` (BEFORE INSERT OR UPDATE OF stare): verifică completitudinea SEAP + r5 **doar când NEW.stare devine 'aprobat' sau 'depus'**; nu se pronunță la `→ propus`.
- `trg_pt_pachet_depus_verifica` (BEFORE UPDATE OF stare): doar la `→ depus`: cere rânduri `depus_final` + `dovada_seap`; setează `depus_la`. Nu verifică `OLD.stare='aprobat'`.
- Niciun trigger nu impune o matrice de tranziții OLD→NEW.

## Efectul asupra înghețării din Storage (R12)
`fn_ofertare_obiect_in_pachet_inghetat(p_name)` = `EXISTS (… f.fisier_path=p_name AND p.stare IN ('aprobat','depus'))`. După retrogradarea la `propus`, obiectele manifestului nu mai sunt înghețate ⇒ `ofertare_storage_upd/del` permit înlocuirea/ștergerea. Apoi `propus → aprobat` (aprobat_de = eu) trece prin `_update`; triggerul de aprobare re-verifică doar documentație + r5.

## Verigi conexe (din inventarul S09)
S09-05 (server nu verifică obiectul/sha la depus), S09-14 (câmpurile de proveniență rescriibile în același UPDATE), S09-24 („R11/R12 țin" — MATCH-ul acoperă doar tranzițiile directe, nu combinația OR).

## Grants
`authenticated`: INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE (fără DELETE); `anon`: DML complet (RLS fără politici anon ⇒ refuzat azi; TRUNCATE nu e supus RLS — S09-21).

## Dovada dinamică
Planificată în P3 pe clona 103 (test „fișier final modificat după aprobare"): pachet propus → aprobat (după satisfacerea porții de documentație + r5 în P2) → PATCH `stare='propus'` cu JWT-ul contului de test → înlocuire obiect → reaprobare. Nu s-a executat nimic pe producție. **Fix propus (neaplicat):** o singură politică UPDATE cu matricea de tranziții + trigger BEFORE UPDATE care refuză orice `OLD.stare→NEW.stare` din afara matricei, independent de RLS; test pg real cu rol `authenticated`.
