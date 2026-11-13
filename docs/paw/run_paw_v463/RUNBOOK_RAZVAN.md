# Paw v4.6.3 - doar modelul Gemini (Carbon) - procedura pentru Razvan

Numai operatorul executa pasii. Agentul nu a instalat nimic si nu a cerut elevare.
A = PowerShell 5.1 admin Gazpet-Ai; N = acelasi cont NE-elevat. Orice eroare = STOP.

**Ce se schimba:** numai `gemini_pw.py` si linia lui din `SHA256.json`.
- Modelul cerut devine "Carbon" (Argon a disparut din lista Gemini pe 13.11.2026; lista de acum:
  4 Hydrogen, 4 Hydrogen Thinking, 4 Carbon; butonul afiseaza "Carbon").
- Potrivirea devine exacta: eticheta afisata trebuie sa fie "Carbon", optional precedata de
  "Gemini" si / sau de numarul versiunii ("4 Carbon", "Gemini 4 Carbon"). Orice sufix
  ("Carbon Thinking") sau alt model = `model_gresit`, fara Enter. (Inainte: "contine Argon".)
- Celelalte 11 fisiere sunt copii octet cu octet ale celor instalate acum in `bin` (v4.6.1).

**De ce NU e nevoie de Install / WFP / Run / Seal:** `run_paw.ps1` nu se schimba, iar legatura din
`cdx_sandbox_validat.json` (functia `GetCdxBinding`) nu contine `gemini_pw.py` si nici
`SHA256.json`. Certificatul cdx ramane valabil; jak / cop / cdx nu sunt atinse.
**Ce se reface:** testul de canal Gemini - hash-ul nou al `gemini_pw.py` invalideaza markerul
`paw-data\gem_canal_validat` (lansatorul refuza `gem` pana la markerul nou).
**Ramane neschimbat in lansator:** canalul se cheama tot `gem ... argon` / `argon:<lucrare>`
(nume istoric al etichetei; modelul real e cel verificat de `gemini_pw.py`). Redenumirea
etichetei cere schimbarea `run_paw.ps1`, deci se face la urmatoarea instalare completa.

Hash-urile vin din raportul de review, nu din acest fisier. Livrare: folderul din commit-ul
aprobat ajunge in `$Source` (`git archive` al commit-ului, dezarhivat in
`C:\Users\Public\livrare\run_paw_v463`); verificarea de mai jos decide.

## 1. Variabile (A si N, in orice consola noua, inclusiv la rollback)

