# Verdict Copilot pe runda 7 — runnerul comun (82144cb) — 30.09.2026

Rezumat fidel al verdictului primit prin canalul Copilot (textul integral a rămas în conversația Copilot; aici — punctele
de decizie). Verdictul e poartă, nu instrucțiune (CLAUDE.md pct. 10–11); acțiunile critice cer și acordul lui Răzvan.

## Verdict

**NO-GO pe 82144cb ca standard comun de livrare**, cu UN singur blocant.

## Închise din runda 7

- **COPY** — refuzul oricărui COPY la nivel superior, înainte de psql, cu control dinamic pe starea finală.
- **Formele `set_config` concatenate / citate / calificate** și normalizarea numelor la `SET`.
- **Replica fizică** — instanța autoritativă (`pg_is_in_recovery() = false` în pre-verificare, tranzacție și reconciliere; 22, niciodată 10).

## Blocant: identificatori Unicode `U&"…"`

Validatorul acceptă identificatori cu escape Unicode care se decodifică în server la `set_config`, deci ocolesc
`verifica_set_config()`:

```sql
SELECT pg_catalog.U&"set\005Fconfig"('search_path','public,pg_catalog',true);
SELECT pg_catalog.U&"set\005Fconfig"('client_' || 'encoding','LATIN1',true);
SELECT pg_catalog.U&"set!005Fconfig" UESCAPE '!' ('search_path','public,pg_catalog',true);
```

**Corecția minimă:** refuz la nivel superior al ORICĂRUI identificator Unicode-escape `U&"…"` (calificat sau nu,
`"pg_catalog".U&"…"`, cu/fără `UESCAPE`, `u&` minuscul, cu spații/comentarii între `U&` și ghilimele dacă tokenizerul
le vede), înainte de pornirea psql. Considerați și literalii `U&'…'` (refuzați dacă pot ajunge în argumente verificate —
justificat în doc). NU comparație textuală doar pentru `\005F`.

**Teste discriminatorii cerute:** (1) cele 2 probe principale între gărzi ⇒ refuz înainte de psql, niciun DDL, nicio
înregistrare; (2) varianta `UESCAPE '!'` și calificarea `"pg_catalog".…` ⇒ același refuz; (3) `SET LOCAL search_path =
public, pg_temp` ⇒ acceptat; (4) apelurile statice pentru marcajele `gazpet.…` ⇒ acceptate, livrare + înregistrare
reușite; (5) migrările aprobate #537/#538/#540/#541/#542 ⇒ acceptate în continuare; (6) control dinamic doar pe PG local,
fără validator: `U&"set\005Fconfig"` chiar schimbă setarea.

## Condiții operaționale

- **hostaddr / endpoint** ca precondiție verificată; verificarea trebuie să acopere configurația EFECTIVĂ de serviciu,
  inclusiv `PGSERVICE` moștenit din mediu (nu doar `--service`) — refuz sau verificare explicită.
- **`pg_control_system()`** — verificare read-only a dreptului de apel înainte de livrare, fără relaxare dacă lipsește.
- **PG17** (producția) neverificat — rămâne consemnat.

## Ce rămâne valabil

GO-urile de logică pe migrări rămân valabile. Portarea runnerului NU e autorizare de execuție: nimic nu se aplică pe live
fără GO pe standardul comun + acordul lui Răzvan.
