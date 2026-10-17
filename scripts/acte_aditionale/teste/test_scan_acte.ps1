# Test scan_acte.ps1 pe un "NAS" sintetic local (director temporar) - NU atinge NAS-ul real.
# Rulare: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\acte_aditionale\teste\test_scan_acte.ps1
$ErrorActionPreference = 'Stop'
$scan = Join-Path (Split-Path -Parent $PSScriptRoot) 'scan_acte.ps1'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('acte_test_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
$tmp = (Get-Item -LiteralPath $tmp).FullName   # cale lunga (fara 8.3)
$nas = Join-Path $tmp 'nas'; $baza = Join-Path $tmp 'baza'
$script:esecuri = 0
function Verifica($cond, $mesaj) { if ($cond) { "  OK   $mesaj" } else { "  ESEC $mesaj"; $script:esecuri++ } }
function Scan([string[]]$extra) {
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File $scan -Radacina $nas -Baza $baza @extra 2>&1
  return @{ cod = $LASTEXITCODE; text = ($o -join "`n") }
}
# fisiere: nume + marime + data; foldere: doar numele (data folderului NTFS se actualizeaza intarziat, zgomot)
function Instantaneu { Get-ChildItem -LiteralPath $nas -Recurse -Force | ForEach-Object { if ($_.PSIsContainer) { 'D|' + $_.FullName } else { '{0}|{1}|{2}' -f $_.FullName, $_.Length, $_.LastWriteTimeUtc.Ticks } } | Sort-Object }
function Stare { Get-Content -LiteralPath (Join-Path $baza 'stare.tsv') -Encoding UTF8 }
function Lista { Import-Csv -LiteralPath (Join-Path $baza ((Get-Date -Format 'yyyy-MM-dd') + '\lista.tsv')) -Delimiter "`t" -Encoding UTF8 }
try {
  "1) NAS indisponibil -> exit 2"
  $r = Scan; Verifica ($r.cod -eq 2) "exit 2 cand radacina nu exista (cod=$($r.cod))"

  # NAS sintetic: doua proiecte, acte + fisiere care nu sunt acte
  $p1 = Join-Path $nas 'Oferte\1.TRANSGAZ\114. Proiect unu'
  $p2 = Join-Path $nas 'Oferte\2.ALTII\7. Proiect doi\Contract'
  New-Item -ItemType Directory -Force -Path $p1, $p2 | Out-Null
  Set-Content -LiteralPath (Join-Path $p1 'Act aditional 1.pdf') -Value 'aa1'
  Set-Content -LiteralPath (Join-Path $p1 'Act aditional 2 .pdf') -Value 'aa2'
  Set-Content -LiteralPath (Join-Path $p1 'Oferta tehnica.pdf') -Value 'nu e act'
  Set-Content -LiteralPath (Join-Path $p2 'AA 3 majorare valoare.docx') -Value 'aa3'
  Set-Content -LiteralPath (Join-Path $p2 'act aditional.txt') -Value 'extensie ignorata'

  "2) lipseste proiecte.tsv -> exit 3"
  $r = Scan; Verifica ($r.cod -eq 3) "exit 3 fara proiecte.tsv (cod=$($r.cod))"

  New-Item -ItemType Directory -Force -Path $baza | Out-Null
  Set-Content -LiteralPath (Join-Path $baza 'proiecte.tsv') -Encoding UTF8 -Value @(
    "id`tcod`tcale",
    "1`tUNU`tOferte/1.TRANSGAZ/114. Proiect unu",
    "2`tDOI`tOferte/2.ALTII/7. Proiect doi",
    "3`tFARA`t",
    "4`tRAU`t../../Windows",
    "5`tABS`tC:/Windows")

  "3) parametri refuzati -> exit 5"
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File $scan -Radacina $nas -Baza (Join-Path $nas 'Oferte\iesire') 2>&1
  Verifica ($LASTEXITCODE -eq 5) "Baza sub radacina NAS refuzata (cod=$LASTEXITCODE)"
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File $scan -Radacina $nas -Baza '\\server\share\x' 2>&1
  Verifica ($LASTEXITCODE -eq 5) "Baza UNC refuzata (cod=$LASTEXITCODE)"

  "4) prima rulare = BASELINE, chei relative"
  $inainte = Instantaneu
  $r = Scan
  Verifica ($r.cod -eq 0) "exit 0 (cod=$($r.cod))"
  Verifica ($r.text -match 'baseline=True \| total de verificat: 3') 'baseline cu 3 acte'
  Verifica ($r.text -match 'P3 FARA \| FARA CALE NAS') 'proiect fara cale semnalat'
  Verifica ($r.text -match 'P4 RAU \| CALE REFUZATA') 'cale cu .. refuzata'
  Verifica ($r.text -match 'P5 ABS \| CALE REFUZATA') 'cale absoluta refuzata'
  $st = @(Stare)
  Verifica ($st.Count -eq 3) "stare.tsv are 3 randuri ($($st.Count))"
  Verifica (@($st | Where-Object { $_ -match '^[A-Za-z]:' -or $_.StartsWith('\\') }).Count -eq 0) 'nicio cheie absoluta in stare.tsv'
  Verifica (@($st | Where-Object { $_.StartsWith("Oferte\1.TRANSGAZ\114. Proiect unu\Act aditional 1.pdf`t") }).Count -eq 1) 'cheie relativa la radacina'
  $l = @(Lista)
  Verifica ((@($l | Where-Object { $_.motiv -eq 'BASELINE' }).Count) -eq 3) 'lista: 3 x BASELINE'
  Verifica (@($l | Where-Object { -not ($_.fisier_local.StartsWith($baza)) }).Count -eq 0) 'copiile locale sunt sub Baza'
  Verifica (@($l | Where-Object { Test-Path -LiteralPath $_.fisier_local }).Count -eq 3) 'copiile locale exista'
  $dif = @(Compare-Object $inainte (Instantaneu)); $dif | ForEach-Object { '    dif: ' + $_.SideIndicator + ' ' + $_.InputObject }
  Verifica ($dif.Count -eq 0) 'NAS-ul sintetic neschimbat (nume, marime, data)'

  "5) a doua rulare fara schimbari -> 0 de verificat"
  $r = Scan
  Verifica ($r.cod -eq 0 -and $r.text -match 'baseline=False \| total de verificat: 0') 'nimic nou'

  "6) fisier modificat + fisier nou"
  Start-Sleep -Milliseconds 1100
  Set-Content -LiteralPath (Join-Path $p1 'Act aditional 2 .pdf') -Value 'aa2 semnat, mai lung'
  Set-Content -LiteralPath (Join-Path $p2 'Acord subsecvent 4.pdf') -Value 'as4'
  $r = Scan
  Verifica ($r.text -match 'total de verificat: 2') 'doua de verificat'
  $l = @(Lista)
  Verifica (@($l | Where-Object { $_.motiv -eq 'MODIFICAT' }).Count -eq 1) 'un MODIFICAT'
  Verifica (@($l | Where-Object { $_.motiv -eq 'NOU' }).Count -eq 1) 'un NOU'
  Verifica (@(Stare).Count -eq 4) 'stare.tsv are 4 randuri'

  "7) stare.tsv in format vechi (Z:\) -> exit 4, fara scriere"
  $fSt = Join-Path $baza 'stare.tsv'
  $bun = Get-Content -LiteralPath $fSt -Encoding UTF8
  Set-Content -LiteralPath $fSt -Encoding UTF8 -Value ($bun | ForEach-Object { 'Z:\' + $_ })
  $h1 = (Get-FileHash -LiteralPath $fSt).Hash
  $r = Scan
  Verifica ($r.cod -eq 4) "exit 4 pe chei Z:\ (cod=$($r.cod))"
  Verifica ((Get-FileHash -LiteralPath $fSt).Hash -eq $h1) 'stare.tsv neatins la refuz'
  "7b) conversia (converteste_stare.py) -> scanarea nu mai vede nimic nou"
  $conv = Join-Path (Split-Path -Parent $PSScriptRoot) 'converteste_stare.py'
  $py = Get-Command python -ErrorAction SilentlyContinue
  if ($py) {
    $o = & python -B $conv --preview --fisier $fSt 2>&1
    Verifica (($o -join "`n") -match 'de convertit: 4') 'preview: 4 de convertit'
    $o = & python -B $conv --aplica --asteptat 4 --fisier $fSt 2>&1
    Verifica ($LASTEXITCODE -eq 0) "aplica (cod=$LASTEXITCODE)"
    $r = Scan
    Verifica ($r.cod -eq 0 -and $r.text -match 'baseline=False \| total de verificat: 0') 'dupa conversie: nimic nou'
  } else { '  SARIT (python lipseste)'; Set-Content -LiteralPath $fSt -Encoding UTF8 -Value $bun }

  "8) -Toate = BASELINE complet"
  $r = Scan @('-Toate')
  Verifica ($r.text -match 'baseline=True \| total de verificat: 4') 'baseline cu 4 acte'
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
if ($script:esecuri) { "ESECURI: $script:esecuri"; exit 1 } else { 'TOATE TESTELE TREC'; exit 0 }
