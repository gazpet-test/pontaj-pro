# Funcții edge retrase (etapa 2c, 14.10.2026)

Decizia lui Răzvan din 14.10.2026, scrisă direct în sesiunea Module: „da etapa 2c, B”. Funcțiile se șterg din producție cu workflow-ul `.github/workflows/sterge-edge-etapa2c.yml`, care are lista fixă și rulează doar manual.

Folderul NU e în `supabase/functions/`, deci nu e publicat, verificat sau testat de niciun workflow. E doar o copie, ca să se poată reveni.

## Cum se revine
Copiezi `supabase/functions_retrase/<slug>/index.ts` în `supabase/functions/<slug>/index.ts` și publici cu „Deploy edge function (manual)”. Dacă funcția avea `verify_jwt=false`, adaugi slug-ul și în lista `NO_JWT` din workflow-ul de deploy.

## Cele 4 funcții cu cod activ (copii textuale ale sursei deployate, citite cu get_edge_function pe 14.10)
| slug | versiune | verify_jwt | ce făcea |
|---|---|---|---|
| test_anthropic_key | v23 | false | diagnostic Anthropic cu web_search (cost AI, fără poartă) |
| spike-ocr-claude | v14 | false | spike OCR pagină scanată, Sonnet 5 (ultima folosire în ai_usage_log: 11.08.2026) |
| check-resend-domains | v21 | false | NU verifica domenii Resend: citea certificate de plată Transgaz cu Sonnet 5 (fără poartă) |
| openai-modele | v11 | true | listează modelele de pe OPENAI_API_KEY |

Niciuna nu are secrete scrise în cod: cheile se citesc din env.

## Cele 29 de stub-uri (răspundeau doar 410)
temp-creare-user, temp-reset-parola, temp-upload-taloane, tmp-copy-paza (vj=false), tmp-db-ins, tmp-dc-up (vj=false), tmp-dl, tmp-export-inventar, tmp-flota-up, tmp-mai-probe, tmp-ofertare-up, tmp-ofertare-up2, tmp-ofertare-up3, tmp-runner-plansa, tmp-sign-expert, tmp-up3, tmp-upload-taloane-2, db-probe, full-probe, update-probe, throw-probe, img-probe, pdf-probe, claude-probe, openai-probe (vj=false), test-mail-senders, audi-connect, capture-storage-rls-errors, ofertare-seap-diag.

Pentru revenire se folosește `_stub_410/index.ts`.

## Verificarea dinainte de ștergere (14.10, doar citire)
- 0 apelanți în: repo (fără docs), cron.job, funcțiile din BD, sursele celor 37 de edge deployate fără repo, serverul AI, Terra, laptop. Excepție: `ofertare-seap-diag` apare doar ca nume în metadatele unui pachet Codex vechi de pe laptop.
- 0 apeluri în jurnalele edge din ultimele 48h (cât se poate citi).
