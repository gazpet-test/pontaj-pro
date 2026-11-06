# Propunere v4.7 - Copilot acceptat dupa regula de titlu, nu dupa lista certificata

Status: PROPUNERE (masura B, aprobata ca idee de Razvan 03.11.2026). Nu e implementata.

**Problema.** Lista `cop.modele` sta in `run_paw.ps1`, al carui hash e legat in
`cdx_sandbox_validat.json`. Orice rotire Copilot = Install admin + Run/Seal cdx (v4.6.1),
desi Copilot nu are legatura cu sandbox-ul cdx. Rezervele din v4.6.1 doar amana problema.

**Propunere.**
1. Argumentul `model` ramane ID scurt `^[0-9a-f]{8}$` (litere mici); lock-ul `lock_cop_<id>` ramane.
2. Lista fixa iese din fisierul certificat; ramane doar REGULA (fixa): host exact `chatgpt.com`,
   cale `/g/g-2DQzU5UZl-*/c/<uuid>`, `gizmo_id = g-2DQzU5UZl` (AI CODER),
   titlu `^Copilot - [A-Za-z0-9 ,._-]{2,60} - \d{2}\.\d{2}$`.
3. Dupa lock si INAINTE de orice text in compozitor, `cgpt_pw.py verifica`: dintre taburi,
   prefixul trebuie sa rezolve EXACT UN uuid complet (zero, doua uuid-uri diferite cu acelasi
   prefix sau doua taburi = refuz); titlul + gizmo se citesc din backend
   (`GET /backend-api/conversation/<uuid>` in pagina; tokenul nu iese din ea), nu din `document.title`.
4. Trimiterea foloseste ACELASI obiect pagina verificat; imediat inainte de inserarea textului si
   inainte de Enter se reverifica destinatia INTREAGA (schema https, host exact chatgpt.com, cale GPT
   /g/g-2DQzU5UZl-*/c/, acelasi uuid complet). Abatere = `PAW_EROARE cop_conversatie_refuzata`,
   fara trimitere. Uuid-ul complet + titlul intra in paw_runs.log.
5. Varianta respinsa: fisier de config separat cu lista (ACL admin) - tot cere admin la fiecare rotire.
   v4.7 = ultima recertificare pentru Copilot (de decis separat: cop/gem intr-un fisier nelegat de cdx).

**Riscuri.**
- Se pierde autorizarea administrativa per conversatie: backend-ul confirma metadatele (titlu,
  GPT), NU aprobarea operatorului. Orice proces sau agent local cu acces la CDP 9333 (inclusiv o
  sesiune Claude pacalita de continut extern) poate redenumi o conversatie si o face acceptata.
  Mitigare: redenumire doar la cererea lui Razvan; harta sesiune -> conversatie in
  `handoff_copilot`; jurnalul de mai sus revizuit la rotiri. Acceptat doar daca Razvan decide asta.
- O pagina terta nu poate schimba titlul unei conversatii ChatGPT, doar propriul `document.title`;
  de aceea host exact + titlu din backend. CDP ramane doar loopback (netstat). Titlu automat -> refuz.

**Ce se testeaza.**
- Harness (stub, fara browser): ID invalid/majuscule; zero taburi; doua taburi cu acelasi uuid;
  doua uuid-uri cu acelasi prefix; titlu/gizmo/host gresit; pagina navigata intre verificare si
  trimitere (alt uuid, sau alt host/schema cu acelasi uuid in URL) -> refuz fara text; caz bun -> trimite.
- Live: conversatie noua redenumita -> PAW_GATA fara instalare; titlu automat -> refuz;
  `document.title` schimbat local (devtools) cu titlu backend gresit -> refuz.
- Review Jakarinos + Copilot + Gemini pe diff; apoi Install + Run/Seal cdx o singura data.
