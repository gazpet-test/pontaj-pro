R5: src/redari/poartaUtilizatoriSql.test.js:6 normalizează CR înainte de citire/extragere/hash/comparare; cele 5 funcții sunt testate cu LF și CRLF, plus blocurile migrare/DRY cu finaluri diferite.
Auditul testelor modificate în PR nu a găsit alt hash calculat din SQL; npx vitest run: 3.945 trecute, 22 sărite; npx vite build și git diff --check verzi. SQL și .gitattributes nemodificate.
L15/L25: amprentele canonice și comparația blocurilor sunt verificate explicit în ambele formate; celelalte reguli L01–L14 și L16–L24 n/a pentru această rundă. Același branch/PR, fără merge.
