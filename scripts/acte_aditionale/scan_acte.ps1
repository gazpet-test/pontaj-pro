# Verificare SAPTAMANALA acte aditionale (task #15, decizia Razvan 03.10.2026; mutata pe serverul AI 13.10.2026, automatizari #69).
# DOAR CITIRE pe Z: - nu scrie, nu muta, nu sterge nimic pe NAS.
# Pornit de Claude (rutina zilnica, ziua VINERI). NU e task programat Windows, NU e in Startup.
# Intrare: <Baza>\proiecte.tsv  (id <TAB> cod <TAB> cale) - exportat de Claude din executie_proiecte (activ) inainte de rulare.
# Iesire:  <Baza>\<AAAA-LL-ZZ>\P<id>\<copii locale>  + lista.tsv + rezumat.txt
# Stare:   <Baza>\stare.tsv (cale <TAB> marime|data) - ce s-a vazut la rularea anterioara.
# Fara stare.tsv (prima rulare) sau cu -Toate = BASELINE: toate actele gasite intra la verificare.
# Datele (copii de acte, preturi) stau in <Baza>, NU in repo.
param([switch]$Toate, [string]$Baza = 'C:\Users\Public\paw-data\acte')
$ErrorActionPreference = 'Continue'
$baza = $Baza
$azi = Get-Date -Format 'yyyy-MM-dd'
$out = Join-Path $baza $azi
$fStare = Join-Path $baza 'stare.tsv'
$fProi = Join-Path $baza 'proiecte.tsv'
if (-not (Test-Path -LiteralPath 'Z:\Oferte')) { 'NAS INDISPONIBIL (Z:\Oferte nu raspunde) - nimic de facut'; exit 2 }
if (-not (Test-Path -LiteralPath $fProi)) { 'LIPSESTE proiecte.tsv - Claude il exporta din ERP inainte de rulare'; exit 3 }
New-Item -ItemType Directory -Force -Path $out | Out-Null
# nume de fisier care arata a act aditional / ajustare / acord subsecvent (ad.?ional prinde si varianta cu diacritice)
$re = '(?i)(act[\s._-]*ad|ad.?ional|(^|[^a-z0-9])AA[\s._-]*\d|majorar|ajustar|acord[\s._-]*subsecvent)'
$ext = '(?i)^\.(pdf|docx?|jpe?g|png|tiff?)$'
$T = "`t"
$vechi = @{}
$baseline = $true
if ((Test-Path -LiteralPath $fStare) -and -not $Toate) {
  foreach ($l in Get-Content -LiteralPath $fStare -Encoding UTF8) { $p = $l.Split($T); if ($p.Count -ge 2) { $vechi[$p[0]] = $p[1] } }
  $baseline = $false
}
$stare = @{}
foreach ($k in $vechi.Keys) { $stare[$k] = $vechi[$k] }
$rez = New-Object System.Collections.Generic.List[string]
$lista = New-Object System.Collections.Generic.List[string]
$lista.Add((@('id','cod','fisier_local','cale_nas','kb','modificat','motiv') -join $T))
$total = 0
foreach ($r in (Import-Csv -LiteralPath $fProi -Delimiter $T -Encoding UTF8)) {
  if (-not $r.cale) { $rez.Add(('P{0} {1} | FARA CALE NAS in ERP (nas_folder_path gol)' -f $r.id, $r.cod)); continue }
  $root = 'Z:\' + ($r.cale -replace '/', '\')
  if (-not (Test-Path -LiteralPath $root)) { $rez.Add(('P{0} {1} | CALE INEXISTENTA pe NAS: {2}' -f $r.id, $r.cod, $root)); continue }
  $fs = @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $re -and $_.Extension -match $ext })
  $n = 0
  foreach ($f in $fs) {
    $val = '{0}|{1}' -f $f.Length, $f.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss')
    if ($vechi.ContainsKey($f.FullName)) {
      if ($vechi[$f.FullName] -eq $val) { continue }
      $motiv = 'MODIFICAT'
    } elseif ($baseline) { $motiv = 'BASELINE' } else { $motiv = 'NOU' }
    $d = Join-Path $out ('P' + $r.id)
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    $rel = $f.FullName.Substring($root.Length + 1)
    $nume = $rel -replace '[\\/:*?"<>|]', '__'
    if ($nume.Length -gt 90) { $nume = $nume.Substring($nume.Length - 90) }  # sub MAX_PATH chiar cu foldere adanci
    # prefix unic din calea NAS completa: doua cai diferite nu mai pot ajunge in acelasi fisier local (Copilot r1 P1-1)
    $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($f.FullName))).Replace('-', '').Substring(0, 16).ToLower()
    $nume = $h + '_' + $nume
    $dest = Join-Path $d $nume
    $copiat = $true
    if ($f.Length -gt 80MB) { $copiat = $false; $motiv = $motiv + '_PREA_MARE_NECOPIAT'; $dest = '-' }  # ramane de verificat de un om
    else {
      try { Copy-Item -LiteralPath $f.FullName -Destination $dest -Force -ErrorAction Stop }
      catch { $copiat = $false; $motiv = $motiv + '_COPIERE_ESUATA'; $dest = '-' }
    }
    # 13.10.2026: un fisier necopiat (eroare sau prea mare) NU intra in stare -> reapare saptamana viitoare (pe laptop se pierdea)
    if ($copiat) { $stare[$f.FullName] = $val }
    $lista.Add((@($r.id, $r.cod, $dest, $f.FullName, [int]($f.Length / 1KB), $f.LastWriteTime.ToString('yyyy-MM-dd'), $motiv) -join $T))
    $n++
  }
  $total += $n
  $rez.Add(('P{0} {1} | acte pe NAS: {2} | de verificat acum: {3}' -f $r.id, $r.cod, $fs.Count, $n))
}
$cap = @("SCANARE $azi $(Get-Date -Format 'HH:mm') | baseline=$baseline | total de verificat: $total", '')
$fRez = Join-Path $out 'rezumat.txt'
$fLista = Join-Path $out 'lista.tsv'
# a doua rulare in aceeasi zi ADAUGA la lista zilei (nu o rescrie)
if (Test-Path -LiteralPath $fLista) {
  if ($lista.Count -gt 1) { Add-Content -LiteralPath $fLista -Value ($lista | Select-Object -Skip 1) -Encoding UTF8 }
  Add-Content -LiteralPath $fRez -Value (@('') + $cap + $rez) -Encoding UTF8
} else {
  Set-Content -LiteralPath $fRez -Value ($cap + $rez) -Encoding UTF8
  Set-Content -LiteralPath $fLista -Value $lista -Encoding UTF8
}
Set-Content -LiteralPath $fStare -Value ($stare.GetEnumerator() | Sort-Object Key | ForEach-Object { $_.Key + $T + $_.Value }) -Encoding UTF8
$cap + $rez
