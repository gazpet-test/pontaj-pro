# Paw v4.6.4 - doar paza atasamentelor Gemini - procedura pentru Razvan

Numai operatorul executa pasii. Agentul nu a instalat nimic si nu a cerut elevare.
A = PowerShell 5.1 admin Gazpet-Ai; N = acelasi cont NE-elevat. Orice eroare = STOP.

**De ce:** testul de canal v4.6.3 (19.11.2026) a picat la atasament: cu un fisier in ciorna,
`stare` arata `atasamente in ciorna: 5`, iar `trimite` NU a refuzat - a deschis un chat nou
(care goleste ciorna) si abia apoi a verificat atasamentele, deci a trimis brief-ul.

**Ce se schimba:** numai `gemini_pw.py` si linia lui din `SHA256.json`.
- `trimite` verifica ciorna tab-ului curent INAINTE de orice actiune (chat nou, click,
  tastatura). Cu atasament: `GEM_EROARE ciorna_cu_atasamente inainte_de_chat_nou: ...`, exit 3,
  chatul ramane neatins. Aceeasi verificare pe chatul nou (inainte de click) si chiar inainte de Enter.
- Numararea: un fisier = un chip `uploader-file-preview` in zona de compunere (nu imaginile din
  raspunsuri). Orice alt semn de atasament fara chip = tot refuz. Zona de compunere negasita =
  `GEM_EROARE ciorna_necitibila` (nu stie ce e in ciorna, deci nu trimite).
- **r2 (dupa review):** "zero chip-uri si zero semne" NU mai inseamna ciorna goala. Ciorna goala
  se verifica POZITIV: tot ce e in zona de compunere, in afara textului din editor, trebuie sa fie
  recunoscut (elemente neutre, structura zonei, butonul modelului, plus listele albe completate la
  pasul 0 din pagina reala). Orice altceva - un card de fisier cu alt nume, o imagine, un buton
  "Remove", un text de tip `a.txt` - = `GEM_EROARE ciorna_necunoscuta ...`, exit 3, nimic trimis.
  Un refuz fals e preferat unei trimiteri false: atunci se goleste ciorna de mana sau se reface pasul 0.
- `stare` mai scrie: `zone compunere ... | semne atasament ... | detalii ...`,
  `necunoscute in zona: N` urmat de cate o linie `  necunoscut <semnatura>`, si
  `paza ciorna: OK` / `paza ciorna: REFUZ <cod> ...`.
- Celelalte 11 fisiere sunt copii octet cu octet ale celor instalate acum in `bin` (v4.6.3).

**De ce NU e nevoie de Install / WFP / Run / Seal:** `run_paw.ps1` nu se schimba, iar legatura din
`cdx_sandbox_validat.json` (functia `GetCdxBinding`) nu contine `gemini_pw.py` si nici
`SHA256.json`. Certificatul cdx ramane valabil; jak / cop / cdx nu sunt atinse.
**Ce se reface:** testul de canal Gemini (markerul `paw-data\gem_canal_validat` nu exista pentru
v4.6.3; cel nou se leaga de hash-ul v4.6.4).
**Ramane neschimbat in lansator:** canalul se cheama tot `gem ... argon` / `argon:<lucrare>`.

Hash-urile vin din raportul de review, nu din acest fisier. Livrare: folderul din commit-ul
aprobat ajunge in `$Source` (`git archive` al commit-ului, dezarhivat in
`C:\Users\Public\livrare\run_paw_v464`); verificarea de mai jos decide.

## 0. Calibrare pe pagina reala (N, DOAR citire, INAINTE de review-ul final si de instalare)

Listele albe din `gemini_pw.py` (`CONTROALE_CUNOSCUTE`, `STRUCTURA_CUNOSCUTA`, `TEXTE_CUNOSCUTE`)
sunt livrate GOALE: structura reala a ciornei Gemini (butoanele trimite / microfon / incarcare etc.)
nu se vede fara Edge. Fara calibrare, `stare` si `trimite` vor refuza cu `ciorna_necunoscuta`.

