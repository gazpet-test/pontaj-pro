# Propunere v4.7 - Copilot acceptat dupa regula de titlu, nu dupa lista certificata

Status: PROPUNERE (masura B, aprobata ca idee de Razvan 03.11.2026). Nu e implementata.

**Problema.** Lista `cop.modele` sta in `run_paw.ps1`, al carui hash e legat in
`cdx_sandbox_validat.json`. Orice rotire Copilot = Install admin + Run/Seal cdx (v4.6.1),
desi Copilot nu are legatura cu sandbox-ul cdx. Rezervele din v4.6.1 doar amana problema.

**Propunere.**
1. Argumentul `model` ramane ID scurt `^[0-9a-f]{8}$` (litere mici); lock-ul `lock_cop_<id>` ramane.
2. Lista fixa iese din fisierul certificat. In fisierul certificat ramane doar REGULA (fixa):
   host exact `chatgpt.com`, cale `/g/g-2DQzU5UZl-*/c/<uuid>`, uuid care incepe cu ID-ul,
   `gizmo_id = g-2DQzU5UZl` (AI CODER), titlu `^Copilot - [A-Za-z0-9 ,._-]{2,60} - \d{2}\.\d{2}$`.
3. La rulare, dupa lock si INAINTE de orice text in compozitor, `cgpt_pw.py verifica`:
   exact UN tab cu acel uuid (azi: primul tab care contine sirul) si titlul + gizmo citite din
   backend (`GET /backend-api/conversation/<uuid>` in pagina, token nefolosit in afara ei),
   nu din `document.title`. Orice abatere = `PAW_EROARE cop_conversatie_refuzata`, fara trimitere.
4. Varianta respinsa: fisier de config separat cu lista (ACL admin) - tot cere admin la fiecare rotire.
5. Daca `run_paw.ps1` ramane legat de cdx, v4.7 este ultima recertificare pentru Copilot.
   (Separat, de decis: scoaterea canalelor cop/gem intr-un fisier nelegat de cdx.)

**Riscuri si raspuns.**
- Titlu falsificat de o pagina: o pagina terta isi poate schimba doar propriul `document.title`,
  nu titlul unei conversatii ChatGPT; de aceea se cere host exact + titlul din backend.
- Cine poate redenumi: doar cineva cu sesiunea ChatGPT logata (Razvan, sesiunile locale prin
  `cgpt_redenumeste.py`). Un proces local cu acces la CDP 9333 controleaza oricum Edge-ul:
  regula nu adauga o granita noua si nu o slabeste pe cea existenta (doar loopback, netstat).
- Titlu automat ChatGPT: nu are forma "Copilot - ... - ZZ.LL" -> refuz (comportament dorit).
- Se pierde revizuirea per conversatie: o conversatie redenumita corect intra fara review.
  Mitigare: gizmo fix + harta sesiune -> conversatie din `handoff_copilot`; jurnal cu titlul in paw_runs.log.
- Brief-ul (continut extern) nu poate redenumi conversatii: cgpt_pw.py nu executa text din brief.

**Ce se testeaza.**
- Harness (stub, fara browser): ID invalid/majuscule; zero sau doua taburi cu acelasi uuid;
  titlu gresit/lipsa; gizmo gresit; host gresit -> refuz fara trimitere; caz bun -> trimite.
- Live: conversatie noua redenumita -> PAW_GATA fara instalare; titlu automat -> refuz;
  `document.title` schimbat local (devtools) cu titlu backend gresit -> refuz.
- Review Jakarinos + Copilot + Gemini pe diff; apoi Install + Run/Seal cdx o singura data.
