# Funcții edge retrase (etapa 2c, 14.10.2026)

Decizia lui Răzvan din 14.10.2026, scrisă direct în sesiunea Module: „da etapa 2c, B”.
Funcțiile au fost șterse din producție pe 14.10.2026 cu workflow-ul `sterge-edge-etapa2c.yml` (#701): dry-run în rularea 38574283758, ștergerea în rularea 38576053791 (33 șterse, rămân 115 funcții). Workflow-ul a fost apoi scos din repo.

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

## Securitate etapa 2, grup A (14.10.2026): `revenire_grupa/`
Două funcții acceptau antetul `X-Internal-MCP-Bypass` comparat cu un literal de 40 de caractere scris în cod (`verify_jwt=false`), care ocolea orice verificare.
| slug | versiune copiată | ce s-a făcut | copie de revenire |
|---|---|---|---|
| detect_plate_orphan_msgs | v24 | antetul scos; poarta în `supabase/functions/detect_plate_orphan_msgs/acces.ts` | `revenire_grupa/detect_plate_orphan_msgs.v24.ts` |
| extract_external_bon | v24 | retrasă (niciun consumator): stub 410 în `supabase/functions/extract_external_bon/` | `revenire_grupa/extract_external_bon.v24.ts` |

Literalul NU e în repo: în ambele copii constanta e `crypto.randomUUID()` cu marcajul `<REDACTAT len 40>`, deci o copie republicată nu mai are o ocolire care să se potrivească. Restul codului e textual cel deployat (fără spațiile de la capăt de rând).
Revenire: copiezi fișierul în `supabase/functions/<slug>/index.ts`, păstrezi slug-ul în `NO_JWT` (pentru `extract_external_bon` îl adaugi) și publici cu „Deploy edge function (manual)”.

## Securitate etapa 2, grup B (14.10.2026): `revenire_grupb/`
Două funcții acceptau antetul intern `x-internal-secret` comparat cu același literal de 24 de caractere scris în cod.
| slug | versiune copiată | verify_jwt | ce s-a făcut | copie de revenire |
|---|---|---|---|---|
| extract-talon-ai | v16 | true | antetul scos; poarta în `supabase/functions/extract-talon-ai/acces.ts` (owner SAU admin_logistica cu modulul logistica); rămâne cu verify_jwt=true | `revenire_grupb/extract-talon-ai.v16.ts` |
| rag-normative | v22 | false | retrasă (niciun consumator): stub 410 în `supabase/functions/rag-normative/`, publicat cu verify_jwt=true | `revenire_grupb/rag-normative.v22.ts` |

Literalul NU e în repo: în ambele copii constanta e `crypto.randomUUID()` cu marcajul `<REDACTAT len 24>`. Restul codului e byte cu byte cel deployat (verificat programatic pe 14.10).
Revenire: copiezi fișierul în `supabase/functions/<slug>/index.ts` (pentru `extract-talon-ai` ștergi și `acces.ts` / `handler.ts` / testele, iar pentru `rag-normative` adaugi slug-ul în `NO_JWT`), scoți pasul de gardă „extract-talon-ai și rag-normative fără secret intern” din `verifica-edge-functions.yml` și publici cu „Deploy edge function (manual)”.

## Verificarea dinainte de ștergere (14.10, doar citire)
- 0 apelanți în: repo (fără docs), cron.job, funcțiile din BD, sursele celor 37 de edge deployate fără repo, serverul AI, Terra, laptop. Excepție: `ofertare-seap-diag` apare doar ca nume în metadatele unui pachet Codex vechi de pe laptop.
- 0 apeluri în jurnalele edge din ultimele 48h (cât se poate citi).
