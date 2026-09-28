# Registru sarcini delegate — Claude (coordonator) · Codex/Jakarinos · Miloi (Gemini) · Copilot (dirijor)

Scop: reluare fără dependență de istoricul unui chat. Fiecare sarcină delegată are o linie aici; se actualizează la fiecare checkpoint.
Reguli: (1) sarcină delimitată: obiectiv, context, fișiere permise, restricții, criterii de acceptare; (2) implementări paralele doar pe branch separat, fără fișiere comune; (3) Claude verifică înainte de integrare; (4) la timeout NU se relansează până nu se verifică `git status` + ieșirea parțială; (5) consum notat pe fiecare rulare.

## Executanți
| Executant | Cum se apelează | Mod | Note |
|---|---|---|---|
| Jakarinos (Codex, gpt-6-astra high) | `C:\Users\Public\run_jak.cmd <spec> <log>` pe PC birou; `codex exec --sandbox workspace-write` | scrie cod | NU rulează git (Claude comite ca „Jakarinos-Codex”); JAK_GATA la final de log |
| Miloi (Gemini — agy 1.2.12, gemini-3.1-pro-high) | `C:\Users\offic\AppData\Local\agy\bin\agy.exe --model gemini-3.1-pro-high --mode plan --print-timeout <N>s --add-dir <repo> -p <prompt> --output-format json` | `plan` = analiză; `accept-edits` = editare (de validat înainte de prima folosire) | JSON: status/response/conversation_id/usage; reluare cu `--conversation <id>`; NU `--dangerously-skip-permissions` |
| Copilot (ChatGPT) | `node C:\Users\Public\cgpt.mjs send <fișier> <sec>` / `read n` | dirijor | primește rapoarte, decizii împreună |

## Sarcini
| ID | Executant | Branch | Obiectiv | Stare | Checkpoint / rezultat | Consum |
|---|---|---|---|---|---|---|
| JAK-V2-01 | Claude | claude/fix-jakv201-pachet-tranzitie | matrice tranziții pachet | PR #515 draft, CI verde | test pg-real verde local | — |
| JAK-V2-07 | Jakarinos | claude/fix-jakv207-rls-scriere | RLS scriere ofertare_* + DELETE licitație owner-only | cod pushat 3596296, NETESTAT | bug trigger service_role de corectat (Claude); apoi test pg + PR | — |
| GEM-000 | Miloi | — | test conexiune (plan) | OK 28.09 | „Gemini este conectat la Maestru.” 6 s | 13.6k tok |
| GEM-001 | Miloi | (citire) claude/fix-jakv207-rls-scriere | analiză independentă trigger fn_ofertare_licitatii_scriere vs service_role | GATA 28.09, verificat de Claude | CONFIRMĂ bug-ul (l.37-47 migrare; testul acoperă doar postgres, l.247-249/285). Fix propus `current_user='service_role'`; Claude adoptă varianta mai robustă `auth.uid() IS NULL OR rolbypassrls/rolsuper pe current_user`. git status curat = fără modificări | 26.2k tok, 39 s, conv 91734c1a |