**Stare (r3, 21.11.2026):** pasul 0 a fost rulat de sesiunea de chat pe 21.11.2026 seara din copia
neinstalata a lui `ae3e8947` (27 / 31 / 32 semnaturi in cele trei stari) si listele albe contin
EXACT acele semnaturi (reuniunea), cu testul `test_listele_livrate_si_locatorul` legat de ele.

**Stare (r4, 21.11.2026, dupa review-ul Jakarinos pe r3):**
- **Semnalele inaintea listelor (P1).** O intrare din listele albe NU mai poate acoperi un element care
  poarta vreun semn de atasament: inainte de orice acceptare se verifica eticheta, toate clasele, id-ul,
  numele si valorile tuturor atributelor (si `data-*`, si atribute necunoscute), apoi textele si
  elementele dinauntru. Un astfel de element = `ciorna_necunoscuta`, fara nicio actiune, oricare ar fi
  lista. Liniile lui `stare` care NU se trec NICIODATA in liste (si nici n-ar avea efect): `media:`,
  `fundal:`, `eticheta:`, `text_fisier:`, `text_atasament:`, `token_...:`, `atribut_fisier:`,
  `..._in_editor:`. Calibrabile raman doar `element:<semnatura>` si `text:<text>`.
- **Textul Workspace (P2).** Textul integral al avertismentului de sub ciorna pe un chat existent
  (citit de chat pe 21.11.2026) e in `TEXTE_CUNOSCUTE`: starea (iii) trece (pe pagina sintetica care
  reproduce calibrarea). Un text care contine in plus un nume de fisier sau un cuvant de atasament
  ramane refuzat.
- **Linia `token_file:div{text-input-field simplified-input-area}` NU e in liste (scoasa).** Cuvantul
  "file" nu vine din clase (verificat), ci dintr-un atribut al div-ului real pe care afisarea r3 nu il
  arata. Din r4, `stare` afiseaza in `{...}` si numele atributelor din afara semnaturii, deci pe pagina
  reala linia va fi `necunoscut token_file:div{text-input-field simplified-input-area <nume-atribut>}`.
  **Consecinta: pana la r5, pe pagina reala toate cele trei stari dau 1 necunoscut (aceasta linie) si
  `trimite` refuza.** Pasul 0 se repeta O DATA (ajunge starea i, chat nou gol) cu copia commit-ului r4;
  sesiunea de chat copiaza linia `token_file...` intreaga. Decizia (in chat, apoi r5 + review): daca
  atributul e un marcaj gol de drag & drop (tip `...filedroptarget=""`), se poate adauga o regula
  inchisa si exacta pentru acel nume cu valoare goala (nu o intrare in STRUCTURA, care nu mai are
  efect pe un element cu semnal); orice alt atribut sau o valoare nevida = ramane refuz.
- Pe pagina reala pot aparea si alte linii noi `token_...` / `atribut_fisier:` pe elemente din liste
  (de ex. o clasa cu "card" sau "chip" pe `gem-icon`), fiindca r3 nu verifica clasele / atributele
  elementelor din liste. Ele NU se trec in liste: se copiaza pentru chat si se lamuresc una cate una.

**Stare (r5, 21.11.2026, dupa review-ul Jakarinos pe r4):**
- **Nume de fisier peste tot (P1).** `nume.extensie` se cauta acum in TOATE valorile unui element: clase,
  id, orice atribut, URL-uri (`href` / `src` / `srcset`, inclusiv `blob:`) si `style` (nu doar `url(`).
  Reproducerile din verdict (`gem-icon class="oferta.docx"`, `id="oferta.docx"`, `a ... href="blob:.../
  oferta.docx"`, `gem-icon style="--x: oferta.pdf"`) sunt refuzate fara nicio actiune. Singura exceptie,
  inchisa si testata: intr-un `href` cu schema http(s) a carui gazda e EXACT un host Google (`google.com`
  sau subdomeniu - linkul calibrat "Confidentialitatea ta si Gemini"), hostname-ul nu e fisier; calea,
  interogarea si fragmentul se verifica integral. Orice alt URL (alt host, `blob:`, `data:`, `src`,
  `srcset`) si orice `style` se verifica ca text intreg. **Presupunere declarata:** href-ul real al linkului
  (valoarea nu a fost copiata la pasul 0) sta pe un host Google; daca nu, pe pagina reala va aparea
  `atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}` si se lamureste in chat (nu se trece
  in liste). La fel, un `style` real cu un cuvant de atasament (ex. `--mat-card-...`) ar da `token_card:...`.
