# Validare locală v4.4 — 2026-10-18

- cdx: 8 teste trecute, 1 SKIPPED (izolare OS), fără Codex real.
- Verificate: slug/cale, refuz fără certificat, bază main/worktree/commit/diff,
  timeout și copil terminat, lock ocupat, țintă existentă, fetch eșuat.
- Parser PowerShell pentru installer: fără erori de sintaxă.
- Installerul și rollback-ul nu au fost executate pe instalarea reală.
- Cerința de izolare a unui stub ostil NU este îndeplinită/certificată.
  Job Object nu blochează scrieri. Modul cdx rămâne închis fără validare independentă.
- Nicio instalare, inferență, operație DB, publicare sau push.
- Regresii canale moștenite: 33/33 teste trecute (stub-uri, 53,140 s).
