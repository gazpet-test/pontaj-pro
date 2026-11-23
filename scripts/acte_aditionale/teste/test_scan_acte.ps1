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

  # al treilea proiect: garantii de buna executie (GBE) si polite CAR, adevarate si false (21.11.2026)
  # diacriticele din [char], ca fisierul de test sa ramana ASCII: t/a cu virgula / caciula (NFC), t cu sedila, semne combinate (NFD)
  $tz = [char]0x021B; $ab = [char]0x0103; $ced = [char]0x0163; $virg = [char]0x0326; $cac = [char]0x0306
  $p3 = Join-Path $nas 'Oferte\1.TRANSGAZ\120. Proiect trei'
  $p3o = Join-Path $p3 'Ofertare\Oferta tehnica'
  $p3d = Join-Path $p3 ("Ofert$ab tehnic$ab")
  $p3c = Join-Path $p3 'Carburant'
  New-Item -ItemType Directory -Force -Path $p3, $p3o, $p3d, $p3c | Out-Null
  $gc = [ordered]@{
    # nume                                                          familie asteptata ('' = nu intra in lista)
    "Garan${tz}ie de bun$ab execu${tz}ie nr 123.pdf"                = 'gbe'
    "Scrisoare de garan${ced}ie bancara.pdf"                         = 'gbe'
    'Polita_GBE_AX168650.pdf'                                        = 'gbe'
    'instrument de garantare.docx'                                   = 'gbe'
    "Garant${virg}ie de buna$cac executie AA1.pdf"                   = 'gbe'   # NFD + "AA1": GBE are prioritate fata de act
    'Polita CAR 2025.pdf'                                            = 'car'
    'polita_CAR_act aditional 2.pdf'                                 = 'car'   # act aditional LA POLITA -> car
    'Asigurare constructii-montaj.pdf'                               = 'car'
    'All Risks EAR.pdf'                                              = 'car'
    'CAR2024.pdf'                                                    = 'car'
    'Bon carburant.pdf'                                              = ''
    'Cariera nisip.pdf'                                              = ''
    'Carte tehnica.pdf'                                              = ''
    'Oscar scara.pdf'                                                = ''
    'rgbe_harta.png'                                                 = ''
    'Garantie de participare.pdf'                                    = ''      # nu e nici GBE, nici act
    'Scrisoare de garantie participare.pdf'                          = 'exclus'
    # precedenta (Jakarinos #1162 r1 P2): GBE/CAR de oferta / participare ramane exclus si cand numele seamana cu un act
    'Act aditional polita CAR oferta.pdf'                            = 'exclus'
    'AA1 scrisoare de garantie participare.pdf'                      = 'exclus'
    'AA 2 majorare polita GBE participare.docx'                      = 'exclus'
    'Act aditional 5 oferta.pdf'                                     = 'act'   # nu e GBE/CAR -> regula actelor, ca inainte
    # CAR = si Casa de Ajutor Reciproc (HR): cu tokenul CAR intra ca posibil CAR (Jakarinos il clasifica NERELEVANT), fara token nu intra
    'CAR Casa de Ajutor Reciproc adeverinta.pdf'                     = 'car'
    'Casa de Ajutor Reciproc imprumut.pdf'                           = ''
    'Polita GBE.txt'                                                 = ''      # extensie ignorata
  }
  foreach ($k in $gc.Keys) { Set-Content -LiteralPath (Join-Path $p3 $k) -Value ('x ' + $k) }
  Set-Content -LiteralPath (Join-Path $p3o 'Polita GBE.pdf') -Value 'gbe din oferta'          # exclus (folder Ofertare\Oferta)
  Set-Content -LiteralPath (Join-Path $p3o 'Polita CAR.pdf') -Value 'car din oferta'          # exclus
  Set-Content -LiteralPath (Join-Path $p3o 'AA1 polita CAR.pdf') -Value 'act la car din oferta' # exclus (folder de oferta + nume de act)
  Set-Content -LiteralPath (Join-Path $p3o 'Act aditional 7.pdf') -Value 'act din oferta'     # act (nu e GBE/CAR, ca inainte)
  Set-Content -LiteralPath (Join-Path $p3d ("Poli$tz$ab CAR.pdf")) -Value 'car din oferta'    # exclus (folder cu diacritice)
  Set-Content -LiteralPath (Join-Path $p3c 'Bon.pdf') -Value 'carburant in cale, nu in nume'  # nimic

  "2) lipseste proiecte.tsv -> exit 3"
  $r = Scan; Verifica ($r.cod -eq 3) "exit 3 fara proiecte.tsv (cod=$($r.cod))"

  New-Item -ItemType Directory -Force -Path $baza | Out-Null
  Set-Content -LiteralPath (Join-Path $baza 'proiecte.tsv') -Encoding UTF8 -Value @(
    "id`tcod`tcale",
    "1`tUNU`tOferte/1.TRANSGAZ/114. Proiect unu",
    "2`tDOI`tOferte/2.ALTII/7. Proiect doi",
    "3`tFARA`t",
    "4`tRAU`t../../Windows",
    "5`tABS`tC:/Windows",
    "6`tTREI`tOferte/1.TRANSGAZ/120. Proiect trei")

  "3) parametri refuzati -> exit 5"
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File $scan -Radacina $nas -Baza (Join-Path $nas 'Oferte\iesire') 2>&1
  Verifica ($LASTEXITCODE -eq 5) "Baza sub radacina NAS refuzata (cod=$LASTEXITCODE)"
  $o = & powershell -NoProfile -ExecutionPolicy Bypass -File $scan -Radacina $nas -Baza '\\server\share\x' 2>&1
  Verifica ($LASTEXITCODE -eq 5) "Baza UNC refuzata (cod=$LASTEXITCODE)"

  "4) prima rulare = BASELINE, chei relative"
  $inainte = Instantaneu
  $r = Scan
  Verifica ($r.cod -eq 0) "exit 0 (cod=$($r.cod))"
  Verifica ($r.text -match 'baseline=True \| total de verificat: 16') 'baseline cu 5 acte + 5 GBE + 6 CAR'
  Verifica ($r.text -match 'P3 FARA \| FARA CALE NAS') 'proiect fara cale semnalat'
  Verifica ($r.text -match 'P4 RAU \| CALE REFUZATA') 'cale cu .. refuzata'
  Verifica ($r.text -match 'P5 ABS \| CALE REFUZATA') 'cale absoluta refuzata'
  Verifica ($r.text -match 'P1 UNU \| acte pe NAS: 2 \| GBE: 0 \| CAR: 0 \| excluse \(oferta/participare\): 0 \| de verificat acum: 2') 'rezumat P1 (doar acte)'
  Verifica ($r.text -match 'P6 TREI \| acte pe NAS: 2 \| GBE: 5 \| CAR: 6 \| excluse \(oferta/participare\): 8 \| de verificat acum: 13') 'rezumat P6: GBE/CAR numarate, ofertele excluse numarate (si cele cu nume de act)'
  $st = @(Stare)
  Verifica ($st.Count -eq 16) "stare.tsv are 16 randuri ($($st.Count))"
  Verifica (@($st | Where-Object { $_ -match '^[A-Za-z]:' -or $_.StartsWith('\\') }).Count -eq 0) 'nicio cheie absoluta in stare.tsv'
  Verifica (@($st | Where-Object { $_.StartsWith("Oferte\1.TRANSGAZ\114. Proiect unu\Act aditional 1.pdf`t") }).Count -eq 1) 'cheie relativa la radacina'
  Verifica (@($st | Where-Object { $_ -match "^Oferte\\1\.TRANSGAZ\\114\. Proiect unu\\Act aditional 1\.pdf`t\d+\|[0-9T:-]+$" }).Count -eq 1) 'act: valoarea din stare ramane marime|data (fara sufix)'
  Verifica (@($st | Where-Object { $_ -match '\|gbe$' }).Count -eq 5 -and @($st | Where-Object { $_ -match '\|car$' }).Count -eq 6) 'stare: 5 x |gbe, 6 x |car'
  Verifica (@($st | Where-Object { $_ -match '(oferta|participare)' -and $_ -match '(?i)(polita|garantie)' }).Count -eq 0) 'stare: niciun GBE/CAR de oferta / participare (nici cu nume de act)'
  $l = @(Lista)
  Verifica ((@($l | Where-Object { $_.motiv -eq 'BASELINE' }).Count) -eq 16) 'lista: 16 x BASELINE'
  Verifica (@($l | Where-Object { -not ($_.fisier_local.StartsWith($baza)) }).Count -eq 0) 'copiile locale sunt sub Baza'
  Verifica (@($l | Where-Object { Test-Path -LiteralPath $_.fisier_local }).Count -eq 16) 'copiile locale exista'
  Verifica (@($l | Where-Object { $_.id -ne '6' -and $_.familie -ne 'act' }).Count -eq 0) 'P1/P2: familie=act'
  foreach ($k in $gc.Keys) {
    $rand = @($l | Where-Object { $_.id -eq '6' -and $_.cale_nas -eq (Join-Path $p3 $k) })
    if ($gc[$k] -in @('gbe', 'car', 'act')) { Verifica ($rand.Count -eq 1 -and $rand[0].familie -eq $gc[$k]) "familie $($gc[$k]): $k" }
    else { Verifica ($rand.Count -eq 0) "nu intra in lista ($(if ($gc[$k]) { $gc[$k] } else { 'nimic' })): $k" }
  }
  Verifica (@($l | Where-Object { ($_.cale_nas.StartsWith($p3o) -or $_.cale_nas.StartsWith($p3d) -or $_.cale_nas.StartsWith($p3c)) -and $_.cale_nas -ne (Join-Path $p3o 'Act aditional 7.pdf') }).Count -eq 0) 'din folderele de oferta / Carburant: niciun GBE/CAR (nici "AA1 polita CAR.pdf")'
  $a7 = @($l | Where-Object { $_.cale_nas -eq (Join-Path $p3o 'Act aditional 7.pdf') })
  Verifica ($a7.Count -eq 1 -and $a7[0].familie -eq 'act') 'act aditional obisnuit din folder de oferta: ramane act (ca inainte)'
  $dif = @(Compare-Object $inainte (Instantaneu)); $dif | ForEach-Object { '    dif: ' + $_.SideIndicator + ' ' + $_.InputObject }
  Verifica ($dif.Count -eq 0) 'NAS-ul sintetic neschimbat (nume, marime, data)'

  "5) a doua rulare fara schimbari -> 0 de verificat"
  $r = Scan
  Verifica ($r.cod -eq 0 -and $r.text -match 'baseline=False \| total de verificat: 0') 'nimic nou'

  "5b) fisiere vazute deja ca acte (stare fara sufix) si recunoscute acum ca GBE/CAR -> FAMILIE_NOUA, o singura data"
  $fSt = Join-Path $baza 'stare.tsv'
  $reVechi = 'AA1\.pdf|act aditional 2\.pdf'
  Set-Content -LiteralPath $fSt -Encoding UTF8 -Value (Stare | ForEach-Object { if ($_ -match $reVechi) { $_ -replace '\|(gbe|car)$', '' } else { $_ } })
  Verifica (@(Stare | Where-Object { $_ -match $reVechi -and $_ -notmatch '\|(gbe|car)$' }).Count -eq 2) 'pregatit: 2 randuri in formatul vechi (ca acte)'
  $r = Scan
  Verifica ($r.text -match 'total de verificat: 2') 'doua de verificat'
  $l = @(Lista)
  $fn = @($l | Where-Object { $_.motiv -eq 'FAMILIE_NOUA' })
  Verifica ($fn.Count -eq 2 -and @($fn | Where-Object { $_.familie -eq 'gbe' }).Count -eq 1 -and @($fn | Where-Object { $_.familie -eq 'car' }).Count -eq 1) 'FAMILIE_NOUA: unul gbe, unul car'
  $r = Scan
  Verifica ($r.text -match 'total de verificat: 0') 'a doua oara: nimic (starea are acum sufixul)'

  "6) fisier modificat + fisier nou"
  Start-Sleep -Milliseconds 1100
  Set-Content -LiteralPath (Join-Path $p1 'Act aditional 2 .pdf') -Value 'aa2 semnat, mai lung'
  Set-Content -LiteralPath (Join-Path $p2 'Acord subsecvent 4.pdf') -Value 'as4'
  $r = Scan
  Verifica ($r.text -match 'total de verificat: 2') 'doua de verificat'
  $l = @(Lista)
  Verifica (@($l | Where-Object { $_.motiv -eq 'MODIFICAT' }).Count -eq 1) 'un MODIFICAT'
  Verifica (@($l | Where-Object { $_.motiv -eq 'NOU' }).Count -eq 1) 'un NOU'
  Verifica (@(Stare).Count -eq 17) 'stare.tsv are 17 randuri'

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
    Verifica (($o -join "`n") -match 'de convertit: 17 ') 'preview: 17 de convertit (si randurile |gbe / |car)'
    $o = & python -B $conv --aplica --asteptat 17 --fisier $fSt 2>&1
    Verifica ($LASTEXITCODE -eq 0) "aplica (cod=$LASTEXITCODE)"
    $r = Scan
    Verifica ($r.cod -eq 0 -and $r.text -match 'baseline=False \| total de verificat: 0') 'dupa conversie: nimic nou'
  } else { '  SARIT (python lipseste)'; Set-Content -LiteralPath $fSt -Encoding UTF8 -Value $bun }

  "8) -Toate = BASELINE complet"
  $r = Scan @('-Toate')
  Verifica ($r.text -match 'baseline=True \| total de verificat: 17') 'baseline cu 17 (6 acte + 5 GBE + 6 CAR)'

  "9) lista zilei scrisa de versiunea veche (fara familie) -> antet adus la zi, randurile vechi = act"
  $fL = Join-Path $baza ((Get-Date -Format 'yyyy-MM-dd') + '\lista.tsv')
  Set-Content -LiteralPath $fL -Encoding UTF8 -Value @(
    "id`tcod`tfisier_local`tcale_nas`tkb`tmodificat`tmotiv",
    "1`tUNU`tC:\x\vechi.pdf`tZ:\vechi.pdf`t1`t2026-11-20`tNOU")
  Start-Sleep -Milliseconds 1100
  Set-Content -LiteralPath (Join-Path $p3 'Polita CAR 2025.pdf') -Value 'car prelungita'
  $r = Scan
  Verifica ($r.cod -eq 0 -and $r.text -match 'total de verificat: 1') "o polita CAR modificata (cod=$($r.cod))"
  $txt = @(Get-Content -LiteralPath $fL -Encoding UTF8)
  Verifica ($txt[0] -eq "id`tcod`tfisier_local`tcale_nas`tkb`tmodificat`tmotiv`tfamilie") 'antet cu familie'
  Verifica ($txt[1] -eq "1`tUNU`tC:\x\vechi.pdf`tZ:\vechi.pdf`t1`t2026-11-20`tNOU`tact") 'randul vechi primeste familie=act'
  Verifica ($txt.Count -eq 3 -and $txt[2] -match "`tMODIFICAT`tcar$") 'randul nou: MODIFICAT, car'

  "10) lista zilei cu antet necunoscut -> exit 6, lista si stare.tsv neatinse"
  Set-Content -LiteralPath $fL -Encoding UTF8 -Value @("altceva`tcu`tcoloane")
  Start-Sleep -Milliseconds 1100
  Set-Content -LiteralPath (Join-Path $p3 'Polita CAR 2025.pdf') -Value 'car prelungita din nou'
  $hL = (Get-FileHash -LiteralPath $fL).Hash; $hS = (Get-FileHash -LiteralPath $fSt).Hash
  $r = Scan
  Verifica ($r.cod -eq 6) "exit 6 (cod=$($r.cod))"
  Verifica ((Get-FileHash -LiteralPath $fL).Hash -eq $hL -and (Get-FileHash -LiteralPath $fSt).Hash -eq $hS) 'lista si stare.tsv neatinse'
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
if ($script:esecuri) { "ESECURI: $script:esecuri"; exit 1 } else { 'TOATE TESTELE TREC'; exit 0 }