- **Linia `token_file` lamurita.** Sursa citita de chat din pagina reala (doar citire, chat nou gol):
  `div.text-input-field.simplified-input-area` are EXACT atributele `_ngcontent-ng-c<numar>=""`,
  `xapfileselectordropzone=""`, `class`, `jslog="303810;track:impression"`. Cuvantul "file" vine din NUMELE
  `xapfileselectordropzone` (marcajul zonei de drop al selectorului de fisiere, cu valoare goala), nu dintr-un
  fisier. Regula inchisa `MARCAJE_GOALE_PERMISE`: acceptat EXACT acest nume, doar cu valoare goala, doar pe
  div-ul cu exact aceste doua clase. Orice valoare nevida, alt atribut cu "file", acelasi atribut pe alt
  element sau cu alte clase = refuz in continuare (teste negative + mutanti). Nu e o intrare in liste si nu
  e o acceptare globala a lui "file". Cu ea, pe pagina sintetica cele trei stari dau 0 necunoscute.
- Pasul 0 NU se mai repeta inainte de review; 5a pe pagina reala e confirmarea (0 necunoscute in ambele
  chaturi). Daca 5a arata totusi o linie `necunoscut ...`, STOP si se copiaza pentru chat.

Se ruleaza `stare` (doar citire: continutul paginii + numarari, fara click / tastatura / navigare)
din copia NEINSTALATA a commit-ului curent al PR-ului (`git archive` dezarhivat, de ex. in
`C:\Users\Public\livrare\run_paw_v464_calibrare`), cu Edge 9333, un singur tab Gemini, Carbon
selectat si niciun `gem` pornit prin lansator:

```powershell
$Cal = 'C:\Users\Public\livrare\run_paw_v464_calibrare\docs\paw\run_paw_v464'
& 'C:\Program Files\Python313\python.exe' "$Cal\gemini_pw.py" stare
```

De trei ori: (i) chat nou (`/app`), ciorna goala; (ii) acelasi chat, cu un cuvant scris DE MANA
in ciorna (fara Enter; apoi il stergi); (iii) un chat existent, ciorna goala. Pe ecran, in toate
trei: niciun fisier, nicio imagine, niciun instrument selectat. Copiaza pentru sesiunea de chat
toate liniile `necunoscute in zona: N` si `  necunoscut ...`. Rocky trece in listele albe EXACT
acele semnaturi (commit nou, hash-uri noi, review din nou). NU se trec niciodata linii `media:`,
`fundal:`, `eticheta:`, `text_fisier:`, `text_atasament:`, `token_...:`, `atribut_fisier:`,
`..._in_editor:` sau orice seamana a fisier (din r4 nici n-ar avea efect: semnalele se verifica
inaintea listelor): daca apar cu ciorna goala pe ecran, STOP si se lamureste in chat. Pasul 0 nu
scrie nimic si nu trimite nimic.

## 1. Variabile (A si N, in orice consola noua, inclusiv la rollback)

```powershell
$ErrorActionPreference = 'Stop'
$Source = 'C:\Users\Public\livrare\run_paw_v464\docs\paw\run_paw_v464'
$PawRoot = 'C:\ProgramData\Gazpet\Paw'
$Bin = Join-Path $PawRoot 'bin'
$Audit = Join-Path $PawRoot 'operator-v464'
$GemMarker = 'C:\Users\Public\paw-data\gem_canal_validat'
$Python = 'C:\Program Files\Python313\python.exe'
$ManifestHash = 'INLOCUIESTE_CU_HASH_MANIFEST_DIN_RAPORT'
$GemHashNou = 'INLOCUIESTE_CU_HASH_GEMINI_PW_DIN_RAPORT'
$GemHashVechi = 'BE3B867B0BD7FA2333D009B54258A146DF72F4D78C2706C321ABEB2D21AED9F5'
$Operator = "$env:COMPUTERNAME\Gazpet-Ai"
$ReaderSid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
```