```powershell
$ErrorActionPreference = 'Stop'
$Source = 'C:\Users\Public\livrare\run_paw_v463\docs\paw\run_paw_v463'
$PawRoot = 'C:\ProgramData\Gazpet\Paw'
$Bin = Join-Path $PawRoot 'bin'
$Audit = Join-Path $PawRoot 'operator-v463'
$GemMarker = 'C:\Users\Public\paw-data\gem_canal_validat'
$Python = 'C:\Program Files\Python313\python.exe'
$ManifestHash = 'INLOCUIESTE_CU_HASH_MANIFEST_DIN_RAPORT'
$GemHashNou = 'INLOCUIESTE_CU_HASH_GEMINI_PW_DIN_RAPORT'
$GemHashVechi = '5D1098D3193AACB90938981A7989ED4C95FC59DA5903A9AA500B5D2E6A50AB61'
$Operator = "$env:COMPUTERNAME\Gazpet-Ai"
$ReaderSid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
```

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
if ((Get-FileHash -LiteralPath "$Bin\gemini_pw.py").Hash -ine $GemHashVechi) { throw 'gemini_pw.py instalat nu e cel din v4.6.1' }
$d = @(Compare-Object -CaseSensitive (Get-Content -LiteralPath "$Bin\gemini_pw.py") (Get-Content -LiteralPath "$Source\gemini_pw.py"))
$d | Format-List
if ($d.Count -ne 16 -or @($d | Where-Object SideIndicator -eq '<=').Count -ne 5) { throw "Diff gemini_pw.py neasteptat: $($d.Count) linii" }
$ErrorActionPreference = 'Continue'    # unittest scrie pe stderr; in unele gazde PowerShell 5.1 asta ar opri blocul
& $Python -I "$Source\teste\test_gemini_pw.py"
$cod = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($cod -ne 0) { throw 'Testele gemini_pw.py au picat' }
# copia markerului vechi, pentru rollback (ne-elevat: paw-data e scriibil de utilizatori, deci NU se atinge din consola admin)
if (Test-Path -LiteralPath $GemMarker) { Copy-Item -LiteralPath $GemMarker -Destination ($GemMarker + '.v461') -Force }
```

Asteptat: 16 linii diferite (5 vechi `<=`, 11 noi `=>`): antetul, nota v4.6.3 (4 linii),
`MODEL_CERUT`, `MODEL_FORMA` + comentariul ei, cele doua linii din `verifica_model`,
comentariul r7. Testele: `Ran 34 tests ... OK`.

Regula pentru tot ce urmeaza: in consola admin (A) nu se scrie si nu se muta NIMIC sub
`C:\Users\Public\paw-data` (cale controlabila de utilizatori: o operatie elevata ar putea fi
redirectionata printr-o legatura). Markerul canalului se copiaza, se scrie si se restaureaza
DOAR ne-elevat (N), ca in procedura v4.3.

## 3. Inlocuirea (A, dupa pasul 1)

Niciun Paw pornit: spune-i sesiunii de chat sa nu lanseze nimic pana termini. Bariera de mai jos
se ia exclusiv: daca ruleaza un lansator, deschiderea ei pica (STOP, reincearca dupa ce termina);
cat timp o tii, niciun lansator nu poate porni. In consola admin NU se executa nimic din folderul
de livrare: cele doua fisiere se copiaza intai in `$Audit` (scriibil doar de admin), se verifica
ACOLO fata de hash-urile din raport si abia de acolo ajung in `bin`.

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
        Copy-Item -LiteralPath (Join-Path $Bin $n) -Destination (Join-Path $Audit ($n + '.v461'))
        SetCdxAdminAcl (Join-Path $Audit ($n + '.v461')) $ReaderSid
    }
    if ((HashCdx "$Audit\gemini_pw.py.v461") -ine $GemHashVechi) { throw 'Fisierul instalat nu e gemini_pw.py din v4.6.1' }
    # (b) pachetul, in zona protejata, verificat acolo
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        $src = Join-Path $Source $n
        [void](AssertCdxPath $src); AssertCdxSingleFile $src      # fara legaturi / reparse pe calea sursei
        $st = Join-Path $Audit ($n + '.v463')
        Copy-Item -LiteralPath $src -Destination $st
        SetCdxAdminAcl $st $ReaderSid; AssertCdxSingleFile $st
    }
    if ((HashCdx "$Audit\SHA256.json.v463") -ine $ManifestHash) { throw 'Manifestul copiat nu e cel revizuit' }
    if ((HashCdx "$Audit\gemini_pw.py.v463") -ine $GemHashNou) { throw 'gemini_pw.py copiat nu e cel revizuit' }
    $manifest = Get-Content -LiteralPath "$Audit\SHA256.json.v463" -Raw | ConvertFrom-Json
    if (@($manifest.PSObject.Properties).Count -ne 12 -or $manifest.'gemini_pw.py' -ine $GemHashNou) { throw 'Manifest neasteptat' }
    foreach ($e in $manifest.PSObject.Properties) {
        if ($e.Name -ne 'gemini_pw.py' -and (HashCdx (Join-Path $Bin $e.Name)) -ine $e.Value) { throw "Instalat difera de manifest: $($e.Name)" }
    }
    # (c) inlocuirea, din zona protejata
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        $dest = Join-Path $Bin $n
        Copy-Item -LiteralPath (Join-Path $Audit ($n + '.v463')) -Destination $dest -Force
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
(c) nu a schimbat nimic in `bin`. Markerul vechi nu se atinge aici: e legat de hash-ul vechi, deci
dupa (c) lansatorul refuza oricum `gem` pana la markerul nou (pasul 5).

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

## 5. Testul de canal Gemini (N; pasii 1-8 din LANSATOR_UNIC_PAW.md, sectiunea v4.3, cu "Carbon")

Fara marker, lansatorul refuza `gem`, deci probele directe de mai jos nu se pot suprapune cu o
rulare prin lansator. In Edge-ul 9333: un singur tab Gemini, modelul **Carbon** selectat, ciorna goala.

```powershell
$GemId = Get-Date -Format 'yyyyMMdd-HHmmss'
$GemBrief = "C:\Users\Public\paw-data\brief\gem-canal-$GemId.md"
'Raspunde exact: PAW_GEM_TEST_OK' | Set-Content -LiteralPath $GemBrief -Encoding ASCII
& $Python "$Bin\gemini_pw.py" stare
```

1. `stare` arata `model: Carbon`, `genereaza: False`, `atasamente in ciorna: 0`.
2. Pune de mana un fisier mic in ciorna (fara sa trimiti); `stare` din nou: `atasamente in ciorna: 1`
   (daca arata 0: STOP, fara marker).
3. Cu atasamentul in ciorna: `& $Python "$Bin\gemini_pw.py" trimite $GemBrief 120` - ultima linie
   `GEM_EROARE ciorna_cu_atasamente ...`; pe ecran nu a plecat niciun mesaj.
4. Scoate atasamentul de mana; `stare` din nou: `atasamente in ciorna: 0`.
5. Selecteaza de mana alt model (4 Hydrogen) si repeta `trimite`: ultima linie
   `GEM_EROARE model_gresit afisat: '...Hydrogen...', cerut: Carbon`; nu a plecat niciun mesaj.
6. Revino de mana la Carbon si ruleaza blocul de mai jos: doua trimiteri, fiecare verificata
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

Numai dupa ce ai VAZUT rezultatele 1-6, markerul - **ne-elevat (N)**, nu din consola admin:

```powershell
$GemHash = (Get-FileHash -LiteralPath "$Bin\gemini_pw.py" -Algorithm SHA256).Hash
if ($GemHash -ine $GemHashNou) { throw 'gemini_pw.py instalat nu e cel revizuit' }
Set-Content -LiteralPath $GemMarker -Value ('CANAL_VALIDAT ' + $GemHash + ' ' + (Get-Date -Format o) + ' Razvan-v463') -Encoding ASCII
```

## 6. Smoke prin lansator (N)

```powershell
$Id = Get-Date -Format 'yyyyMMdd-HHmmss'
$B = "C:\Users\Public\paw-data\brief\smoke-v463-$Id.md"
'Raspunde exact: PAW_TEST_OK' | Set-Content -LiteralPath $B -Encoding ASCII
& "$Bin\run_paw.cmd" gem $B "C:\Users\Public\paw-data\out\smoke-v463-gem-$Id.log" argon
& "$Bin\run_paw.cmd" jak $B "C:\Users\Public\paw-data\out\smoke-v463-jak-$Id.log"
```

Asteptat (ultima linie din fiecare log): gem `PAW_GATA`; jak `PAW_GATA`. In logul gem apare
`GEM_MODEL: Carbon`. cop si cdx nu se testeaza: fisierele lor nu s-au schimbat.

Dupa smoke: sesiunea de chat actualizeaza `registru_automatizari`, randul `run_paw` din
`public.automatizari` si mentiunea "Gemini 4 Argon" din CLAUDE.md (model: Carbon).

## Rollback la v4.6.1 (A, consola noua, dupa pasul 1; pasul 2 NU se ruleaza)

```powershell
. "$Bin\cdx_security.ps1"
$PAW_ROOT = $PawRoot
$barrier = OpenCdxInstallBarrier $true
try {
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        $src = Join-Path $Audit ($n + '.v461')
        if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw ('Lipseste copia de siguranta pentru ' + $n + ' - bin nu a fost atins de pasul 3 (compara hash-urile de mana)') }
        AssertCdxAdminAcl $src; AssertCdxSingleFile $src
    }
    if ((HashCdx "$Audit\gemini_pw.py.v461") -ine $GemHashVechi) { throw 'Copia de siguranta nu e gemini_pw.py din v4.6.1' }
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        Copy-Item -LiteralPath (Join-Path $Audit ($n + '.v461')) -Destination (Join-Path $Bin $n) -Force
        AssertCdxAdminAcl (Join-Path $Bin $n); AssertCdxSingleFile (Join-Path $Bin $n)
        if ((HashCdx (Join-Path $Bin $n)) -ine (HashCdx (Join-Path $Audit ($n + '.v461')))) { throw "Rollback incomplet: $n" }
    }
} finally { $barrier.Dispose() }
Rename-Item -LiteralPath $Audit -NewName ('operator-v463-anulat-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
```

Apoi markerul vechi, **ne-elevat (N)**, dupa pasul 1 (copia facuta la pasul 2):

```powershell
if (Test-Path -LiteralPath ($GemMarker + '.v461')) { Copy-Item -LiteralPath ($GemMarker + '.v461') -Destination $GemMarker -Force }
```

Dupa rollback `gem` cere din nou "Argon" (model care nu mai exista: canalul ramane refuzat, ca
inainte de v4.6.3); jak / cop / cdx neschimbate. Pasul 4 se poate rula ca verificare. Folderul
de audit e redenumit, deci pasul 3 se poate relua de la capat dupa ce cauza e lamurita.

## Pachetele neinstalate v4.6.2 (mil) si v4.7 (cxw)

Amandoua pornesc de la v4.6.1 si au `gemini_pw.py` cu "Argon". Inainte de instalarea oricaruia,
`gemini_pw.py` se ia din v4.6.3 (acest pachet), manifestul lor se regenereaza si diff-ul trece
din nou prin review. Nu se instaleaza un pachet care readuce "Argon".
