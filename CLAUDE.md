# CLAUDE.md — PontajPRO / Gazpet ERP

ERP intern pentru Gazpet Instal SRL (Ploiești, construcții conducte gaz, 127+ angajați). Owner: Razvan Trusu (is_owner, employee id=121). Comunicare: română casual, scurt, direct.

## Stack & infrastructură
- React 18.2 + Vite 5 + react-router-dom 6.22 + Supabase + Vercel (auto-deploy ~3 min după push pe main)
- Supabase project ID: `dxczwkbciseqniprspcu` (MCP full access: execute_sql + apply_migration)
- Live: pontaj-pro-sooty.vercel.app · Vercel team: team_CGWstihP56yULGASWgVgVnjO
- Sentry: org gazpet-instal, project pontaj-pro
- Deps deja instalate (NU reinstala): jspdf@4.2.1, html2canvas@1.4.1, jszip@3.10.1, xlsx-js-style@1.2.0, supabase-js@2.39.0
- Fișiere mari: src/App.jsx (~7900 linii), Logistica.jsx (~11900), Magazie.jsx, CereriInterneProiect.jsx, Achizitii.jsx, Tichete.jsx, HR.jsx, ServiceTab.jsx etc.

## RITUAL DE START — obligatoriu la începutul sesiunii
-1. **ANUNȚĂ MODELUL**: în primul mesaj spune-i lui Razvan ce model rulezi (ex. claude-fable-5) și ce grad de gândire/reasoning e activ (cât e vizibil). Dacă modelul se schimbă mid-sesiune, menționează.
0. **SINCRONIZARE REPO (înainte de ORICE modificare de cod)**: `git fetch --all --prune` + `git pull --ff-only` pe branch-ul de lucru. Se lucrează de pe 2 laptopuri (birou + acasă) — localul poate fi în urmă; editarea fără pull suprascrie munca celuilalt (anti-bug „sesiuni paralele"). Dacă pull-ul nu e fast-forward → oprește-te și arată-i lui Razvan ce diverge.
Apoi, prin Supabase MCP, rulează:
```sql
SELECT content_md FROM public.claude_docs WHERE slug = 'handoff_activ';
SELECT category, title, content, priority, todo_section, todo_completed
FROM public.v_claude_context_smart
ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, category, created_at DESC;
SELECT slug, title, category FROM public.claude_docs WHERE active = true ORDER BY category, slug;
```
Integrează natural (nu anunța „am citit memoria"). Reia exact de unde a rămas handoff-ul. NU repeta întrebări la care există deja răspuns în memorie.

## Cum lucrezi
1. **Git**: ciclul complet obligatoriu = `git pull --ff-only` (vezi pasul 0 din ritual) → modifici pe branch + PR (NU push direct pe main) → la final **commit + push TOT** (nimic nelivrat local — altfel celălalt laptop nu vede munca). După merge, Vercel deployează automat (~3 min).
2. **Validare înainte de push**: `npm install` + build complet (`npx vite build`) — esbuild parse singur NU prinde ReferenceError la runtime. După orice search&replace pe nume de funcții: `grep -n` că noul nume există.
3. **BD — pattern preview→confirm→apply**: la orice modificare de date reale: (1) SELECT cu COUNT + breakdown, (2) confirmare explicită de la Razvan, (3) UPDATE/INSERT cu RETURNING + array_agg(id) pt rollback, (4) SELECT sanity check. DDL prin apply_migration (nume snake_case), DML prin execute_sql. NICIODATĂ DROP/DELETE ireversibil fără confirmare.
4. **Reguli Supabase la orice obiect NOU**: tabele → ENABLE RLS + GRANT authenticated/service_role + policies (folosește `auth.uid() IS NOT NULL`, nu `USING(true)`); views → `WITH (security_invoker = on)`; funcții → `SECURITY DEFINER SET search_path = public, pg_temp` + REVOKE EXECUTE FROM PUBLIC dacă nu-s UI-callable. După migrări importante: get_advisors.
5. **Stil cod existent**: inline styles pe obiecte JS (G = paleta, S = stiluri comune), stil compact, comentarii în română OK. NU introduce TypeScript / CSS modules / librării noi fără să întrebi.
6. **NU atinge fără cerere explicită**: SalariiPage (calcul taxe sensibil), RPC-uri server-side, schema BD, Logistica.jsx / HR.jsx / Administrativ.jsx / ServiceTab.jsx dacă task-ul nu le vizează direct.
7. **Registru automatizări**: după ORICE automatizare nouă (edge fn, cron, trigger, webhook) sau cheie/secret nou(ă) → actualizează în aceeași sesiune `claude_docs` slug `registru_automatizari` (fără valori de secrete — doar nume, unde stau, cine le folosește).
8. **Rutine (cron-uri Claude Code) la schimbarea sesiunii**: rutinele legate de o sesiune (`persistent_session_id`) se trezesc în sesiunea VECHE, cu context expirat → mesaje și erori acolo. Când se deschide o sesiune nouă de chat (cea veche s-a umplut): (1) `list_triggers` → notează rutinele cu `persistent_session_id` = sesiunea veche; (2) prompturile lor se mută în rutina zilnică a sesiunii NOI (una singură, self-bind, cu sarcini pe zile — nu câte o rutină per subiect); (3) se șterg cele vechi (`delete_trigger`; cele create din UI le șterge Razvan); (4) `list_triggers` de control + actualizare secțiunea „Rutine Claude" din `registru_automatizari`. Rutinele care pornesc sesiune nouă la fiecare rulare (fără session_id) NU se ating. Regula se aplică și la arhivarea sesiunilor vechi: întâi rutinele, apoi arhivarea.
9. **Ambiguu? Întreabă ÎNAINTE** să generezi mii de linii. Opțiuni A/B/C scurte — Razvan răspunde rapid. Când o decizie e proastă, spune-i direct.

## Anti-bug-uri critice (verificate în producție)
- `logistica_alimentari`: coloana e `active_id` (cu E), NU activ_id. Chei module: lowercase fără diacritice ('logistica').
- `employees.name` = "NUME_FAMILIE PRENUME" — primul cuvânt e numele de familie.
- `execute_sql` multi-statement returnează DOAR ultimul rezultat.
- `v_logistica_alerte_globale` are 3 CTE-uri — flag nou de exclude se adaugă în TOATE trei.
- pdf-lib incompatibil cu Vercel (Rollup rezolvă dynamic imports la build). html2canvas: colgroup în PROCENTE nu pixeli (A4 util = 738px); signed URLs → fetchAsDataURL (CORS); 2x requestAnimationFrame înainte de capture.
- Edge Functions: erori de BUSINESS se scriu în DB + return, NU throw (throw în try + update în catch = worker killed intermitent).
- La SELECT explicit în Edge/tools: verifică ÎNTÂI coloanele reale în information_schema (sofer_asignat nu există; e km_actuali, ore_functionare_actuale, site_id).
- Acces module DUAL: is_owner bypass tot; altfel e nevoie de intrare EXPLICITĂ per sub-modul în user_module_access — rolul NU e suficient.
- useCallback fără showToast în deps (loop infinit). Refs/handlers dintr-o componentă nu-s accesibile în alta din același fișier.
- După deploy: Ctrl+Shift+R obligatoriu la testare (cache-ul ascunde fix-urile).

## Decizii închise (NU redeschide)
PIUSI = doar reconciliere (nu dublu-decrement stoc). TVA pe valoare brută lucrări. Echipamente: service/QR/ITP → logistica_active; scule/EIP → Magazie-Echipamente. Financiar: fără drag&drop generic (doar certificate de plată). „TOTUL PDF": imaginile spre AI se convertesc client-side în PDF (imageToPdf în CitesteOricePanel.jsx). Comenzi Furnizor: tabel separat, auto-status prin triggere.

## Final de sesiune — obligatoriu
0. **Repo curat + pushat**: `git status` fără modificări locale — tot ce s-a lucrat e commis și PUSHAT (branch/PR, sau main după merge). Nimic rămas doar pe laptopul curent.
1. UPDATE `claude_docs` slug `handoff_activ` (secțiuni: ✅ LIVE / ⏳ Pending / ⚠️ Atenționări / 🎯 Următoarele candidate).
2. INSERT lecții durabile noi în `claude_context` (category: lesson/decision/anti_bug/todo).
3. Recap scurt: ce s-a pushat, ce PR-uri așteaptă merge, ce e de testat LIVE.
