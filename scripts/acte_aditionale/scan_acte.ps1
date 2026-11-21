# Verificare SAPTAMANALA acte aditionale (task #15, decizia Razvan 03.10.2026; pe serverul AI din 13.10.2026, automatizari #69).
# DOAR CITIRE pe NAS - nu scrie, nu muta, nu sterge nimic acolo.
# Pornit de Claude (rutina zilnica, ziua VINERI) prin Desktop Commander pe serverul AI. NU e task programat Windows, NU e in Startup.
# 16.10.2026: NAS-ul se citeste prin cale UNC (-Radacina), nu prin Z: - procesul DC e elevat si nu vede drive-urile mapate.
#   Credentialul NAS (cont read-only `erp-citire`) e salvat de Razvan cu cmdkey pe server - NU e in repo, scriptul nu-l atinge.
# Intrare: <Baza>\proiecte.tsv  (id <TAB> cod <TAB> cale, cale RELATIVA la radacina NAS) - exportat de Claude din executie_proiecte.
# Iesire:  <Baza>\<AAAA-LL-ZZ>\P<id>\<copii locale>  + lista.tsv + rezumat.txt
# Familii (21.11.2026): pe langa actele aditionale (act) se cauta si garantiile de buna executie (gbe) si politele CAR (car);
#   coloana `familie` din lista.tsv spune ce a recunoscut NUMELE fisierului (Jakarinos stabileste din document ce este de fapt).
#   gbe/car NU se iau din documentele de oferta: cale (sub folderul proiectului) sau nume cu participare / oferta -> exclus, numarat in rezumat.
# Stare:   <Baza>\stare.tsv (cale RELATIVA la radacina <TAB> marime|data[|gbe|car]) - ce s-a vazut la rularea anterioara.
#          Actele raman `marime|data` (ca inainte); gbe/car au sufixul familiei, ca un fisier vazut deja ca act si recunoscut
#          acum ca GBE/CAR sa intre o data la verificare (motiv FAMILIE_NOUA).
#          Formatul vechi (chei Z:\...) se converteste o singura data cu converteste_stare.py; scanarea refuza cheile absolute (exit 4).
# Fara stare.tsv (prima rulare) sau cu -Toate = BASELINE: toate actele gasite intra la verificare.
# Datele (copii de acte, preturi) stau in <Baza>, NU in repo.
# Coduri de iesire: 0 ok | 2 NAS indisponibil | 3 lipseste proiecte.tsv | 4 stare.tsv in format vechi | 5 parametri refuzati
#                   6 lista.tsv a zilei are alt antet (nici cel vechi, nici cel cu `familie`) - lista, rezumatul si stare.tsv raman neatinse
param(
  [switch]$Toate,
  [string]$Radacina = '\\gazpet-tnas\Licitatii_Executate',
  [string]$Baza = 'C:\Users\Public\paw\acte'
)
$ErrorActionPreference = 'Continue'
$T = "`t"