`$GemHashVechi` = `gemini_pw.py` din v4.6.3 (instalat acum in `bin`).

## 2. Verificari inainte de inlocuire (N - NU in consola admin; o data, inainte de pasul 3)

Testele ruleaza cod din folderul de livrare (scriibil de utilizator): de aceea DOAR ne-elevat.

```powershell
if ($ManifestHash -notmatch '^[A-Fa-f0-9]{64}$' -or $GemHashNou -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Pune hash-urile din raport' }
if ((Get-FileHash -LiteralPath "$Source\SHA256.json").Hash -ine $ManifestHash) { throw 'Alt pachet' }
$manifest = Get-Content -LiteralPath "$Source\SHA256.json" -Raw | ConvertFrom-Json
if (@($manifest.PSObject.Properties).Count -ne 12) { throw 'Manifestul nu are 12 fisiere' }
foreach ($e in $manifest.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $Source $e.Name)).Hash -ine $e.Value) { throw "Hash diferit in pachet: $($e.Name)" }
    if ($e.Name -ne 'gemini_pw.py' -and (Get-FileHash -LiteralPath (Join-Path $Bin $e.Name)).Hash -ine $e.Value) { throw "Difera de instalat: $($e.Name)" }
}
if ($manifest.'gemini_pw.py' -ine $GemHashNou) { throw 'gemini_pw.py din pachet nu e cel revizuit' }
if ((Get-FileHash -LiteralPath "$Bin\gemini_pw.py").Hash -ine $GemHashVechi) { throw 'gemini_pw.py instalat nu e cel din v4.6.3' }
$d = @(Compare-Object -CaseSensitive (Get-Content -LiteralPath "$Bin\gemini_pw.py") (Get-Content -LiteralPath "$Source\gemini_pw.py"))
$d | Where-Object SideIndicator -eq '<=' | Format-List
if ($d.Count -ne 600 -or @($d | Where-Object SideIndicator -eq '<=').Count -ne 11) { throw "Diff gemini_pw.py neasteptat: $($d.Count) linii" }
$ErrorActionPreference = 'Continue'    # unittest scrie pe stderr; in unele gazde PowerShell 5.1 asta ar opri blocul
& $Python -I "$Source\teste\test_gemini_pw.py"
$cod = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($cod -ne 0) { throw 'Testele gemini_pw.py au picat' }
# copia markerului existent (daca exista), pentru rollback - ne-elevat (paw-data e scriibil de utilizatori)
if (Test-Path -LiteralPath $GemMarker) { Copy-Item -LiteralPath $GemMarker -Destination ($GemMarker + '.v463') -Force }
```

Asteptat (pachetul r5): 600 linii diferite (11 vechi `<=`, 589 noi `=>`; r4: 536 / 11 / 525, r3:
477 / 11 / 466, r2: 411 / 11 / 400). Cele 11 linii vechi afisate sunt aceleasi ca in r2 / r3 / r4: antetul,
lista de coduri, linia `import`, comentariul selectorilor `ATAS`, titlul partii cu browserul, cele doua
linii din vechea `_atasamente`, linia `atasamente in ciorna` din `stare` si cele trei linii ale vechii
verificari din `trimite`. Liniile noi: notele v4.6.4 / r2 / r3 / r4 / r5, selectorul `CHIP`, analiza HTML a
ciornei, verificarea pozitiva a structurii, semnalele de atasament verificate inaintea listelor (`_semnal`,
cu nume.extensie in toate valorile si exceptia gazdei Google pentru `href`), regula marcajului gol
`xapfileselectordropzone`, listele albe calibrate (fara linia `token_file`), textul Workspace, regula
domeniului firmei, paza si apelurile ei. Testele: `Ran 106 tests ... OK`. Daca mai urmeaza un commit pe
`gemini_pw.py`, numerele se schimba din nou: le da raportul de review al commit-ului respectiv (cifrele
din raport inlocuiesc 600 / 11 de mai sus).

Regula pentru tot ce urmeaza: in consola admin (A) nu se scrie si nu se muta NIMIC sub
`C:\Users\Public\paw-data` (cale controlabila de utilizatori: o operatie elevata ar putea fi
redirectionata printr-o legatura). Markerul canalului se copiaza, se scrie si se restaureaza
DOAR ne-elevat (N).

