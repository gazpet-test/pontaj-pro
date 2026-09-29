# supabase/revenire/

Artefacte de **revenire** (rollback tehnic, oprire controlată). **Nu sunt migrări**: niciun runner nu parcurge directorul ăsta (`supabase db push`, `apply_migration` și harness-urile citesc doar `supabase/migrations/`).

- Fiecare fișier are antetul lui: ce redeschide, cine îl poate cere, cum se armează.
- Rollback-urile tehnice redeschid o gaură de securitate. Se rulează doar la cererea explicită a lui Răzvan, după decizie și review specifice (Copilot). Existența fișierului sau a comutatorului de armare nu e autorizare.
- Gestionarul tranzacției e operatorul. Fișierele nu conțin `BEGIN`/`COMMIT` și se trimit într-un singur string: `BEGIN;` + armarea legată de `txid_current()` + fișierul + `COMMIT;`.
- Directorul poate apărea și pe alte branch-uri, cu alte fișiere. La merge se păstrează toate fișierele, iar README-ul se unește.