# --- garzi pe parametri: iesirea doar local, niciodata pe NAS ---
$rad = $Radacina.TrimEnd('\', '/')
try { $baza = [IO.Path]::GetFullPath($Baza).TrimEnd('\') } catch { "PARAMETRI REFUZATI: -Baza invalida ($Baza)"; exit 5 }
if ($baza.StartsWith('\\')) { "PARAMETRI REFUZATI: -Baza nu poate fi cale UNC/de retea ($baza)"; exit 5 }
try { $radPlin = [IO.Path]::GetFullPath($rad).TrimEnd('\') } catch { $radPlin = $rad }
if (($baza + '\').StartsWith($radPlin + '\', [StringComparison]::OrdinalIgnoreCase)) { "PARAMETRI REFUZATI: -Baza e sub radacina NAS ($baza)"; exit 5 }

$azi = Get-Date -Format 'yyyy-MM-dd'
$out = Join-Path $baza $azi
$fStare = Join-Path $baza 'stare.tsv'
$fProi = Join-Path $baza 'proiecte.tsv'
if (-not (Test-Path -LiteralPath (Join-Path $rad 'Oferte'))) {
  "NAS INDISPONIBIL ($rad\Oferte nu raspunde) - nimic de facut. Pe server: credentialul erp-citire (cmdkey) si reteaua spre gazpet-tnas."
  exit 2
}
if (-not (Test-Path -LiteralPath $fProi)) { 'LIPSESTE proiecte.tsv - Claude il exporta din ERP inainte de rulare'; exit 3 }

# nume de fisier care arata a act aditional / ajustare / acord subsecvent (ad.?ional prinde si varianta cu diacritice)
$re = '(?i)(act[\s._-]*ad|ad.?ional|(^|[^a-z0-9])AA[\s._-]*\d|majorar|ajustar|acord[\s._-]*subsecvent)'
$ext = '(?i)^\.(pdf|docx?|jpe?g|png|tiff?)$'
# GBE / CAR (21.11.2026): se potrivesc pe numele PLIAT (fara diacritice, litere mici - vezi Pliaza), deci doar ASCII aici.
# Limitele de cuvant sunt pe litere/cifre ([a-z0-9]), nu \b: '_' e separator in numele de fisier (polita_CAR_1.pdf),
# iar 'car' nu prinde carburant / cariera / carte / scara / oscar. Dupa CAR/GBE pot urma cifre (CAR2024), nu litere.
$reGbe = '(?<![a-z0-9])gbe(?![a-z])|garant[a-z]*[\s._-]*(de[\s._-]*)?buna[\s._-]*executi|polit[a-z]*[\s._-]*(de[\s._-]*)?buna[\s._-]*executi|scrisoar[a-z]*[\s._-]*(de[\s._-]*)?garanti|instrument[a-z]*[\s._-]*(de[\s._-]*)?garantar'
$reCar = '(?<![a-z0-9])car(?![a-z])|constructi[a-z]*[\s._-]*(si[\s._-]*)?montaj|all[\s._-]*risk'
# documente de oferta (garantia de participare etc.): doar pe calea DE SUB folderul proiectului (radacina NAS e chiar Oferte\...)
$reOferta = '(?<![a-z0-9])(participar|ofert)[a-z]*'   # participare, oferta, oferte, ofertare, ofertant...
function Pliaza([string]$s) {
  # NFD + scoaterea semnelor combinate (a cu caciula -> a, s/t cu virgula SAU cu sedila -> s/t, i/a cu circumflex -> i/a);
  # merge si pe nume scrise deja descompus (NFD). Fisierul ramane ASCII (PowerShell 5.1 il citeste fara BOM).
  return ([regex]::Replace($s.Normalize([Text.NormalizationForm]::FormD), '\p{Mn}', '')).ToLowerInvariant()
}
function Familie($fisier, [string]$relProiect) {
  # ordinea: gbe -> car -> act (un act aditional LA POLITA e verificat cu regulile GBE/CAR; Jakarinos decide din document)
  # intoarce familia sau 'exclus' (GBE/CAR in document de oferta, fara nume de act) sau '' (nu ne intereseaza)
  $n = Pliaza $fisier.Name
  $gc = ''
  if ($n -match $reGbe) { $gc = 'gbe' } elseif ($n -match $reCar) { $gc = 'car' }
  if ($gc -and -not ((Pliaza $relProiect) -match $reOferta)) { return $gc }
  if ($fisier.Name -match $re) { return 'act' }   # actele: exact regula de dinainte, pe numele brut
  if ($gc) { return 'exclus' }   # (un act aditional dintr-un folder de oferta ramane `act`, ca inainte)
  return ''
}
$vechi = @{}
$baseline = $true
if ((Test-Path -LiteralPath $fStare) -and -not $Toate) {
  foreach ($l in Get-Content -LiteralPath $fStare -Encoding UTF8) {
    $p = $l.Split($T)
    if ($p.Count -lt 2) { continue }
    # chei absolute (Z:\..., \\server\...) = format vechi -> fara conversie, totul ar aparea NOU si s-ar copia din nou
    if ($p[0] -match '^[A-Za-z]:' -or $p[0].StartsWith('\\')) {
      "STARE IN FORMAT VECHI: $fStare are chei absolute (ex. $($p[0].Substring(0, [Math]::Min(40, $p[0].Length)))...). Ruleaza o data: python converteste_stare.py --preview, apoi --aplica."
      exit 4
    }
    $vechi[$p[0]] = $p[1]
  }
  $baseline = $false
}
New-Item -ItemType Directory -Force -Path $out | Out-Null
$stare = @{}
foreach ($k in $vechi.Keys) { $stare[$k] = $vechi[$k] }
$rez = New-Object System.Collections.Generic.List[string]
$lista = New-Object System.Collections.Generic.List[string]
$antet = @('id','cod','fisier_local','cale_nas','kb','modificat','motiv','familie') -join $T
$lista.Add($antet)
$total = 0
foreach ($r in (Import-Csv -LiteralPath $fProi -Delimiter $T -Encoding UTF8)) {
  if (-not $r.cale) { $rez.Add(('P{0} {1} | FARA CALE NAS in ERP (nas_folder_path gol)' -f $r.id, $r.cod)); continue }
  $cale = ($r.cale -replace '/', '\').Trim('\')
  # cale din ERP = date: doar relativa, fara '..' (scanarea nu iese din radacina)
  if ($cale -match '^[A-Za-z]:' -or $cale -match '(^|\\)\.\.(\\|$)' -or $r.cale.StartsWith('\\') -or $r.cale.StartsWith('//')) {
    $rez.Add(('P{0} {1} | CALE REFUZATA (absoluta sau cu ..): {2}' -f $r.id, $r.cod, $r.cale)); continue
  }
  $root = $rad + '\' + $cale
  if (-not (Test-Path -LiteralPath $root)) { $rez.Add(('P{0} {1} | CALE INEXISTENTA pe NAS: {2}' -f $r.id, $r.cod, $root)); continue }
  $fs = New-Object System.Collections.Generic.List[object]
  $fam = @{}
  $nr = @{ act = 0; gbe = 0; car = 0; exclus = 0 }
  foreach ($f in @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match $ext })) {
    # calea DE SUB folderul proiectului (pentru excluderea ofertelor); altfel doar numele
    if ($f.FullName.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { $relP = $f.FullName.Substring($root.Length + 1) } else { $relP = $f.Name }
    $x = Familie $f $relP
    if (-not $x) { continue }
    $nr[$x]++
    if ($x -eq 'exclus') { continue }   # numarat in rezumat, nu dispare tacit
    $fs.Add($f); $fam[$f.FullName] = $x
  }
  $n = 0; $sarite = 0
  foreach ($f in $fs) {
    if (-not $f.FullName.StartsWith($rad + '\', [StringComparison]::OrdinalIgnoreCase)) { $sarite++; continue }  # nu ar trebui sa se intample
    $cheie = $f.FullName.Substring($rad.Length + 1)   # cheia din stare: cale relativa la radacina NAS
    $fx = $fam[$f.FullName]
    $val0 = '{0}|{1}' -f $f.Length, $f.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss')
    $val = $val0
    if ($fx -ne 'act') { $val = $val0 + '|' + $fx }   # actele raman in formatul vechi (fara re-verificari)
    if ($vechi.ContainsKey($cheie)) {
      if ($vechi[$cheie] -eq $val) { continue }
      # acelasi fisier (marime + data), alta familie (ex. vazut ca act, acum GBE) -> o verificare cu regulile familiei noi
      if ((@($vechi[$cheie].Split('|') | Select-Object -First 2) -join '|') -eq $val0) { $motiv = 'FAMILIE_NOUA' } else { $motiv = 'MODIFICAT' }
    } elseif ($baseline) { $motiv = 'BASELINE' } else { $motiv = 'NOU' }
    $d = Join-Path $out ('P' + $r.id)
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    $rel = $f.FullName.Substring($root.Length + 1)
    $nume = $rel -replace '[\\/:*?"<>|]', '__'
    if ($nume.Length -gt 90) { $nume = $nume.Substring($nume.Length - 90) }  # sub MAX_PATH chiar cu foldere adanci
    # prefix unic din cheia relativa: doua cai diferite nu mai pot ajunge in acelasi fisier local (Copilot r1 P1-1)
    $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($cheie))).Replace('-', '').Substring(0, 16).ToLower()
    $nume = $h + '_' + $nume
    $dest = Join-Path $d $nume
    $copiat = $true
    if ($f.Length -gt 80MB) { $copiat = $false; $motiv = $motiv + '_PREA_MARE_NECOPIAT'; $dest = '-' }  # ramane de verificat de un om
    else {
      try { Copy-Item -LiteralPath $f.FullName -Destination $dest -Force -ErrorAction Stop }
      catch { $copiat = $false; $motiv = $motiv + '_COPIERE_ESUATA'; $dest = '-' }
    }
    # 13.10.2026: un fisier necopiat (eroare sau prea mare) NU intra in stare -> reapare saptamana viitoare
    if ($copiat) { $stare[$cheie] = $val }
    $lista.Add((@($r.id, $r.cod, $dest, $f.FullName, [int]($f.Length / 1KB), $f.LastWriteTime.ToString('yyyy-MM-dd'), $motiv, $fx) -join $T))
    $n++
  }
  $total += $n
  $rez.Add(('P{0} {1} | acte pe NAS: {2} | GBE: {3} | CAR: {4} | excluse (oferta/participare): {5} | de verificat acum: {6}' -f $r.id, $r.cod, $nr.act, $nr.gbe, $nr.car, $nr.exclus, $n))
  if ($sarite) { $rez.Add(('P{0} {1} | ATENTIE: {2} fisiere sarite (calea nu incepe cu radacina {3})' -f $r.id, $r.cod, $sarite, $rad)) }
}
$cap = @("SCANARE $azi $(Get-Date -Format 'HH:mm') | radacina=$rad | baseline=$baseline | total de verificat: $total", '')
$fRez = Join-Path $out 'rezumat.txt'
$fLista = Join-Path $out 'lista.tsv'
# a doua rulare in aceeasi zi ADAUGA la lista zilei (nu o rescrie)
if (Test-Path -LiteralPath $fLista) {
  # lista zilei scrisa de versiunea fara `familie` (doar acte): o aducem la antetul nou, randurile vechi primesc `act`
  $vechiL = @(Get-Content -LiteralPath $fLista -Encoding UTF8)
  $antetVechi = @('id','cod','fisier_local','cale_nas','kb','modificat','motiv') -join $T
  if ($vechiL.Count -and $vechiL[0] -ne $antet -and $vechiL[0] -ne $antetVechi) {
    # stare.tsv NU se scrie -> fisierele de azi reapar la rularea urmatoare (nimic pierdut)
    "LISTA CU ANTET NECUNOSCUT: $fLista - nu adaug la ea. Muta fisierul deoparte si ruleaza din nou."
    exit 6
  }
  if ($vechiL.Count -and $vechiL[0] -eq $antetVechi) {
    Set-Content -LiteralPath $fLista -Encoding UTF8 -Value (@($antet) + @($vechiL | Select-Object -Skip 1 | Where-Object { $_ -match '\S' } | ForEach-Object { $_ + $T + 'act' }))
  }
  if ($lista.Count -gt 1) { Add-Content -LiteralPath $fLista -Value ($lista | Select-Object -Skip 1) -Encoding UTF8 }
  Add-Content -LiteralPath $fRez -Value (@('') + $cap + $rez) -Encoding UTF8
} else {
  Set-Content -LiteralPath $fRez -Value ($cap + $rez) -Encoding UTF8
  Set-Content -LiteralPath $fLista -Value $lista -Encoding UTF8
}
Set-Content -LiteralPath $fStare -Value ($stare.GetEnumerator() | Sort-Object Key | ForEach-Object { $_.Key + $T + $_.Value }) -Encoding UTF8
$cap + $rez
exit 0