## 3. Inlocuirea (A, dupa pasul 1)

Niciun Paw pornit: spune-i sesiunii de chat sa nu lanseze nimic pana termini. Bariera de mai jos
se ia exclusiv: daca ruleaza un lansator, deschiderea ei pica (STOP, reincearca dupa ce termina);
cat timp o tii, niciun lansator nu poate porni. In consola admin NU se executa nimic din folderul
de livrare (scriibil de utilizatori): fiecare dintre cele doua fisiere se citeste de acolo O SINGURA
DATA, in memorie; hash-ul se verifica pe octetii cititi, fata de valorile din raport; doar acei octeti
se scriu in `$Audit` (scriibil doar de admin) si abia de acolo ajung in `bin`. Un fisier inlocuit sau
redirectionat printr-o legatura da alt hash si nu e scris nicaieri.

```powershell
if ($ManifestHash -notmatch '^[A-Fa-f0-9]{64}$' -or $GemHashNou -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Pune hash-urile din raport' }
$p = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)(run_paw|gemini_pw|cgpt_pw|certifica_cdx)' })
if ($p.Count) { $p | Select-Object ProcessId, Name | Format-Table; throw 'Ruleaza un proces Paw' }
. "$Bin\cdx_security.ps1"
$PAW_ROOT = $PawRoot
if (Test-Path -LiteralPath $Audit) { throw 'Audit exista deja (instalare reluata? vezi Rollback)' }
$barrier = OpenCdxInstallBarrier $true
try {
    [void][IO.Directory]::CreateDirectory($Audit); SetCdxAdminAcl $Audit $ReaderSid
    # (a) copii de siguranta ale fisierelor instalate
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        AssertCdxAdminAcl (Join-Path $Bin $n); AssertCdxSingleFile (Join-Path $Bin $n)
        Copy-Item -LiteralPath (Join-Path $Bin $n) -Destination (Join-Path $Audit ($n + '.v463'))
        SetCdxAdminAcl (Join-Path $Audit ($n + '.v463')) $ReaderSid
    }
    if ((HashCdx "$Audit\gemini_pw.py.v463") -ine $GemHashVechi) { throw 'Fisierul instalat nu e gemini_pw.py din v4.6.3' }
    # (b) pachetul: fiecare sursa se citeste O SINGURA DATA in memorie, hash-ul se verifica pe octetii cititi si
    #     doar acei octeti se scriu in zona protejata. Sursa nu se redeschide intre verificare si copiere, iar un
    #     continut care nu e cel revizuit nu ajunge nicaieri (nici macar in $Audit).
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        foreach ($n in 'gemini_pw.py', 'SHA256.json') {
            $asteptat = if ($n -eq 'SHA256.json') { $ManifestHash } else { $GemHashNou }
            $fs = [IO.File]::Open((Join-Path $Source $n), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            try {
                if ($fs.Length -lt 1 -or $fs.Length -gt 1048576) { throw "Sursa cu marime neasteptata: $n" }
                $octeti = New-Object byte[] ([int]$fs.Length)
                $citit = 0
                while ($citit -lt $octeti.Length) {
                    $r = $fs.Read($octeti, $citit, $octeti.Length - $citit)
                    if ($r -le 0) { throw "Citire incompleta: $n" }
                    $citit += $r
                }
            } finally { $fs.Dispose() }
            if (([BitConverter]::ToString($sha.ComputeHash($octeti))).Replace('-', '') -ine $asteptat) { throw "Sursa nu e cea revizuita: $n (nimic scris)" }
            $st = Join-Path $Audit ($n + '.v464')
            [IO.File]::WriteAllBytes($st, $octeti)
            SetCdxAdminAcl $st $ReaderSid; AssertCdxSingleFile $st
        }
    } finally { $sha.Dispose() }
    if ((HashCdx "$Audit\SHA256.json.v464") -ine $ManifestHash) { throw 'Manifestul copiat nu e cel revizuit' }
    if ((HashCdx "$Audit\gemini_pw.py.v464") -ine $GemHashNou) { throw 'gemini_pw.py copiat nu e cel revizuit' }
    $manifest = Get-Content -LiteralPath "$Audit\SHA256.json.v464" -Raw | ConvertFrom-Json
    if (@($manifest.PSObject.Properties).Count -ne 12 -or $manifest.'gemini_pw.py' -ine $GemHashNou) { throw 'Manifest neasteptat' }
    foreach ($e in $manifest.PSObject.Properties) {
        if ($e.Name -ne 'gemini_pw.py' -and (HashCdx (Join-Path $Bin $e.Name)) -ine $e.Value) { throw "Instalat difera de manifest: $($e.Name)" }
    }
    # (c) inlocuirea, din zona protejata
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        $dest = Join-Path $Bin $n
        Copy-Item -LiteralPath (Join-Path $Audit ($n + '.v464')) -Destination $dest -Force
        AssertCdxAdminAcl $dest; AssertCdxSingleFile $dest
    }
    # (d) starea finala: toate cele 12 fisiere din bin = manifestul revizuit
    if ((HashCdx "$Bin\SHA256.json") -ine $ManifestHash) { throw 'Manifest instalat diferit de cel revizuit' }
    foreach ($e in $manifest.PSObject.Properties) {
        if ((HashCdx (Join-Path $Bin $e.Name)) -ine $e.Value) { throw "Dupa inlocuire difera: $($e.Name)" }
    }
    AssertCdxAdminAcl $Bin
    'Inlocuit: gemini_pw.py + SHA256.json. Copiile de siguranta sunt in ' + $Audit
} finally { $barrier.Dispose() }
```

