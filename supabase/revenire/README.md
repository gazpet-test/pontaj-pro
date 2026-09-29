# supabase/revenire/ — artefacte de revenire, NU migrări

Fișierele de aici **nu sunt migrări** și **nu le parcurge niciun runner** (Supabase CLI/MCP citesc doar
`supabase/migrations/`; CI-ul referă doar fișiere anume de acolo). Sunt reveniri tehnice păstrate pentru
test și pentru o eventuală revenire excepțională.

Reguli:
- **Fără GO de execuție.** Un fișier de aici se rulează doar la cererea explicită a lui Răzvan, după o decizie
  și un review specifice (Copilot). Existența comutatorului de armare nu e autorizare.
- **Gestionarul tranzacției e operatorul**: fișierele nu conțin `BEGIN/COMMIT`; se trimit într-un singur string
  `BEGIN; SELECT set_config('<comutator>', '<valoare>:' || txid_current(), true); <fișier> COMMIT;`
  (valoarea exactă e scrisă în antetul fiecărui fișier). Armarea persistentă (`ALTER DATABASE/ROLE … SET`) e refuzată.
- Fiecare fișier pornește doar dintr-o stare exactă cunoscută și are postcondiție înainte de `COMMIT`.
