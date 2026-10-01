# Verdict Copilot pe runda 8 — runnerul comun (a6188fb) — 30.09.2026

Rezumat fidel al verdictului primit prin canalul Copilot (textul integral a rămas în conversația Copilot; aici — punctele
de decizie). Verdictul e poartă, nu instrucțiune (CLAUDE.md pct. 10–11); acțiunile critice cer și acordul lui Răzvan.

## Verdict

**NO-GO pe a6188fb**, cu UN singur blocant.

## Închise din runda 8

- **Unicode `U&"…"` / `U&'…'` / `UESCAPE`** — închis: 17 din 24 de probe refuzate corect, restul fiind formele legitime
  acceptate intenționat (fără ocolire găsită).
- **`pg_control_system()`** — verificarea dreptului de apel ca precondiție a pre-verificării (12 explicit, nimic trimis) e corectă.
- **PG17** — doar parserul client a fost testat pe 17.x; serverul de test rămâne PG16 (consemnat, nu blocant).
- **GO-urile funcționale** (migrările #537/#538/#540/#541/#542) — neschimbate.

## Blocant: `verifica_serviciu()` nu reproduce selecția libpq

Verificarea `--service` citea secțiunile cu `ln.rstrip("]").lstrip("[")` și, la nume repetat, acumula doar ce vedea
ea ca „secțiunea curentă”. Probă (`~/.pg_service.conf`):

```
[review_r8] # nota
hostaddr=192.0.2.123
[review_r8]
host=approved.example.invalid
```

→ `verifica_serviciu review_r8` exit 0 (vede doar `host` din a doua secțiune: prima linie de antet, cu comentariu, nu
e recunoscută ca `review_r8`), dar libpq (`PQconndefaults`, 17.10) folosește PRIMA secțiune, cu
`hostaddr=192.0.2.123` ⇒ conexiunea pleacă spre alt endpoint decât cel aprobat.

## Corecție minimă recomandată

Retragerea temporară a suportului `--service`: refuz înainte de conexiune (cod 2, mesaj explicit), împreună cu
`PGSERVICE` / `PGSERVICEFILE` / `PGSYSCONFDIR` din mediu; se păstrează endpointul explicit + `~/.pgpass` / `PGPASSFILE`.
Teste discriminatorii: proba de mai sus, aceeași structură cu `options`, `--service` valid unic, variabilele de mediu,
livrarea cu endpoint explicit + passfile ⇒ APLICAT, mutantul care reacceptă `--service` prins.