`Copy-Item -Force` rescrie continutul fisierului existent: ACL-ul si proprietarul lui raman
(verificate inainte si dupa). Orice `throw` dupa (c): Rollback (mai jos). Un `throw` inainte de
(c) nu a schimbat nimic in `bin`. Markerul nu se atinge aici: e legat de hash, deci dupa (c)
lansatorul refuza oricum `gem` pana la markerul nou (pasul 5).

## 4. Legatura cdx neschimbata (N, consola noua, dupa pasul 1)

```powershell
. "$Bin\cdx_security.ps1"
$PAW_ROOT = $PawRoot
$b = GetCdxBinding
$c = Get-Content -LiteralPath "$Bin\cdx_sandbox_validat.json" -Raw | ConvertFrom-Json
foreach ($k in $c.binding.bin.PSObject.Properties) {
    if ([string]$b.bin[$k.Name] -cne [string]$k.Value) { throw "Legatura cdx difera: $($k.Name)" }
}
if (@($b.bin.Keys).Count -ne @($c.binding.bin.PSObject.Properties).Count) { throw 'Legatura cdx: alt numar de fisiere' }
'Legatura cdx identica cu certificatul (' + @($b.bin.Keys).Count + ' fisiere)'
```

## 5. Testul de canal Gemini (N; cu "Carbon")

Fara marker, lansatorul refuza `gem`, deci probele directe de mai jos nu se pot suprapune cu o
rulare prin lansator. In Edge-ul 9333: un singur tab Gemini, modelul **Carbon** selectat, ciorna goala.

```powershell
$GemId = Get-Date -Format 'yyyyMMdd-HHmmss'
$GemBrief = "C:\Users\Public\paw-data\brief\gem-canal-$GemId.md"
'Raspunde exact: PAW_GEM_TEST_OK' | Set-Content -LiteralPath $GemBrief -Encoding ASCII
& $Python "$Bin\gemini_pw.py" stare
```

Orice rezultat diferit de cel cerut mai jos = **STOP**, fara marker; copiaza toate liniile lui
`stare` (sau ultima linie a lui `trimite`) pentru sesiunea de chat.

