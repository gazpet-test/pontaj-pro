# Runbook — normative-scan-lunar v9 (rotire secret + deploy)

Nimic din pașii de mai jos nu a fost aplicat. Îi execută Răzvan, în ordine. Valoarea secretului nu trece prin chat.

## 1. Generează valoarea nouă (local, pe laptop)
```bash
openssl rand -base64 36 | tr -d '\n/+=' | cut -c1-40   # copiezi direct în clipboard, nu în chat
```

## 2. Pune-o ca secret pentru funcție
Dashboard → Edge Functions → Secrets → `NORM_SCAN_SECRET` = valoarea. Sau:
```bash
# fișier temporar, ca valoarea să nu rămână în istoricul shell-ului:
supabase secrets set --env-file ./norm.env --project-ref dxczwkbciseqniprspcu   # norm.env: NORM_SCAN_SECRET=...
rm ./norm.env
```

## 3. Pune aceeași valoare în Vault (SQL Editor, rulat de Răzvan)
```sql
SELECT vault.create_secret('<LIPEȘTE_VALOAREA>', 'norm_scan_secret', 'x-norm-secret pentru cron normative_scan_lunar');
-- verificare fără să afișezi valoarea:
SELECT name, length(decrypted_secret) FROM vault.decrypted_secrets WHERE name = 'norm_scan_secret';
```
(Rulează-l din SQL Editor, nu prin MCP/chat.)

## 4. Deploy funcția (după merge-ul PR-ului)
```bash
supabase functions deploy normative-scan-lunar --project-ref dxczwkbciseqniprspcu --no-verify-jwt
```
`verify_jwt` rămâne false intenționat: cronul nu trimite JWT; poarta e `x-norm-secret` (comparat în timp constant, fără fallback). Din momentul deploy-ului, parola veche NU mai merge → cronul eșuează până la pasul 5 (rulează doar pe 1 ale lunii, la 05:00 UTC; fă 4+5 în aceeași zi).

## 5. Cron — preview `cron.alter_job` (NEAPLICAT)
```sql
-- preview: job-ul curent
SELECT jobid, jobname, schedule FROM cron.job WHERE jobname = 'normative_scan_lunar';  -- jobid 39, '0 5 1 * *'

SELECT cron.alter_job(
  job_id  := (SELECT jobid FROM cron.job WHERE jobname = 'normative_scan_lunar'),
  command := $cmd$
    SELECT net.http_post(
      url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/normative-scan-lunar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-norm-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'norm_scan_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cmd$
);

-- sanity: comanda NU mai conține parola literală
SELECT jobid, command ILIKE '%decrypted_secrets%' AS din_vault, command ~ 'gz-norm' AS parola_veche_in_text
FROM cron.job WHERE jobname = 'normative_scan_lunar';   -- așteptat: true / false
```

## 6. Test manual
```sql
-- (a) cu secretul din Vault, mod test (nu scrie în bibliotecă, mail cu [TEST]):
SELECT net.http_post(
  url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/normative-scan-lunar?test=1',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-norm-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'norm_scan_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 30000);
-- după câteva secunde:
SELECT status_code, content FROM net._http_response ORDER BY id DESC LIMIT 1;   -- 200 {"pornit":true,"test":true}
```
(b) negativ: `curl -s -X POST https://dxczwkbciseqniprspcu.supabase.co/functions/v1/normative-scan-lunar -H 'x-norm-secret: gresit'` → 401.
(c) parola veche → trebuie 401.
(d) mailul [TEST] vine în câteva minute: secțiunea „Schimbări noi” prima, separat de „Forma cunoscută incompletă”; în antet numărul de căutări și costul.

## 7. Retragerea vechii parole
- Codul nou nu o mai conține (verificat: `grep -rn gz-norm supabase/` gol).
- Cron: după pasul 5 nu mai e în `cron.job.command`.
- Versiunile vechi ale funcției (≤ v8) o conțin în sursă — devin inactive la deploy; nu le mai folosește nimeni.
- Istoric: verifică `cron.job_run_details` / logurile; dacă vrei, șterge rândurile vechi care o conțin în `command`:
  `SELECT count(*) FROM cron.job_run_details WHERE command ~ 'gz-norm';` (preview → confirmare → DELETE).
- Parola veche a stat în text clar: considerați-o compromisă; ea nu mai deschide nimic după pasul 4.
