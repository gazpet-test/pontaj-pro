# Contul Claude „Redări” (redari@gazpet.ro) — pornire și reguli

Decizia lui Răzvan (06.11.2026): un abonament **Max separat**, pe redari@gazpet.ro, care se ocupă **doar de Redări teren**.
Contul principal (chat-ul de coordonare) împarte munca, face review, merge și deploy cu „da”-ul lui Răzvan.
Nu se folosește pentru alte module și nu se rotește cu contul principal ca să ocolească limitele de utilizare.

## Unde rulează
Pe serverul AI **Gazpet-Claude** (nu pe Raspberry): aici sunt psql + `scripts/livrare_migrare.sh`, lansatorul Paw
(`run_paw.cmd`), Edge CDP 9333 (Codex web, Copilot, Gemini), NAS-ul și Git Bash.
Cele două conturi stau în paralel pe același server, fiecare cu **folderul lui de configurare**.

## Pornire (o singură dată, Răzvan)
1. Clonă proprie: `git clone https://github.com/gazpet-test/pontaj-pro C:\Users\Gazpet-Ai\gazpet-erp-redari`
   (apoi `npm install` în ea).
2. Folder de configurare separat și login (PowerShell):
   ```powershell
   $env:CLAUDE_CONFIG_DIR = 'C:\Users\Gazpet-Ai\.claude-redari'
   cd C:\Users\Gazpet-Ai\gazpet-erp-redari
   claude          # apoi /login cu redari@gazpet.ro
   ```
   Fără `CLAUDE_CONFIG_DIR`, `claude` pornește cu contul principal — variabila trebuie setată la fiecare pornire
   (sau într-un `.cmd` de pornire „Claude Redari”).
3. Setări: copiază `C:\Users\Gazpet-Ai\.claude\settings.json` în `C:\Users\Gazpet-Ai\.claude-redari\settings.json`
   (aceleași permisiuni); setările din repo (`.claude/`) vin automat cu clona.
4. Conectori claude.ai — se autorizează din nou pe contul redari@ (claude.ai → Settings → Connectors):
   Supabase (proiectul `dxczwkbciseqniprspcu`), Google Drive, Desktop Commander, GitHub dacă e cerut.
   `gh` (GitHub CLI), pgpass-ul pentru psql și Edge 9333 sunt ale serverului și merg la fel.
5. Remote Control cu numele **„Redări — programare”**, ca să apară în aplicație și în `ListAgents`.

## Mesajul de start (primul mesaj în sesiune)
> Ești sesiunea „Redări — programare” pe contul redari@gazpet.ro. Faci DOAR Redări teren.
> Ritualul de start din CLAUDE.md, apoi rândul „Redări teren” din `claude_docs` `handoff_activ` și `docs/redari/`.
> Raportezi chat-ului principal prin `SendMessage` (numele din `ListAgents`) la predări și blocaje.
> Aplicări de migrări, deploy, secrete, date reale: anunți întâi „treci pe manual” și aștepți „da”-ul lui Răzvan.

## Reguli
- Ce e comun automat: repo (CLAUDE.md, skills, docs), `claude_docs` / `claude_context` (handoff, registru, lecții),
  `paw-data`. Memoria locală a contului (`.claude-redari\projects\…\memory`) NU e comună: ce trebuie să știe
  ambele conturi se scrie în `claude_context`.
- Rotație la ~900k context (CLAUDE.md pct. 8): handoff în `handoff_activ` (rândul Redări), apoi sesiune nouă.
- La limita abonamentului: se oprește, face handoff și anunță chat-ul; nu se trece munca automat pe contul principal.
- Codex web (mediul `pontaj-pro`), Jakarinos, Copilot și Gemini rămân aceiași; scripturile de lucru cu Codex web
  sunt descrise în handoff.