- **5a.** `stare` arata `model: Carbon`, `genereaza: False`, `atasamente in ciorna: 0`,
  `necunoscute in zona: 0`, `paza ciorna: OK (trimite ar continua)`. Cu ciorna goala pe ecran,
  `paza ciorna: REFUZ ciorna_necunoscuta ...` = calibrarea (pasul 0) nu acopera pagina: STOP,
  fara marker, copiaza liniile `necunoscut ...` pentru chat. 5a se ruleaza pe un chat NOU si apoi
  inca o data pe un chat EXISTENT (tab-ul ramane pe chatul vechi dupa fiecare `gem`, iar paza
  verifica intai tab-ul curent): ambele trebuie sa dea `necunoscute in zona: 0`. (Pachetul r4 arata aici
  1 necunoscut `token_file:...`; r5 il lamureste prin regula marcajului `xapfileselectordropzone=""` -
  vezi pasul 0. Daca 5a arata `atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}`,
  href-ul real al linkului nu e pe un host Google: STOP, copiaza linia pentru chat.)
- **5b.** Pune de mana UN fisier mic (de ex. un `.txt`) in ciorna, fara sa trimiti; `stare` din nou:
  trebuie EXACT `atasamente in ciorna: 1` si `paza ciorna: REFUZ ciorna_cu_atasamente ...`.
  `0`, `2`, `5`, `?` sau orice alt numar = STOP (numararea nu se potriveste cu pagina reala).
- **5c.** Cu fisierul in ciorna: `& $Python "$Bin\gemini_pw.py" trimite $GemBrief 120` - ultima
  linie `GEM_EROARE ciorna_cu_atasamente inainte_de_chat_nou: 1 atasament(e) in ciorna - nu trimit`.
  Pe ecran: NU s-a deschis chat nou, nu a plecat niciun mesaj, fisierul e tot in ciorna.
  `stare` din nou: tot `atasamente in ciorna: 1`. (Exact pasul care a picat pe 19.11.)
- **5d.** Pune al doilea fisier in ciorna; `stare`: EXACT `atasamente in ciorna: 2`.
- **5e.** Scoate ambele fisiere de mana; `stare`: `atasamente in ciorna: 0`, `necunoscute in zona: 0`,
  `paza ciorna: OK ...`.
- **5f.** Selecteaza de mana alt model (4 Hydrogen) si repeta `trimite`: ultima linie
  `GEM_EROARE model_gresit afisat: '...Hydrogen...', cerut: Carbon`; nu a plecat niciun mesaj.
- **5g.** Revino de mana la Carbon si ruleaza blocul de mai jos: doua trimiteri, fiecare verificata
  (cod de iesire 0, nicio linie `GEM_EROARE`, ultima linie `GEM_CHAT_URL ...`, raspunsul contine
  `PAW_GEM_TEST_OK` - un raspuns partial urmat de timeout NU trece). Pe ecran: chat nou in
  ACELASI tab de fiecare data, fara taburi create / inchise.

```powershell
foreach ($i in 1, 2) {
    $ErrorActionPreference = 'Continue'
    $out = @(& $Python "$Bin\gemini_pw.py" trimite $GemBrief 120)
    $cod = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $out
    if ($cod -ne 0) { throw "Trimiterea ${i}: cod de iesire $cod" }
    if (@($out | Where-Object { $_ -match '^GEM_EROARE' }).Count) { throw "Trimiterea ${i}: GEM_EROARE" }
    if ($out.Count -eq 0 -or $out[-1] -notmatch '^GEM_CHAT_URL https://gemini\.google\.com/app/[0-9a-fA-F]+$') { throw "Trimiterea ${i}: lipseste linia finala GEM_CHAT_URL" }
    if (@($out | Where-Object { $_ -match 'PAW_GEM_TEST_OK' }).Count -eq 0) { throw "Trimiterea ${i}: raspunsul nu contine PAW_GEM_TEST_OK" }
    "Trimiterea ${i}: OK"
}
```

Daca 5g da `GEM_EROARE ciorna_necitibila ...` cu ciorna goala: zona de compunere are alt nume in
pagina reala; STOP, fara marker, copiaza linia `zone compunere ...` din `stare` pentru chat.
Daca 5g da `GEM_EROARE ciorna_necunoscuta <moment>: N element(e) nerecunoscute in zona ciornei -
nu trimit (...)` cu ciorna goala (sau doar cu textul brief-ului): pagina are elemente pe care
calibrarea nu le-a vazut (de ex. butonul de trimitere apare abia dupa scriere); nu a plecat nimic.
STOP, fara marker, copiaza linia `GEM_EROARE` + liniile `necunoscut ...` din `stare` pentru chat.

Numai dupa ce ai VAZUT rezultatele 5a-5g, markerul - **ne-elevat (N)**, nu din consola admin:

```powershell
$GemHash = (Get-FileHash -LiteralPath "$Bin\gemini_pw.py" -Algorithm SHA256).Hash
if ($GemHash -ine $GemHashNou) { throw 'gemini_pw.py instalat nu e cel revizuit' }
Set-Content -LiteralPath $GemMarker -Value ('CANAL_VALIDAT ' + $GemHash + ' ' + (Get-Date -Format o) + ' Razvan-v464') -Encoding ASCII
```

## 6. Smoke prin lansator (N)

```powershell
$Id = Get-Date -Format 'yyyyMMdd-HHmmss'
$B = "C:\Users\Public\paw-data\brief\smoke-v464-$Id.md"
'Raspunde exact: PAW_TEST_OK' | Set-Content -LiteralPath $B -Encoding ASCII
& "$Bin\run_paw.cmd" gem $B "C:\Users\Public\paw-data\out\smoke-v464-gem-$Id.log" argon
& "$Bin\run_paw.cmd" jak $B "C:\Users\Public\paw-data\out\smoke-v464-jak-$Id.log"
```

Asteptat (ultima linie din fiecare log): gem `PAW_GATA`; jak `PAW_GATA`. In logul gem apare
`GEM_MODEL: Carbon`. cop si cdx nu se testeaza: fisierele lor nu s-au schimbat.

Dupa smoke: sesiunea de chat actualizeaza `registru_automatizari`, randul `run_paw` din
`public.automatizari` si mentiunea "Gemini 4 Argon" din CLAUDE.md (model: Carbon).

## Rollback la v4.6.3 (A, consola noua, dupa pasul 1; pasul 2 NU se ruleaza)

```powershell
. "$Bin\cdx_security.ps1"
$PAW_ROOT = $PawRoot
$barrier = OpenCdxInstallBarrier $true
try {
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        $src = Join-Path $Audit ($n + '.v463')
        if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw ('Lipseste copia de siguranta pentru ' + $n + ' - bin nu a fost atins de pasul 3 (compara hash-urile de mana)') }
        AssertCdxAdminAcl $src; AssertCdxSingleFile $src
    }
    if ((HashCdx "$Audit\gemini_pw.py.v463") -ine $GemHashVechi) { throw 'Copia de siguranta nu e gemini_pw.py din v4.6.3' }
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        Copy-Item -LiteralPath (Join-Path $Audit ($n + '.v463')) -Destination (Join-Path $Bin $n) -Force
        AssertCdxAdminAcl (Join-Path $Bin $n); AssertCdxSingleFile (Join-Path $Bin $n)
        if ((HashCdx (Join-Path $Bin $n)) -ine (HashCdx (Join-Path $Audit ($n + '.v463')))) { throw "Rollback incomplet: $n" }
    }
} finally { $barrier.Dispose() }
Rename-Item -LiteralPath $Audit -NewName ('operator-v464-anulat-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
```

Apoi markerul, **ne-elevat (N)**, dupa pasul 1 (copia facuta la pasul 2, daca exista):

```powershell
if (Test-Path -LiteralPath ($GemMarker + '.v463')) { Copy-Item -LiteralPath ($GemMarker + '.v463') -Destination $GemMarker -Force }
```

Dupa rollback `gem` ramane refuzat (v4.6.3 nu are marker valid: testul ei de canal a picat);
jak / cop / cdx neschimbate. Pasul 4 se poate rula ca verificare. Folderul de audit e redenumit,
deci pasul 3 se poate relua de la capat dupa ce cauza e lamurita.

## Pachetele neinstalate v4.6.2 (mil) si v4.7 (cxw)

Amandoua pornesc de la v4.6.1 si au `gemini_pw.py` cu "Argon" si fara paza de mai sus. Inainte de
instalarea oricaruia, `gemini_pw.py` se ia din v4.6.4 (acest pachet), manifestul lor se regenereaza
si diff-ul trece din nou prin review.
