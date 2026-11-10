# DialogTgz.psm1 - logica sarcinii "Gazpet Dialog TGZ" (varianta B: token `claude setup-token`, fara conectori).
# Fisier ASCII (PowerShell 5.1 citeste .psm1 fara BOM ca ANSI). Textele cu diacritice stau in raspuns_schema.json (UTF-8)
# sau se construiesc cu [char]. Functiile pure sunt testate offline in teste\test_dialog_tgz.ps1; Invoke-DialogTgz primeste
# psql / claude / log ca scriptblock-uri, ca fluxul complet sa poata fi rulat in test fara retea.
#
# r2 (Jakarinos r1): ERP doar-citire, cursor local, agentul scrie doar in folderul privat al rularii, publicarea e a
#   orchestratorului, timeout / cod nenul / JSON fara succes = EROARE.
# r3 (Jakarinos r2): raspuns.json cu campuri fixe (raspuns_schema.json), claude#NNN.md compus de orchestrator, publicare
#   exclusiva + mutare la coliziune de numar, Job Object, reconciliere publicare / cursor prin "Cheie:".
# r4 (Jakarinos r3): fara camp de text liber; recuperarea coliziunii si pentru un OPRIT deja publicat.
# r5 (Jakarinos r4): IESIREA UNICA. Tot ce ajunge in claude#NNN.md, in jurnal, in fisierele de stare (ultima linie,
#   cursor, marcaj de procese), in context.md al agentului sau pe stdout trece prin Format-Mesaj: un sablon FIX din
#   catalogul de mai jos + valori tipizate (numar, data, bool, cod dintr-o lista inchisa definita aici, celula de export
#   validata pe formatul coloanei, text deja compus de Format-Mesaj). Orice alt text (export ERP, nume de fisiere, mesaje
#   de eroare ale uneltelor, cai, stdout / stderr psql si claude, variabile de mediu) nu are tip acceptat: in locul lui
#   se scrie un contor, un cod sau o lungime. Scrierile pe disc (Write-FisierSigur, Publish-RaspunsExclusiv) primesc DOAR
#   obiecte produse de Format-Mesaj; testul verifica static ca alte apeluri de scriere nu exista.
# - Exportul ERP: fiecare coloana are un format in $script:FormatColoane (lista inchisa sau tipar strict, ancorat); o
#   valoare care nu il respecta devine "nevalidat-N" la citire, inainte de orice folosire (context, filtre, tabel).
#   Coloana uat (numele UAT, text liber in BD) e scoasa din export.
# - Erorile proprii: Stop-Dtgz <cod> <numere>; orice alta exceptie = "eroare neprevazuta" (categorie, HRESULT, lungime).
# - Folderul rularii (context, raspuns.json, configuratia CLI) se sterge la orice iesire; resturile, la pornire.
# - Schema raspunsului e fixata prin amprenta (sha256, fara CR) in acest modul: textele ei sunt texte fixe.

Set-StrictMode -Version 2.0

$script:Utf8FaraBom = New-Object System.Text.UTF8Encoding($false)
$script:Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$script:Inv = [System.Globalization.CultureInfo]::InvariantCulture
$script:A_breve = [string][char]0x0103   # a cu caciula (din "programata")
$script:TiparNume = '^(juridic|claude)#([0-9]{3})\.md$'
$script:TiparCursor = '^juridic#([0-9]{3})(?: \(raspuns claude#[0-9]{3}, [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\))?$'
$script:TiparIdRulare = '^(?:[0-9]{8}_[0-9]{6}-[0-9]{1,10}|[0-9a-f]{32})\z'
$script:MaxRaspunsOcteti = 200 * 1024   # serverul juridic citeste cel mult 200 KB dintr-un claude#NNN.md
$script:NumeRaspunsAgent = 'raspuns.json'
$script:AntetDeLa = 'De la: Claude Code (verificare programat' + $script:A_breve + ' Dialog TGZ)'
$script:TiparTemporar = '^_dialog_tgz_[0-9a-f]{32}\.tmp$'
$script:TipTextSigur = 'DialogTgz.TextSigur'
# sha256 al raspuns_schema.json (UTF-8, fara CR). Schimbarea contractului = PR care schimba si aceasta amprenta.
$script:AmprentaSchema = '9338ce39f0d07cfc96b62271fc425e43fd789854b7be76e847875010d27787dc'

# ---------------------------------------------------------------- utilitare

function Get-Sha256Octeti {
  param([Parameter(Mandatory)][AllowEmptyCollection()][byte[]]$Octeti)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return (($sha.ComputeHash($Octeti) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $sha.Dispose() }
}

function Get-Sha256Fisier {
  param([Parameter(Mandatory)][string]$Cale)
  return (Get-Sha256Octeti ([System.IO.File]::ReadAllBytes($Cale)))
}

function Read-TextUtf8 {
  param([Parameter(Mandatory)][string]$Cale)
  $t = [System.IO.File]::ReadAllText($Cale, $script:Utf8FaraBom)
  if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
  return $t
}

function Test-Intreg {
  param([AllowNull()]$V)
  return (($V -is [int]) -or ($V -is [long]))
}

function Format-NumarInvariant {
  param([decimal]$Valoare)
  return $Valoare.ToString('0.##', $script:Inv)
}

# Date personale: ULTIMA bariera (pe fiecare text produs de Format-Mesaj). Bariera principala = tipurile din sabloane.
$script:TipareDatePersonale = @(
  @{ Cod = 'EMAIL';   Tipar = '[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}' },
  @{ Cod = 'TELEFON'; Tipar = '(?<![0-9A-Za-z+])(?:\+40|0040|0)[ .\-]?[237](?:[ .\-]?[0-9]){8}(?![0-9A-Za-z])' },
  @{ Cod = 'TELEFON'; Tipar = '\(0[23][0-9]{2}\)[ .\-]?[0-9]{3}[ .\-]?[0-9]{3}(?![0-9])' },
  @{ Cod = 'CNP';     Tipar = '(?<![0-9A-Za-z])[1-9][0-9]{12}(?![0-9A-Za-z])' },
  @{ Cod = 'ACT_IDENTITATE'; Tipar = '(?i)(?<![\p{L}])seri[ae][ :]*[A-Z]{2}[ ,]*(?:nr\.?|num\p{L}r)?[ :]*[0-9]{6}(?![0-9])' },
  @{ Cod = 'ADRESA';  Tipar = '(?i)(?<![\p{L}])(?:str\.|strada|bd\.|bdul\.?|bulevardul|calea|aleea|\p{L}os\.|\p{L}oseaua|sat(?:ul)?)[ ]+[^\r\n]{1,60}?(?<![\p{L}])nr\.?[ ]*[0-9]{1,4}' },
  @{ Cod = 'ADRESA';  Tipar = '(?i)(?<![\p{L}])(?:bl\.|bloc)[ ]*[A-Z0-9]{1,4}[ ,]+(?:sc\.|scara)[ ]*[A-Z0-9]{1,3}' },
  @{ Cod = 'ADRESA';  Tipar = '(?i)(?<![\p{L}])ap\.[ ]*[0-9]{1,4}(?![0-9])' }
)
foreach ($x in $script:TipareDatePersonale) { $x.Regex = New-Object System.Text.RegularExpressions.Regex($x.Tipar) }

# Intoarce codurile gasite (sortate, unice; apelantul pune @()); nimic = nimic gasit.
function Find-DatePersonale {
  param([AllowNull()][AllowEmptyString()][string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return }
  $coduri = @()
  foreach ($x in $script:TipareDatePersonale) { if ($x.Regex.IsMatch($Text)) { $coduri += $x.Cod } }
  return ($coduri | Sort-Object -Unique)
}

# ---------------------------------------------------------------- exportul ERP: formatul fiecarei coloane (lista inchisa)

# Valori permise pe coloanele de tip "lista" (din CHECK-urile BD: 20261126a, 20261129h; proiectele = codurile reale ale
# proiectelor Redari TGZ). Un proiect nou in dialog = PR care il adauga aici.
$script:ValoriInchise = @{
  proiect         = @('LOT1-PRUNISOR-JUPA', 'TEST-RAZVAN')
  stare_lot       = @('in_curs', 'finalizat', 'esuat')
  calitate        = @('proprietar', 'coproprietar', 'mostenitor', 'arendas', 'utilizator', 'neidentificat')
  stare_coresp    = @('draft', 'la_avocat', 'aprobat', 'trimis', 'raspuns_primit', 'anulat')
  cuvant_versiune = @('TGZ', 'TEST', 'LOT', 'utilizatori', 'necunoscuta')
}

# Sectiunea N din sql\context_agregat.sql -> coloanele EXACTE, in ordine, cu formatul fiecareia.
$script:FormatColoane = @{
  1 = [ordered]@{ proiect = 'proiect'; versiune_lista_tgz = 'versiune_lista'; stare = 'stare_lot'; creat = 'data_ora'
                  randuri_total = 'intreg'; parcele_noi = 'intreg'; detinatori_noi = 'intreg'; dubluri = 'intreg'; neidentificati = 'intreg' }
  2 = [ordered]@{ proiect = 'proiect'; uat3 = 'uat3'; parcele = 'intreg'; fara_nr_cadastral = 'intreg'; fara_tarla = 'intreg'
                  fara_tronson = 'intreg'; verificate = 'intreg'; suprafata_temporara_mp = 'zecimal2'; parcele_sterse = 'intreg' }
  3 = [ordered]@{ proiect = 'proiect'; uat3 = 'uat3'; calitate = 'calitate'; detinatori = 'intreg'; decedati = 'intreg'
                  act_doveditor_da = 'intreg'; act_doveditor_nu = 'intreg'; parcele_acoperite = 'intreg' }
  4 = [ordered]@{ proiect = 'proiect'; uat3 = 'uat3'; parcele_fara_detinator = 'intreg' }
  5 = [ordered]@{ proiect = 'proiect'; uat3 = 'uat3'; detinatori_activi = 'intreg'; cu_fisa_contact = 'intreg'; adresa_necunoscuta = 'intreg'
                  cu_strada = 'intreg'; cu_comuna = 'intreg'; cu_cod_postal = 'intreg'; cu_telefon = 'intreg'; cu_email = 'intreg' }
  6 = [ordered]@{ proiect = 'proiect'; stare = 'stare_coresp'; bucati = 'intreg' }
  7 = [ordered]@{ proiect = 'proiect'; cod = 'cod_coresp'; ordine = 'intreg'; stare = 'stare_coresp'; versiune = 'intreg'
                  aprobat_la = 'data'; trimis_la = 'data'; are_nr_inregistrare = 'bool_pg'; modificat = 'data_ora' }
}

function Test-DataIso {
  param([string]$V, [string]$Format, [string]$Tipar)
  if ($V -cnotmatch $Tipar) { return $false }
  $d = [datetime]::MinValue
  return [datetime]::TryParseExact($V, $Format, $script:Inv, [System.Globalization.DateTimeStyles]::None, [ref]$d)
}

# versiune_lista_tgz (text liber in BD): 1-4 cuvinte separate de cate un spatiu, fiecare din lista inchisa
# (TGZ, TEST, LOT, utilizatori, necunoscuta), v<1-2 cifre>, an 2020-2039 sau data ZZ.LL.AAAA din 2020-2039; cel mult 40.
# Exemple reale: "TGZ 13.07.2026", "TGZ 13.07.2026 utilizatori", "v2", "necunoscuta". Un nume, o strada sau un numar
# de telefon nu au cum sa treaca (cuvinte in afara listei, cifre in alta forma).
function Test-VersiuneLista {
  param([string]$V)
  if ($V.Length -lt 1 -or $V.Length -gt 40) { return $false }
  $cuv = $V.Split(' ')
  if ($cuv.Count -gt 4) { return $false }
  foreach ($c in $cuv) {
    if ($script:ValoriInchise.cuvant_versiune -ccontains $c) { continue }
    if ($c -cmatch '^v[0-9]{1,2}\z' -or $c -cmatch '^20[23][0-9]\z') { continue }
    if (Test-DataIso $c 'dd.MM.yyyy' '^[0-3][0-9]\.[01][0-9]\.20[23][0-9]\z') { continue }
    return $false
  }
  return $true
}

function Test-ValoareFormat {
  param([Parameter(Mandatory)][string]$Format, [AllowNull()][AllowEmptyString()][string]$V)
  if ($null -eq $V) { return $false }
  switch ($Format) {
    'intreg'         { return ($V -cmatch '^(?:0|[1-9][0-9]{0,8})\z') }
    'zecimal2'       { return ($V -cmatch '^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?\z') }
    'uat3'           { return ($V -cmatch '^[A-Z]{3}\z') }
    'cod_coresp'     { return ($V -cmatch '^[A-Z][0-9]{1,2}\z') }
    'bool_pg'        { return ($V -ceq 't' -or $V -ceq 'f') }
    'data'           { return (Test-DataIso $V 'yyyy-MM-dd' '^20[23][0-9]-[01][0-9]-[0-3][0-9]\z') }
    'data_ora'       { return (Test-DataIso $V 'yyyy-MM-dd HH:mm' '^20[23][0-9]-[01][0-9]-[0-3][0-9] [0-2][0-9]:[0-5][0-9]\z') }
    'versiune_lista' { return (Test-VersiuneLista $V) }
  }
  if ($script:ValoriInchise.ContainsKey($Format)) { return ($script:ValoriInchise[$Format] -ccontains $V) }
  return $false
}

function New-Celula {
  param([int]$S, [string]$C, [string]$V)
  return @{ S = $S; C = $C; V = $V }
}

# Celula de export publicabila: sectiune + coloana din FormatColoane, valoare '-' / nevalidat-N / conforma formatului.
function Test-Celula {
  param([AllowNull()]$X)
  if (-not ($X -is [hashtable]) -or $X.Count -ne 3) { return $false }
  $s = $X['S']; $c = $X['C']; $v = $X['V']
  if (-not ($s -is [int]) -or -not ($c -is [string]) -or -not ($v -is [string])) { return $false }
  if (-not $script:FormatColoane.ContainsKey($s)) { return $false }
  $fc = $script:FormatColoane[$s]
  if (@($fc.Keys) -cnotcontains $c) { return $false }
  if ($v -ceq '-' -or $v -cmatch '^nevalidat-[1-9][0-9]{0,3}\z') { return $true }
  return (Test-ValoareFormat $fc[$c] $v)
}

# ---------------------------------------------------------------- IESIREA UNICA: liste inchise, catalogul de sabloane

# Listele inchise (definite aici). Cele din schema (motive, cereri, de_decis, sectiuni) se inregistreaza la incarcarea
# schemei, dupa verificarea amprentei.
$script:Liste = @{
  model         = @('claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1')
  effort        = @('low', 'medium', 'high')
  stare_agent   = @('GATA', 'OPRIT', 'EROARE')
  cli_type      = @('result', 'alt', 'lipsa')
  cli_subtype   = @('success', 'error_max_turns', 'error_during_execution', 'error_max_budget_usd', 'error_max_structured_output_retries', 'alt', 'lipsa')
  cli_bool      = @('true', 'false', 'alt', 'lipsa')
  motiv_cli     = @('stdout_gol', 'stdout_nu_e_json', 'stdout_lista', 'fara_type_result', 'fara_succes', 'is_error')
  clasa_psql    = @('garda_scriere', 'garda_vizibil', 'garda_read_only', 'autentificare', 'timeout_conexiune', 'conexiune', 'eroare_sql', 'necunoscut')
  proces        = @('psql', 'claude')
  etapa_lansare = @('job', 'creare_proces', 'asignare_job', 'reluare', 'asteptare', 'necunoscuta')
  tip_exceptie  = @('io', 'acces', 'argument', 'format', 'operatie', 'win32', 'powershell', 'alta')
  motiv_raspuns = @('prea_mare', 'utf8_invalid', 'gol', 'json_invalid', 'nu_e_obiect', 'campuri_in_afara_contractului',
                    'camp_obligatoriu_lipsa', 'nu_e_intreg', 'in_afara_intervalului', 'cod_nepermis', 'nu_e_lista', 'peste_limita',
                    'mesaj_neprocesat', 'mesaj_repetat', 'numar_mesaje', 'filtru_nu_e_obiect', 'filtru_chei_straine',
                    'filtru_fara_proiect', 'filtru_nu_e_text', 'filtru_inexistent', 'filtru_randuri', 'prea_multe_zecimale',
                    'numeric_pe_text', 'text_inexistent', 'tip_nepermis', 'comparatie_repetata', 'cod_repetat',
                    'motiv_la_stare_gresita', 'eroare_interna')
  campuri       = @()
}
$script:CampuriContract = @('raspuns', 'stare', 'mesaje', 'motiv_oprire', 'motiv_eroare', 'juridic', 'cerere', 'verificari', 'sectiune',
                            'filtru', 'indicator', 'valoare_juridic', 'neverificabile', 'atasamente', 'citite', 'negasite_local',
                            'in_afara_radacinilor', 'de_decis')
$script:Liste.campuri = $script:CampuriContract
$script:Liste.coloane = @($script:FormatColoane.Values | ForEach-Object { @($_.Keys) } | Sort-Object -Unique)
$script:Etichete = @{}

# Catalogul: id -> text fix cu sloturi {i:tip}. Tipuri: n (intreg), nn (intreg sau "necunoscut"), n3 (000-999),
# j / c / cmd (numere -> juridic#NNN / claude#NNN / claude#NNN.md), z (zecimal), b (da/nu), t / t2 / ti (data),
# x (cheie hex 32), sqln (SQLSTATE sau "necunoscut"), id (id de rulare), k.<lista> (cod din lista), kl.<lista> (coduri
# separate de |), e.<lista> (eticheta codului, din schema fixata), cale (cale de camp din contract), ve (celula de export),
# vj (numar / celula / gol), filtru si vel (liste de celule), ts / tsl (text / linii deja compuse de Format-Mesaj).
$script:Sabloane = New-Object System.Collections.Hashtable ([System.StringComparer]::Ordinal)
$script:CatalogFix = @{
  'gol' = ''
  'doc' = "{0:tsl}`n"
  # jurnal si starea
  'j.linie' = '{0:t2} [{1:id}] {2:ts}'
  's.linie' = '{0:t2} {1:ts}'
  'j.start' = 'start (Dialog TGZ r5, iesire unica)'
  'j.lock_ocupat' = 'alta rulare Dialog TGZ este in curs (lock ocupat); ies fara sa ating starea'
  'j.final' = 'final: {0:ts} (cod iesire {1:n})'
  'j.marcaj_sters' = 'marcaj de oprire neconfirmata gasit; procesele au disparut, marcajul s-a sters'
  'j.token_ok' = 'token: prezent, format sk-ant-oat01- corect (valoarea nu se scrie in log)'
  'j.cursor' = 'cursor: ultimul procesat {0:j}'
  'j.temporare_sterse' = 'temporare proprii ramase in dialog, sterse: {0:n}'
  'j.rulari_sterse' = 'foldere de rulare ramase de la rulari anterioare, sterse: {0:n}'
  'j.coliziune' = 'coliziune de numar rezolvata: {0:c} -> {1:c}'
  'j.coliziune_oprit' = 'coliziune de numar rezolvata (OPRIT): {0:c} -> {1:c}'
  'j.reconciliere' = 'reconciliere: {0:c} era deja publicat pentru {1:j}; cursor avansat fara rulare noua: {2:ts}'
  'j.nimic_nou' = 'niciun juridic#NNN nou cu antet (verificare programata); Claude nu porneste'
  'j.oprit_deja' = 'OPRIT deja publicat pentru exact aceleasi mesaje ({0:cmd}); nu se reia'
  'j.fisiere_noi' = 'fisiere noi: {0:j}; cheie {1:x}'
  'j.export_inlocuite' = 'export: sectiunea {0:n}, coloana {1:k.coloane}: {2:n} valori fara formatul coloanei, inlocuite cu nevalidat-N'
  'j.context' = 'context agregat scris: {0:n} sectiuni, {1:n} randuri (doar valori validate)'
  'j.radacini' = 'radacini atasamente accesibile: {0:n} din {1:n} (caile nu se jurnalizeaza)'
  'j.pornesc_claude' = 'pornesc claude -p: model {0:k.model}, effort {1:k.effort}, max-turns {2:n}'
  'j.claude_cod' = 'claude: cod iesire {0:n}'
  'j.claude_timeout' = 'claude: cod iesire {0:n} (TIMEOUT, job oprit; confirmat: {1:b})'
  'j.claude_orfani' = 'claude: {0:n} procese copil ramase la iesire, oprite odata cu jobul'
  'j.lansare' = '{0:k.proces}: lansare esuata la etapa {1:k.etapa_lansare} (cod Win32 {2:n})'
  'j.claude_stderr' = 'claude stderr: {0:n} caractere (continutul nu se jurnalizeaza)'
  'j.claude_rezultat' = 'claude rezultat: {0:ts}'
  'j.dialog_atins' = 'dialog atins in timpul rularii: {0:n} sterse, {1:n} modificate, {2:n} noi (numele nu se jurnalizeaza)'
  'j.raspuns_respins' = 'raspuns.json respins: {0:ts}'
  'j.raspuns_valid' = 'raspuns.json valid: stare {0:k.stare_agent}, {1:n} mesaje'
  'j.publicat' = 'publicat {0:c} (raspuns la {1:j})'
  'j.mutat' = 'coliziune cu un juridic# cu acelasi numar: raspunsul mutat pe {0:c}'
  'j.oprit_cursor' = 'OPRIT: cursorul nu se muta; aceleasi mesaje nu se mai reiau cat timp au acelasi continut (cheie)'
  'j.cursor_scris' = 'cursor: {0:ts}'
  'j.rulare_nestearsa' = 'folderul rularii nu s-a putut sterge acum; se sterge la pornirea rularii urmatoare'
  'cli.desc' = 'type={0:k.cli_type}, subtype={1:k.cli_subtype}, is_error={2:k.cli_bool}, num_turns={3:nn}'
  # rezultatul rularii (starea + ultima linie)
  'r.eroare' = 'EROARE {0:ts}'
  'r.gata' = 'GATA {0:c}'
  'r.gata_reconciliat' = 'GATA {0:c} (reconciliat: publicat anterior, cursor avansat acum)'
  'r.nimic_nou' = 'NIMIC NOU (ultimul procesat {0:j})'
  'r.oprit' = 'OPRIT {0:k.motive_oprire} ({1:cmd})'
  'r.oprit_deja' = 'OPRIT deja publicat ({0:cmd}); astept decizia chat-ului / lui Razvan'
  'r.export' = 'EROARE exportul ERP nu se potriveste contractului: {0:ts}'
  'r.nepublicat' = 'EROARE raspuns nepublicat: {0:ts}'
  'r.publicat_coliziune' = 'EROARE raspunsul e publicat, dar numarul lui se ciocneste cu un juridic#: {0:ts}; cursorul nu avanseaza, reconcilierea se reia la rularea urmatoare'
  'r.cursor_dupa_publicare' = 'EROARE {0:cmd} publicat, dar cursorul nu s-a mutat: {1:ts}; rularea urmatoare reconciliaza'
  # motivul respingerii raspuns.json: cod + calea campului (nume din contract / schema, indici), niciodata valoarea
  'v.ok' = 'valid'
  'v.motiv' = '{0:k.motiv_raspuns} la {1:cale}'
  'v.motiv_nr' = '{0:k.motiv_raspuns} la {1:cale} ({2:n})'
  # erorile (Stop-Dtgz <cod> <numere> -> 'e.<cod>'; prin exceptie trec doar numere)
  'e.neprevazuta' = 'eroare neprevazuta (categorie {0:k.tip_exceptie}, HRESULT {1:n}, mesaj de {2:n} caractere, nescris)'
  'e.iesire_refuzata' = 'iesire refuzata: o valoare nu are tipul cerut de sablon'
  'e.iesire_nesigura' = 'iesire refuzata: text care nu vine din Format-Mesaj'
  'e.sablon_necunoscut' = 'sablon de mesaj necunoscut'
  'e.intrerupta' = 'rulare intrerupta'
  'e.model' = 'modelul din configurare nu e in lista modelelor permise din modul'
  'e.effort' = 'effort in afara listei permise'
  'e.config_numar' = 'MaxTurns / TimeoutMin trebuie sa fie numere intregi'
  'e.psql_lipsa' = 'psql lipseste (calea din configurare)'
  'e.pguser' = 'utilizatorul Postgres din configurare poate scrie; sarcina cere rolul doar-citire'
  'e.claude_lipsa' = 'executabilul claude nu a fost gasit'
  'e.token_lipsa' = 'token lipsa: fisierul de token nu exista (claude setup-token)'
  'e.token_format' = 'token in format gresit: nu incepe cu sk-ant-oat01- sau contine caractere nepermise'
  'e.dialog_lipsa' = 'folderul de dialog lipseste sau e legatura'
  'e.schema_json' = 'raspuns_schema.json nu se poate citi (UTF-8 / JSON)'
  'e.schema_amprenta' = 'raspuns_schema.json nu are amprenta fixata in modul (contractul se schimba doar prin PR)'
  'e.schema_versiune' = 'raspuns_schema.json: versiune necunoscuta (astept 3)'
  'e.schema_nota' = 'raspuns_schema.json: campul de text liber (nota) e retras si nu se poate reactiva'
  'e.schema_coloana' = 'raspuns_schema.json: sectiunea {0:n} foloseste o coloana fara format in modul'
  'e.cursor_lipsa' = 'cursorul lipseste (se creeaza la instalare cu "juridic#NNN")'
  'e.cursor_randuri' = 'cursorul are {0:n} randuri nevide (astept 1)'
  'e.cursor_format' = 'cursor in format necunoscut'
  'e.cursor_valori' = 'cursor: numere in afara intervalului 1..999'
  'e.cursor_inapoi' = 'cursorul nu poate da inapoi: {0:j} -> {1:j}'
  'e.cursor_schimbat' = 'cursorul s-a schimbat intre timp (citit {0:j}, acum {1:j}); nu se suprascrie'
  'e.cursor_neverificat' = 'cursorul nu s-a putut verifica dupa scriere'
  'e.marcaj_format' = 'marcaj de procese in format necunoscut'
  'e.procese_vii' = 'procese din rularea anterioara inca active sau necunoscute ({0:n} active; necunoscut: {1:b}); nu pornesc'
  'e.numerotare_999' = 'numerotarea dialogului a atins 999'
  'e.cheie_invalida' = 'cheie de intentie invalida'
  'e.stare_nepublicabila' = 'starea raspunsului nu se publica'
  'e.numar_liber' = 'nu am gasit un numar claude#NNN liber dupa {0:n} incercari'
  'e.raspuns_disparut' = 'raspunsul {0:c} nu mai exista'
  'e.coliziune_nerezolvata' = 'coliziune nerezolvata: juridic#{0:n3} si claude#{0:n3} dupa {1:n} incercari de mutare'
  'e.mutare_esuata' = 'mutarea {0:c} -> {1:c} a esuat'
  'e.gata_multiple' = 'mai multe raspunsuri GATA nereconciliate ({0:cmd}); de verificat de chat'
  'e.gata_neacoperit' = '{0:cmd} (publicat anterior) nu acopera {1:j}, aparute intre timp cu numar mai mic; de decis de chat'
  'e.oprit_coliziune' = 'OPRIT publicat anterior ({0:cmd}), dar numarul lui se ciocneste cu un juridic#: {1:ts}; de reparat manual'
  'e.id_rulare' = 'IdRulare invalid'
  'e.folder_rulare_exista' = 'folderul rularii exista deja'
  'e.psql_oprire' = 'oprirea procesului psql nu s-a putut confirma; marcaj scris, rularile urmatoare asteapta'
  'e.psql' = 'psql export context: cod {0:n}, {1:k.clasa_psql}, SQLSTATE {2:sqln}, stderr de {3:n} caractere (nescris)'
  'e.export_sect_necunoscuta' = 'export: sectiunea {0:n} nu e in contract'
  'e.export_sect_dubla' = 'export: sectiunea {0:n} apare de doua ori'
  'e.export_fara_tabel' = 'export: sectiunea {0:n} fara tabel'
  'e.export_antet' = 'export: sectiunea {0:n}, antetul nu e exact lista de coloane din modul'
  'e.export_rand' = 'export: sectiunea {0:n}, rand cu {1:n} coloane in loc de {2:n}'
  'e.export_neinchis' = 'export: sectiunea {0:n} neinchisa'
  'e.export_lipsa_sect' = 'export: lipseste sectiunea {0:n}'
  'e.export_prea_multe' = 'export: sectiunea {0:n} are prea multe valori nevalidate distincte'
  'e.claude_oprire' = 'oprirea procesului claude nu s-a putut confirma ({0:n} procese ramase); marcaj scris, rularile urmatoare asteapta'
  'e.claude_timeout' = 'claude a depasit {0:n} min (oprit); nimic publicat'
  'e.claude_cod' = 'claude a iesit cu codul {0:n}; nimic publicat'
  'e.claude_cod_lipsa' = 'claude: codul de iesire lipseste; nimic publicat'
  'e.claude_rezultat' = 'claude: rezultat fara succes ({0:k.motiv_cli}); nimic publicat'
  'e.iesire_straine' = 'in folderul de iesire sunt si alte elemente ({0:n}); nimic publicat'
  'e.fara_raspuns' = 'agentul nu a scris raspuns.json'
  'e.dialog_schimbat' = 'folderul de dialog s-a schimbat in timpul rularii ({0:n} sterse, {1:n} modificate, {2:n} noi; numele nu se scriu); nimic publicat'
  'e.juridic_schimbat' = '{0:j} s-a schimbat in timpul rularii; nimic publicat'
  'e.tarzii' = 'au aparut in timpul rularii mesaje cu numar mai mic decat cel procesat ({0:j}); reiau la rularea urmatoare'
  'e.agent_eroare' = 'agentul: {0:k.motive_eroare} (nepublicat)'
  'e.publicat_tipare' = 'tipare de date personale in textul compus; de verificat de chat'
  'e.prea_mare' = 'raspunsul compus depaseste 200 KB'
  'e.prompt_marcaj' = 'marcaj necompletat in prompt'
  'e.cale_fara_disc' = 'cale fara litera de disc'
  # contextul pentru agent (doar valori validate)
  'c.titlu' = '# Context Redari TGZ - cifre agregate'
  'c.generat' = 'Generat: {0:t} (doar SELECT, fara nume / telefoane / adrese / CNP). Tabele: antet + randuri, coloane separate prin |, - = gol; o valoare care nu respecta formatul coloanei apare ca nevalidat-N.'
  'c.sectiune' = '## {0:n}. {1:e.sectiuni}'
  'c.cod' = '```'
  'c.antet' = '{0:kl.coloane}'
  'c.rand' = '{0:vel}'
  # fisierele de stare
  'cursor' = 'juridic#{0:n3} (raspuns claude#{1:n3}, {2:t})'
  'm.pid' = '{0:n}|{1:n}'
  'm.necunoscut' = 'necunoscut'
  # raspunsul publicat: partile fixe din modul (etichetele vin din schema fixata prin amprenta, la Register-Schema)
  'p.de_la' = $script:AntetDeLa
  'p.data' = 'Data: {0:ti}'
  'p.subiect' = ('Subiect: R' + $script:A_breve + 'spuns la {0:j}')
  'p.raspuns_la' = 'Raspuns la: {0:j}'
  'p.cheie' = 'Cheie: {0:x}'
  'p.mesaj' = '## {0:j}: {1:e.cereri}'
  'p.sep_tabel' = '|---|---|---|---|---|---|'
  'p.rand' = '| {0:e.sectiuni} | {1:filtru} | {2:k.coloane} | {3:vj} | {4:ve} | {5:e.rezultat} |'
  'p.de_decis_rand' = '- {0:e.de_decis}'
  'p.gata' = 'GATA'
  'p.oprit' = 'OPRIT {0:e.motive_oprire}'
}
foreach ($k in $script:CatalogFix.Keys) { $script:Sabloane[$k] = $script:CatalogFix[$k] }
$script:TiparSlot = '\{([0-9])(?::([a-z0-9_.]{1,40}))?\}'

function Test-TextSigur {
  param([AllowNull()]$X)
  if ($null -eq $X -or -not ($X -is [System.Management.Automation.PSCustomObject])) { return $false }
  return (@($X.PSObject.TypeNames)[0] -ceq $script:TipTextSigur -and $X.Text -is [string] -and $X.Ascuns -is [bool])
}

function Test-CaleCamp {
  param([AllowNull()]$V)
  if (-not ($V -is [string]) -or $V.Length -eq 0 -or $V.Length -gt 200) { return $false }
  foreach ($p in $V.Split('.')) {
    $m = [regex]::Match($p, '^([a-z_][a-z0-9_]{0,40})(?:\[[0-9]{1,3}\])?\z')
    if (-not $m.Success -or @($script:Liste.campuri) -cnotcontains $m.Groups[1].Value) { return $false }
  }
  return $true
}

# Un slot: valoarea trebuie sa aiba EXACT tipul cerut; altfel exceptie (nimic nu se scrie din ea).
function Format-Slot {
  param([Parameter(Mandatory)][string]$Tip, [AllowNull()]$V)
  $ref = 'DTGZ|iesire_refuzata'
  $asc = $false
  if ($Tip -ceq 'n') { if (-not (Test-Intreg $V)) { throw $ref }; $t = ([long]$V).ToString($script:Inv) }
  elseif ($Tip -ceq 'nn') {
    if ($null -eq $V) { $t = 'necunoscut' } elseif (Test-Intreg $V) { $t = ([long]$V).ToString($script:Inv) } else { throw $ref }
  }
  elseif ($Tip -ceq 'n3') { if (-not (Test-Intreg $V) -or $V -lt 0 -or $V -gt 999) { throw $ref }; $t = ([long]$V).ToString('000', $script:Inv) }
  elseif ($Tip -ceq 'j' -or $Tip -ceq 'c' -or $Tip -ceq 'cmd' -or $Tip -ceq 'nl') {
    if ($null -eq $V) { throw $ref }
    $parti = @()
    foreach ($x in @($V)) {
      if (-not (Test-Intreg $x)) { throw $ref }
      if ($Tip -ceq 'nl') { if ($x -lt 0) { throw $ref }; $parti += ([long]$x).ToString($script:Inv); continue }
      if ($x -lt 0 -or $x -gt 999 -or ($Tip -cne 'j' -and $x -lt 1)) { throw $ref }
      $p = ([long]$x).ToString('000', $script:Inv)
      if ($Tip -ceq 'j') { $parti += ('juridic#' + $p) } elseif ($Tip -ceq 'c') { $parti += ('claude#' + $p) } else { $parti += ('claude#' + $p + '.md') }
    }
    $t = if ($parti.Count -eq 0) { '(niciunul)' } else { $parti -join ', ' }
  }
  elseif ($Tip -ceq 'z') {
    if (-not ((Test-Intreg $V) -or $V -is [decimal] -or $V -is [double])) { throw $ref }
    $t = Format-NumarInvariant ([decimal]$V)
  }
  elseif ($Tip -ceq 'b') { if (-not ($V -is [bool])) { throw $ref }; $t = if ($V) { 'da' } else { 'nu' } }
  elseif ($Tip -ceq 't' -or $Tip -ceq 't2' -or $Tip -ceq 'ti') {
    if (-not ($V -is [datetime])) { throw $ref }
    $f = if ($Tip -ceq 't') { 'yyyy-MM-dd HH:mm' } elseif ($Tip -ceq 't2') { 'yyyy-MM-dd HH:mm:ss' } else { 'yyyy-MM-ddTHH:mm:sszzz' }
    $t = $V.ToString($f, $script:Inv)
  }
  elseif ($Tip -ceq 'x') { if (-not ($V -is [string]) -or $V -cnotmatch '^[0-9a-f]{32}\z') { throw $ref }; $t = $V }
  elseif ($Tip -ceq 'sqln') {
    if ($null -eq $V) { $t = 'necunoscut' } elseif ($V -is [string] -and $V -cmatch '^[0-9A-Z]{5}\z') { $t = $V } else { throw $ref }
  }
  elseif ($Tip -ceq 'id') { if (-not ($V -is [string]) -or $V -cnotmatch $script:TiparIdRulare) { throw $ref }; $t = $V }
  elseif ($Tip.StartsWith('k.')) {
    $l = $script:Liste[$Tip.Substring(2)]
    if ($null -eq $l -or -not ($V -is [string]) -or @($l) -cnotcontains $V) { throw $ref }
    $t = $V
  }
  elseif ($Tip.StartsWith('kl.')) {
    $l = $script:Liste[$Tip.Substring(3)]
    if ($null -eq $l -or $null -eq $V) { throw $ref }
    $parti = @()
    foreach ($x in @($V)) { if (-not ($x -is [string]) -or @($l) -cnotcontains $x) { throw $ref }; $parti += $x }
    if ($parti.Count -eq 0) { throw $ref }
    $t = $parti -join '|'
  }
  elseif ($Tip.StartsWith('e.')) {
    $h = $script:Etichete[$Tip.Substring(2)]
    if ($null -eq $h -or -not ($V -is [string]) -or -not $h.ContainsKey($V)) { throw $ref }
    $t = [string]$h[$V]
  }
  elseif ($Tip -ceq 'cale') { if (-not (Test-CaleCamp $V)) { throw $ref }; $t = $V }
  elseif ($Tip -ceq 've') { if (-not (Test-Celula $V)) { throw $ref }; $t = $V.V }
  elseif ($Tip -ceq 'vj') {
    if ($null -eq $V) { $t = '-' }
    elseif (Test-Celula $V) { $t = $V.V }
    elseif ((Test-Intreg $V) -or $V -is [decimal] -or $V -is [double]) { $t = Format-NumarInvariant ([decimal]$V) }
    else { throw $ref }
  }
  elseif ($Tip -ceq 'filtru' -or $Tip -ceq 'vel') {
    if ($null -eq $V) { throw $ref }
    $parti = @()
    foreach ($x in @($V)) {
      if (-not (Test-Celula $x)) { throw $ref }
      if ($Tip -ceq 'filtru') { $parti += ($x.C + '=' + $x.V) } else { $parti += $x.V }
    }
    if ($parti.Count -eq 0) { throw $ref }
    $t = if ($Tip -ceq 'filtru') { $parti -join ', ' } else { $parti -join '|' }
  }
  elseif ($Tip -ceq 'ts') { if (-not (Test-TextSigur $V)) { throw $ref }; $t = $V.Text; $asc = $V.Ascuns }
  elseif ($Tip -ceq 'tsl') {
    if ($null -eq $V) { throw $ref }
    $parti = @()
    foreach ($x in @($V)) { if (-not (Test-TextSigur $x)) { throw $ref }; $parti += $x.Text; if ($x.Ascuns) { $asc = $true } }
    $t = $parti -join "`n"
  }
  else { throw $ref }
  return @{ Text = [string]$t; Ascuns = [bool]$asc }
}

# SINGURUL constructor de text care poate fi scris pe disc: sablon din catalog + valori tipizate. La final, ultima
# bariera de tipare de date personale: daca ceva se potriveste, textul e inlocuit cu codurile gasite (Ascuns = true).
function Format-Mesaj {
  param([Parameter(Mandatory)][string]$Id, [AllowNull()][AllowEmptyCollection()][object[]]$Valori = @())
  if ($null -eq $Valori) { $Valori = @() }
  if (-not $script:Sabloane.ContainsKey($Id)) { throw 'DTGZ|sablon_necunoscut' }
  $sablon = [string]$script:Sabloane[$Id]
  $sb = New-Object System.Text.StringBuilder
  $poz = 0; $folosite = @{}; $ascuns = $false
  foreach ($m in [regex]::Matches($sablon, $script:TiparSlot)) {
    [void]$sb.Append($sablon, $poz, $m.Index - $poz)
    if (-not $m.Groups[2].Success) { throw 'DTGZ|iesire_refuzata' }
    $i = [int]$m.Groups[1].Value
    if ($i -ge $Valori.Count) { throw 'DTGZ|iesire_refuzata' }
    $r = Format-Slot -Tip $m.Groups[2].Value -V $Valori[$i]
    [void]$sb.Append($r.Text)
    if ($r.Ascuns) { $ascuns = $true }
    $folosite[$i] = $true
    $poz = $m.Index + $m.Length
  }
  [void]$sb.Append($sablon, $poz, $sablon.Length - $poz)
  if ($folosite.Count -ne $Valori.Count) { throw 'DTGZ|iesire_refuzata' }
  $text = $sb.ToString()
  if (-not $ascuns) {
    $dp = @(Find-DatePersonale $text)
    if ($dp.Count -gt 0) { $ascuns = $true; $text = 'text ascuns: tipare de date personale (' + ($dp -join ', ') + '), ' + $text.Length + ' caractere' }
  }
  return [pscustomobject]@{ PSTypeName = $script:TipTextSigur; Text = $text; Ascuns = $ascuns }
}

# Erorile proprii: cod din catalog (e.<cod>) + numere. Nimic altceva nu trece prin mesajul exceptiei.
function Stop-Dtgz {
  param([Parameter(Mandatory, Position = 0)][string]$Cod, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Numere)
  $sufix = ''
  foreach ($n in @($Numere)) {
    if ($null -eq $n) { continue }
    if (-not (Test-Intreg $n)) { throw 'DTGZ|iesire_refuzata' }
    $sufix += '|' + ([long]$n).ToString($script:Inv)
  }
  if (-not $script:Sabloane.ContainsKey('e.' + $Cod)) { throw 'DTGZ|sablon_necunoscut' }
  throw ('DTGZ|' + $Cod + $sufix)
}

function Get-CategorieExceptie {
  param($Ex)
  if ($Ex -is [System.UnauthorizedAccessException]) { return 'acces' }
  if ($Ex -is [System.IO.IOException]) { return 'io' }
  if ($Ex -is [System.ComponentModel.Win32Exception]) { return 'win32' }
  if ($Ex -is [System.ArgumentException]) { return 'argument' }
  if ($Ex -is [System.FormatException]) { return 'format' }
  if ($Ex -is [System.InvalidOperationException]) { return 'operatie' }
  if ($Ex -is [System.Management.Automation.RuntimeException]) { return 'powershell' }
  return 'alta'
}

# Exceptie / ErrorRecord -> text sigur. Mesajul unei exceptii straine NU se scrie (doar categorie, HRESULT, lungime).
function ConvertTo-MesajEroare {
  param([AllowNull()]$Eroare)
  $ex = if ($Eroare -is [System.Management.Automation.ErrorRecord]) { $Eroare.Exception } else { $Eroare }
  if (-not ($ex -is [System.Exception])) { return (Format-Mesaj 'e.neprevazuta' @('alta', [long]0, [long]0)) }
  $e = $ex; $ultima = $ex
  while ($null -ne $e) {
    $m = [regex]::Match([string]$e.Message, '^DTGZ\|([a-z0-9_]{1,40})((?:\|-?[0-9]{1,18})*)\z')
    if ($m.Success -and $script:Sabloane.ContainsKey('e.' + $m.Groups[1].Value)) {
      $nr = @($m.Groups[2].Value.Split('|') | Where-Object { $_ -ne '' } | ForEach-Object { [long]$_ })
      try { return (Format-Mesaj ('e.' + $m.Groups[1].Value) $nr) } catch { break }
    }
    $ultima = $e
    $e = $e.InnerException
  }
  return (Format-Mesaj 'e.neprevazuta' @((Get-CategorieExceptie $ultima), [long]$ex.HResult, [long]([string]$ex.Message).Length))
}

function New-Rezultat {
  param([string]$Stare, $Text, [int]$Cod)
  if (-not (Test-TextSigur $Text)) { $Text = Format-Mesaj 'r.eroare' @((Format-Mesaj 'e.iesire_nesigura')); $Stare = 'EROARE'; $Cod = 1 }
  return @{ Stare = $Stare; Text = $Text; Linie = $Text.Text; Cod = $Cod }
}

function Get-RezultatEroare {
  param([Parameter(Mandatory)][string]$Cod)
  return (New-Rezultat 'EROARE' (Format-Mesaj 'r.eroare' @((Format-Mesaj ('e.' + $Cod)))) 1)
}

function Get-RezultatExceptie {
  param([AllowNull()]$Eroare)
  return (New-Rezultat 'EROARE' (Format-Mesaj 'r.eroare' @((ConvertTo-MesajEroare $Eroare))) 1)
}

# ---------------------------------------------------------------- SCRIERILE pe disc (doar text produs de Format-Mesaj)

function Write-FisierSigur {
  param([Parameter(Mandatory)][string]$Cale, [Parameter(Mandatory)][AllowNull()]$Text, [switch]$Adauga, [switch]$Atomic, [switch]$FaraLinieNoua)
  if (-not (Test-TextSigur $Text)) { Stop-Dtgz 'iesire_nesigura' }
  $t = $Text.Text
  if (-not $FaraLinieNoua) { $t += "`r`n" }
  if ($Adauga) { [System.IO.File]::AppendAllText($Cale, $t, $script:Utf8FaraBom); return }
  if (-not $Atomic) { [System.IO.File]::WriteAllText($Cale, $t, $script:Utf8FaraBom); return }
  $tmp = $Cale + '.tmp-' + [guid]::NewGuid().ToString('N')
  try {
    [System.IO.File]::WriteAllText($tmp, $t, $script:Utf8FaraBom)
    if (Test-Path -LiteralPath $Cale) { [System.IO.File]::Replace($tmp, $Cale, [NullString]::Value) } else { [System.IO.File]::Move($tmp, $Cale) }
  } finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force } }
}

function Write-JurnalSigur {
  param([Parameter(Mandatory)][string]$Cale, [Parameter(Mandatory)][string]$IdRulare, [Parameter(Mandatory)]$Text, [datetime]$Cand = (Get-Date))
  Write-FisierSigur -Cale $Cale -Text (Format-Mesaj 'j.linie' @($Cand, $IdRulare, $Text)) -Adauga
}

function Write-StareSigura {
  param([Parameter(Mandatory)][string]$Cale, [Parameter(Mandatory)]$Text, [datetime]$Cand = (Get-Date))
  Write-FisierSigur -Cale $Cale -Text (Format-Mesaj 's.linie' @($Cand, $Text))
}

# ---------------------------------------------------------------- token, argumente

function Test-TokenFormat {
  param([AllowNull()][AllowEmptyString()][string]$Token)
  if ([string]::IsNullOrEmpty($Token)) { return $false }
  return ($Token -cmatch '^sk-ant-oat01-[A-Za-z0-9_\-]{20,}\z')
}

# Citeste tokenul din fisier. Intoarce @{Ok; Token; Motiv (text sigur)}. Motivul nu contine nici tokenul, nici calea.
function Read-TokenFisier {
  param([Parameter(Mandatory)][string]$Cale)
  if (-not (Test-Path -LiteralPath $Cale -PathType Leaf)) { return @{ Ok = $false; Token = $null; Motiv = (Format-Mesaj 'e.token_lipsa') } }
  $t = (Read-TextUtf8 $Cale).Trim()
  if (-not (Test-TokenFormat $t)) { return @{ Ok = $false; Token = $null; Motiv = (Format-Mesaj 'e.token_format') } }
  return @{ Ok = $true; Token = $t; Motiv = (Format-Mesaj 'gol') }
}

# Argumente pentru linia de comanda Windows (regulile CommandLineToArgvW).
function Join-ArgumenteWin {
  param([string[]]$Argumente)
  $parti = foreach ($a in $Argumente) {
    if ($a -ne '' -and $a -notmatch '[\s"]') { $a; continue }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    $bs = 0
    foreach ($ch in $a.ToCharArray()) {
      if ($ch -eq [char]'\') { $bs++; continue }
      if ($ch -eq [char]'"') { [void]$sb.Append([char]'\', 2 * $bs + 1); [void]$sb.Append([char]'"'); $bs = 0; continue }
      if ($bs -gt 0) { [void]$sb.Append([char]'\', $bs); $bs = 0 }
      [void]$sb.Append($ch)
    }
    if ($bs -gt 0) { [void]$sb.Append([char]'\', 2 * $bs) }
    [void]$sb.Append('"')
    $sb.ToString()
  }
  return ($parti -join ' ')
}

# ---------------------------------------------------------------- folderul de dialog

function Test-EsteReparse {
  param([Parameter(Mandatory)][System.IO.FileSystemInfo]$Item)
  return [bool]($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
}

# Fisierele juridic#NNN.md / claude#NNN.md (exact 3 cifre, litere mici), doar fisiere obisnuite.
function Get-FisiereDialog {
  param([Parameter(Mandatory)][string]$Folder)
  $rez = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $Folder -File -Force -ErrorAction Stop)) {
    $m = [regex]::Match($f.Name, $script:TiparNume)
    if (-not $m.Success) { continue }
    if (Test-EsteReparse $f) { continue }
    $rez += [pscustomobject]@{ Tip = $m.Groups[1].Value; Numar = [int]$m.Groups[2].Value; Nume = $f.Name; Cale = $f.FullName }
  }
  return ,@($rez | Sort-Object Numar, Tip)
}

# NNN = max(numerele juridic# si claude# din folder) + 1, cel putin 1; peste 999 = eroare.
function Get-UrmatorulNumar {
  param([Parameter(Mandatory)][string]$Folder)
  $max = 0
  foreach ($f in (Get-FisiereDialog $Folder)) { if ($f.Numar -gt $max) { $max = $f.Numar } }
  $n = $max + 1
  if ($n -gt 999) { Stop-Dtgz 'numerotare_999' }
  return $n
}

# Antetul = liniile de la inceput pana la prima linie goala (cel mult 12).
function Get-AntetText {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
  if ($Text.Length -gt 8192) { $Text = $Text.Substring(0, 8192) }
  $antet = @()
  foreach ($l in ($Text -split "\r?\n")) {
    if ($l.Trim() -eq '') { break }
    $antet += $l
    if ($antet.Count -ge 12) { break }
  }
  return ,@($antet)
}

# Marcajul "(verificare programata)", cu sau fara diacritice, oriunde in antet (de regula in Subiect:).
function Test-AntetProgramat {
  param([Parameter(Mandatory)][string]$Cale)
  $antet = Get-AntetText (Read-TextUtf8 $Cale)
  $tipar = '\(verificare programat[a' + $script:A_breve + ']\)'
  return [bool](($antet -join "`n") -match $tipar)
}

# Fisierele juridic#NNN.md cu NNN > ultimul procesat si antet "(verificare programata)", crescator.
function Find-JuridicNoi {
  param([Parameter(Mandatory)][string]$Folder, [Parameter(Mandatory)][int]$UltimulProcesat)
  $rez = @()
  foreach ($f in (Get-FisiereDialog $Folder)) {
    if ($f.Tip -ne 'juridic' -or $f.Numar -le $UltimulProcesat) { continue }
    if (Test-AntetProgramat $f.Cale) { $rez += $f }
  }
  return ,@($rez | Sort-Object Numar)
}

# Instantaneu recursiv: cale relativa -> lungime|ultima scriere (doar in memorie; numele nu se scriu nicaieri).
function Get-InstantaneuDialog {
  param([Parameter(Mandatory)][string]$Folder)
  $h = @{}
  $radacina = (Get-Item -LiteralPath $Folder).FullName.TrimEnd('\') + '\'
  foreach ($f in @(Get-ChildItem -LiteralPath $Folder -Recurse -Force -ErrorAction Stop)) {
    $rel = $f.FullName.Substring($radacina.Length)
    if ($f.PSIsContainer) { $h[$rel] = 'DIR' }
    else { $h[$rel] = '{0}|{1}' -f $f.Length, $f.LastWriteTimeUtc.Ticks }
  }
  return $h
}

# r5: doar CONTOARE (sterse / modificate / noi), fara nume: un nume de fisier e text extern. Exceptie: juridic#NNN.md
# noi (le poate scrie Proiectul Juridic in timpul rularii). Agentul nu are drept de scriere aici; e a doua bariera.
function Compare-InstantaneuDialog {
  param([Parameter(Mandatory)][hashtable]$Inainte, [Parameter(Mandatory)][hashtable]$Dupa)
  $s = 0; $m = 0; $n = 0
  foreach ($k in $Inainte.Keys) {
    if (-not $Dupa.ContainsKey($k)) { $s++ }
    elseif ($Dupa[$k] -ne $Inainte[$k]) { $m++ }
  }
  foreach ($k in $Dupa.Keys) {
    if ($Inainte.ContainsKey($k)) { continue }
    if ($k -cmatch '^juridic#[0-9]{3}\.md$') { continue }
    $n++
  }
  return @{ Sterse = $s; Modificate = $m; Noi = $n; Total = ($s + $m + $n) }
}

# Fisierele temporare proprii ramase in dialog dupa o rulare oprita brusc (nume fix: _dialog_tgz_<cheie>.tmp).
# Se sterg doar sub lock-ul global. Intoarce numarul lor.
function Remove-TemporareProprii {
  param([Parameter(Mandatory)][string]$Folder)
  $n = 0
  foreach ($f in @(Get-ChildItem -LiteralPath $Folder -File -Force -ErrorAction Stop)) {
    if ($f.Name -cmatch $script:TiparTemporar -and -not (Test-EsteReparse $f)) { Remove-Item -LiteralPath $f.FullName -Force; $n++ }
  }
  return $n
}

# Folderele de rulare ramase (rulare oprita brusc, stergere esuata): pot contine raspuns.json / context, deci se sterg la
# pornire, sub lock-ul global. Doar foldere cu nume de id de rulare, fara legaturi. Intoarce cate s-au sters.
function Remove-RulariRamase {
  param([Parameter(Mandatory)][string]$WorkDir)
  $d = Join-Path $WorkDir 'rulari'
  if (-not (Test-Path -LiteralPath $d -PathType Container)) { return 0 }
  $n = 0
  foreach ($x in @(Get-ChildItem -LiteralPath $d -Directory -Force -ErrorAction Stop)) {
    if ($x.Name -cnotmatch $script:TiparIdRulare -or (Test-EsteReparse $x)) { continue }
    Remove-Item -LiteralPath $x.FullName -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $x.FullName)) { $n++ }
  }
  return $n
}

# ---------------------------------------------------------------- cursorul local (ultimul juridic# procesat)

# Fisierul are exact un rand nevid: "juridic#NNN" sau "juridic#NNN (raspuns claude#NNN, AAAA-LL-ZZ HH:MM)".
# Lipsa / alt format = exceptie (nu se ghiceste: primul cursor il scrie chat-ul la instalare).
function Read-Cursor {
  param([Parameter(Mandatory)][string]$Cale)
  if (-not (Test-Path -LiteralPath $Cale -PathType Leaf)) { Stop-Dtgz 'cursor_lipsa' }
  $linii = @((Read-TextUtf8 $Cale) -split "\r?\n" | Where-Object { $_.Trim() -ne '' })
  if ($linii.Count -ne 1) { Stop-Dtgz 'cursor_randuri' $linii.Count }
  $m = [regex]::Match($linii[0].Trim(), $script:TiparCursor)
  if (-not $m.Success) { Stop-Dtgz 'cursor_format' }
  return [int]$m.Groups[1].Value
}

function Format-Cursor {
  param([Parameter(Mandatory)][int]$NrJuridic, [Parameter(Mandatory)][int]$NrClaude, [Parameter(Mandatory)][datetime]$Cand)
  if ($NrJuridic -lt 1 -or $NrJuridic -gt 999 -or $NrClaude -lt 1 -or $NrClaude -gt 999) { Stop-Dtgz 'cursor_valori' }
  return (Format-Mesaj 'cursor' @($NrJuridic, $NrClaude, $Cand))
}

# Avans cu CAS: cursorul de pe disc trebuie sa fie inca $Vechi (altfel cineva l-a mutat de mana -> exceptie,
# nu suprascrie), iar noul numar trebuie sa fie mai mare. Scriere atomica (Write-FisierSigur -Atomic).
# Intoarce textul sigur al cursorului.
function Write-Cursor {
  param([Parameter(Mandatory)][string]$Cale, [Parameter(Mandatory)][int]$Vechi, [Parameter(Mandatory)][int]$NrJuridic,
        [Parameter(Mandatory)][int]$NrClaude, [Parameter(Mandatory)][datetime]$Cand)
  $text = Format-Cursor -NrJuridic $NrJuridic -NrClaude $NrClaude -Cand $Cand
  if ($NrJuridic -le $Vechi) { Stop-Dtgz 'cursor_inapoi' $Vechi $NrJuridic }
  $acum = Read-Cursor $Cale
  if ($acum -ne $Vechi) { Stop-Dtgz 'cursor_schimbat' $Vechi $acum }
  Write-FisierSigur -Cale $Cale -Text $text -Atomic
  if ((Read-Cursor $Cale) -ne $NrJuridic) { Stop-Dtgz 'cursor_neverificat' }
  return $text
}

# ---------------------------------------------------------------- contractul raspunsului (schema, export)

function Get-NumeProprietati {
  param([Parameter(Mandatory)]$Obiect)
  return ,@($Obiect.PSObject.Properties | ForEach-Object { $_.Name })
}

# Inregistreaza listele si etichetele schemei (dupa verificarea amprentei) + paritatea schema <-> FormatColoane (L19).
function Register-Schema {
  param([Parameter(Mandatory)]$Schema)
  $et = @{}
  foreach ($lista in 'motive_oprire', 'motive_eroare', 'cereri', 'de_decis') {
    $h = New-Object System.Collections.Hashtable ([System.StringComparer]::Ordinal)
    foreach ($k in (Get-NumeProprietati $Schema.$lista)) { $h[$k] = [string]$Schema.$lista.$k }
    $et[$lista] = $h
  }
  $hs = New-Object System.Collections.Hashtable ([System.StringComparer]::Ordinal)
  $campuri = @($script:CampuriContract)
  $exporturi = @()
  foreach ($cod in (Get-NumeProprietati $Schema.sectiuni)) {
    $s = $Schema.sectiuni.$cod
    $nr = [int]$s.export
    if (-not $script:FormatColoane.ContainsKey($nr)) { Stop-Dtgz 'schema_coloana' $nr }
    $chei = @($script:FormatColoane[$nr].Keys)
    foreach ($c in @($s.chei) + @($s.indicatori)) { if ($chei -cnotcontains $c) { Stop-Dtgz 'schema_coloana' $nr } }
    $hs[$cod] = [string]$s.titlu
    $campuri += @($s.chei)
    $exporturi += $nr
  }
  foreach ($nr in $script:FormatColoane.Keys) { if ($exporturi -notcontains $nr) { Stop-Dtgz 'schema_coloana' $nr } }
  $et['sectiuni'] = $hs
  $hr = New-Object System.Collections.Hashtable ([System.StringComparer]::Ordinal)
  foreach ($k in 'potrivire', 'diferenta', 'doar_erp') { $hr[$k] = [string]$Schema.texte.$k }
  $et['rezultat'] = $hr
  $script:Etichete = $et
  foreach ($lista in 'motive_oprire', 'motive_eroare', 'cereri', 'de_decis', 'sectiuni') { $script:Liste[$lista] = @($et[$lista].Keys) }
  $script:Liste['campuri'] = @($campuri | Select-Object -Unique)
  # partile raspunsului publicat care vin din textele schemei (fixate prin amprenta)
  $tx = $Schema.texte
  $script:Sabloane['p.verificare'] = [string]$tx.verificare + ':'
  $script:Sabloane['p.fara_verificari'] = [string]$tx.fara_verificari
  $script:Sabloane['p.cap_tabel'] = [string]$tx.cap_tabel
  $script:Sabloane['p.neverificabile'] = [string]$tx.neverificabile + ': {0:n}'
  $script:Sabloane['p.atasamente'] = [regex]::Replace([string]$tx.atasamente, '\{([0-9])\}', '{$1:n}')
  $script:Sabloane['p.de_decis'] = [string]$tx.de_decis + ':'
  $script:Sabloane['p.nimic'] = '- ' + [string]$tx.nimic
}

# r5: schema e fixata prin amprenta in modul (un text schimbat = refuz inainte de BD si de Claude). Raman si refuzurile r4:
# niciun camp / limita / eticheta "nota" (nu exista cale de activare a textului liber din configurare).
function Read-SchemaRaspuns {
  param([Parameter(Mandatory)][string]$Cale)
  try { $text = $script:Utf8Strict.GetString([System.IO.File]::ReadAllBytes($Cale)) } catch { Stop-Dtgz 'schema_json' }
  if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
  if ($text -match '(?i)nota|vocabular') { Stop-Dtgz 'schema_nota' }
  if ((Get-Sha256Octeti ($script:Utf8FaraBom.GetBytes($text.Replace("`r", '')))) -cne $script:AmprentaSchema) { Stop-Dtgz 'schema_amprenta' }
  try { $s = $text | ConvertFrom-Json } catch { Stop-Dtgz 'schema_json' }
  if ($s.versiune -ne 3) { Stop-Dtgz 'schema_versiune' }
  Register-Schema $s
  return $s
}

# Exportul psql (format nealiniat): "## N. titlu", linie ```, antet a|b|c, randuri, linie ```.
# r5: antetul trebuie sa fie EXACT lista de coloane din FormatColoane; fiecare valoare se valideaza pe formatul coloanei
# si, daca nu il respecta, devine "nevalidat-K" (K = a cata valoare distincta nevalida din coloana). Textul brut nu
# iese din aceasta functie. Intoarce hashtable N -> @{Coloane; Randuri; Inlocuite (coloana -> numar de celule)}.
function ConvertFrom-ExportContext {
  param([Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Linii)
  $sect = @{}
  $i = 0; $n = $Linii.Count
  while ($i -lt $n) {
    $m = [regex]::Match([string]$Linii[$i], '^## ([0-9]{1,2})\. ')
    if (-not $m.Success) { $i++; continue }
    $nr = [int]$m.Groups[1].Value
    if (-not $script:FormatColoane.ContainsKey($nr)) { Stop-Dtgz 'export_sect_necunoscuta' $nr }
    if ($sect.ContainsKey($nr)) { Stop-Dtgz 'export_sect_dubla' $nr }
    if ($i + 2 -ge $n -or [string]$Linii[$i + 1] -cne '```') { Stop-Dtgz 'export_fara_tabel' $nr }
    $fc = $script:FormatColoane[$nr]
    $col = @($fc.Keys)
    if ([string]$Linii[$i + 2] -cne ($col -join '|')) { Stop-Dtgz 'export_antet' $nr }
    $distincte = @{}; $numar = @{}
    $randuri = New-Object System.Collections.ArrayList
    $j = $i + 3
    while ($j -lt $n -and [string]$Linii[$j] -cne '```') {
      $cel = @(([string]$Linii[$j]) -split '\|')
      if ($cel.Count -ne $col.Count) { Stop-Dtgz 'export_rand' $nr $cel.Count $col.Count }
      $h = New-Object System.Collections.Hashtable ([System.StringComparer]::Ordinal)
      for ($k = 0; $k -lt $col.Count; $k++) {
        $c = $col[$k]; $v = [string]$cel[$k]
        if ($v -cne '-' -and -not (Test-ValoareFormat $fc[$c] $v)) {
          if (-not $distincte.ContainsKey($c)) { $distincte[$c] = New-Object System.Collections.Hashtable ([System.StringComparer]::Ordinal); $numar[$c] = 0 }
          if (-not $distincte[$c].ContainsKey($v)) {
            if ($distincte[$c].Count -ge 9999) { Stop-Dtgz 'export_prea_multe' $nr }
            $distincte[$c][$v] = $distincte[$c].Count + 1
          }
          $v = 'nevalidat-' + $distincte[$c][$v]
          $numar[$c]++
        }
        $h[$c] = $v
      }
      [void]$randuri.Add($h)
      $j++
    }
    if ($j -ge $n) { Stop-Dtgz 'export_neinchis' $nr }
    $sect[$nr] = @{ Coloane = $col; Randuri = $randuri.ToArray(); Inlocuite = $numar }
    $i = $j + 1
  }
  foreach ($k in @($script:FormatColoane.Keys | Sort-Object)) { if (-not $sect.ContainsKey($k)) { Stop-Dtgz 'export_lipsa_sect' $k } }
  return $sect
}

# Paritate schema <-> export: fiecare sectiune din schema exista, cu toate cheile si indicatorii ca si coloane.
function Test-ExportFataDeSchema {
  param([Parameter(Mandatory)][hashtable]$Export, [Parameter(Mandatory)]$Schema)
  foreach ($cod in (Get-NumeProprietati $Schema.sectiuni)) {
    $s = $Schema.sectiuni.$cod
    $nr = [int]$s.export
    if (-not $Export.ContainsKey($nr)) { Stop-Dtgz 'export_lipsa_sect' $nr }
    $col = @($Export[$nr].Coloane)
    foreach ($c in @($s.chei) + @($s.indicatori)) { if ($col -cnotcontains $c) { Stop-Dtgz 'schema_coloana' $nr } }
  }
}

# context.md pentru agent: recompus din exportul validat (nu liniile brute ale psql).
function ConvertTo-ContextSigur {
  param([Parameter(Mandatory)][hashtable]$Export, [Parameter(Mandatory)]$Schema, [Parameter(Mandatory)][datetime]$Acum)
  $titlu = @{}
  foreach ($cod in (Get-NumeProprietati $Schema.sectiuni)) { $titlu[[int]$Schema.sectiuni.$cod.export] = $cod }
  $L = New-Object System.Collections.ArrayList
  [void]$L.Add((Format-Mesaj 'c.titlu')); [void]$L.Add((Format-Mesaj 'gol'))
  [void]$L.Add((Format-Mesaj 'c.generat' @($Acum))); [void]$L.Add((Format-Mesaj 'gol'))
  $nRanduri = 0
  foreach ($nr in @($Export.Keys | Sort-Object)) {
    $s = $Export[$nr]
    [void]$L.Add((Format-Mesaj 'c.sectiune' @([int]$nr, [string]$titlu[[int]$nr])))
    [void]$L.Add((Format-Mesaj 'c.cod'))
    [void]$L.Add((Format-Mesaj 'c.antet' @(, $s.Coloane)))
    foreach ($r in @($s.Randuri)) {
      $celule = @(foreach ($c in $s.Coloane) { New-Celula ([int]$nr) $c $r[$c] })
      [void]$L.Add((Format-Mesaj 'c.rand' @(, $celule)))
      $nRanduri++
    }
    [void]$L.Add((Format-Mesaj 'c.cod')); [void]$L.Add((Format-Mesaj 'gol'))
  }
  return @{ Text = (Format-Mesaj 'doc' @(, $L.ToArray())); Sectiuni = @($Export.Keys).Count; Randuri = $nRanduri }
}

function Get-TipJson {
  param([AllowNull()]$Valoare)
  if ($null -eq $Valoare) { return 'null' }
  if ($Valoare -is [bool]) { return 'bool' }
  if ($Valoare -is [int] -or $Valoare -is [long]) { return 'int' }
  if ($Valoare -is [decimal] -or $Valoare -is [double]) { return 'num' }
  if ($Valoare -is [string]) { return 'str' }
  if ($Valoare -is [array]) { return 'arr' }
  if ($Valoare -is [System.Management.Automation.PSCustomObject]) { return 'obj' }
  return 'alt'
}

# Respingerea raspuns.json: cod (lista motiv_raspuns) + calea campului (nume din contract / schema + indici) + un numar.
# Nicio valoare a agentului nu intra in mesaj.
function Stop-Raspuns {
  param([string]$Cod, [string]$Cale, [AllowNull()]$Nr = $null)
  $n = if ($null -ne $Nr -and (Test-Intreg $Nr)) { ([long]$Nr).ToString($script:Inv) } else { '' }
  throw ('RASPUNS|' + $Cod + '|' + $Cale + '|' + $n)
}

function Test-CampuriJson {
  param($Obiect, [string]$Unde, [string[]]$Obligatorii, [string[]]$Optionale = @())
  if ((Get-TipJson $Obiect) -ne 'obj') { Stop-Raspuns 'nu_e_obiect' $Unde }
  $nume = Get-NumeProprietati $Obiect
  $permise = @($Obligatorii) + @($Optionale)
  $plus = @($nume | Where-Object { $permise -cnotcontains $_ })
  if ($plus.Count -gt 0) { Stop-Raspuns 'campuri_in_afara_contractului' $Unde $plus.Count }
  foreach ($o in $Obligatorii) { if ($nume -cnotcontains $o) { Stop-Raspuns 'camp_obligatoriu_lipsa' ($Unde + '.' + $o) } }
}

function Get-CampJson {
  param($Obiect, [string]$Nume)
  $p = $Obiect.PSObject.Properties | Where-Object { $_.Name -ceq $Nume } | Select-Object -First 1
  if ($null -eq $p) { return $null }
  if ($p.Value -is [array]) { return ,$p.Value }   # lista ramane lista (si [] / [x]); apelantul NU pune @()
  return $p.Value
}

function Test-IntJson {
  param($Valoare, [string]$Unde, [long]$Min, [long]$Max)
  if ((Get-TipJson $Valoare) -ne 'int') { Stop-Raspuns 'nu_e_intreg' $Unde }
  if ($Valoare -lt $Min -or $Valoare -gt $Max) { Stop-Raspuns 'in_afara_intervalului' $Unde }
  return [int]$Valoare
}

function Test-CodJson {
  param($Valoare, [string]$Unde, [string[]]$Permise)
  if ((Get-TipJson $Valoare) -ne 'str' -or $Permise -cnotcontains $Valoare) { Stop-Raspuns 'cod_nepermis' $Unde }
  return [string]$Valoare
}

function ConvertTo-DecimalExport {
  param([string]$Text)
  $d = [decimal]0
  $stil = [System.Globalization.NumberStyles]::AllowDecimalPoint -bor [System.Globalization.NumberStyles]::AllowLeadingSign
  if ($Text -cmatch '^-?[0-9]+(\.[0-9]+)?\z' -and [decimal]::TryParse($Text, $stil, $script:Inv, [ref]$d)) { return $d }
  return $null
}

# O comparatie: filtrul alege EXACT un rand din tabelul exportului (deja validat); valoarea ERP se ia din export.
# Intoarce celule de export (nu text), ca la compunere sa treaca prin tipul "celula".
function Test-VerificareJson {
  param($V, [string]$Unde, $Schema, [hashtable]$Export)
  Test-CampuriJson $V $Unde @('sectiune', 'filtru', 'indicator') @('valoare_juridic')
  $codSect = Test-CodJson (Get-CampJson $V 'sectiune') ($Unde + '.sectiune') (Get-NumeProprietati $Schema.sectiuni)
  $s = $Schema.sectiuni.$codSect
  $nrExp = [int]$s.export
  $tabel = $Export[$nrExp]
  $filtru = Get-CampJson $V 'filtru'
  if ((Get-TipJson $filtru) -ne 'obj') { Stop-Raspuns 'filtru_nu_e_obiect' ($Unde + '.filtru') }
  $chei = Get-NumeProprietati $filtru
  if (@($chei | Where-Object { @($s.chei) -cnotcontains $_ }).Count -gt 0) { Stop-Raspuns 'filtru_chei_straine' ($Unde + '.filtru') }
  if ($chei -cnotcontains 'proiect') { Stop-Raspuns 'filtru_fara_proiect' ($Unde + '.filtru') }
  $randuri = @($tabel.Randuri)
  $parti = @(); $celule = @()
  foreach ($c in @($s.chei)) {
    if ($chei -cnotcontains $c) { continue }
    $val = Get-CampJson $filtru $c
    if ((Get-TipJson $val) -ne 'str') { Stop-Raspuns 'filtru_nu_e_text' ($Unde + '.filtru.' + $c) }
    if (@($tabel.Randuri | Where-Object { $_[$c] -ceq $val }).Count -eq 0) { Stop-Raspuns 'filtru_inexistent' ($Unde + '.filtru.' + $c) }
    $randuri = @($randuri | Where-Object { $_[$c] -ceq $val })
    $parti += ($c + '=' + $val)
    $celule += (New-Celula $nrExp $c ([string]$val))
  }
  if ($randuri.Count -ne 1) { Stop-Raspuns 'filtru_randuri' ($Unde + '.filtru') $randuri.Count }
  $ind = Test-CodJson (Get-CampJson $V 'indicator') ($Unde + '.indicator') @($s.indicatori)
  $erp = [string]$randuri[0][$ind]
  $vj = Get-CampJson $V 'valoare_juridic'
  $tip = Get-TipJson $vj
  $L = $Schema.limite
  if ($tip -eq 'null') { $valJ = $null; $rez = 'doar_erp' }
  elseif ($tip -eq 'int' -or $tip -eq 'num') {
    $d = [decimal]$vj
    if ($d -lt 0 -or $d -gt [decimal]$L.max_valoare) { Stop-Raspuns 'in_afara_intervalului' ($Unde + '.valoare_juridic') }
    if ([decimal]::Round($d, [int]$L.max_zecimale) -ne $d) { Stop-Raspuns 'prea_multe_zecimale' ($Unde + '.valoare_juridic') }
    $de = ConvertTo-DecimalExport $erp
    if ($null -eq $de) { Stop-Raspuns 'numeric_pe_text' ($Unde + '.valoare_juridic') }
    $valJ = $d
    $rez = if ($d -eq $de) { 'potrivire' } else { 'diferenta' }
  }
  elseif ($tip -eq 'str') {
    if (@($tabel.Randuri | Where-Object { $_[$ind] -ceq $vj }).Count -eq 0) { Stop-Raspuns 'text_inexistent' ($Unde + '.valoare_juridic') }
    $valJ = New-Celula $nrExp $ind ([string]$vj)
    $rez = if ($vj -ceq $erp) { 'potrivire' } else { 'diferenta' }
  }
  else { Stop-Raspuns 'tip_nepermis' ($Unde + '.valoare_juridic') }
  return @{ Cheie = ($codSect + '|' + ($parti -join ',') + '|' + $ind); Sectiune = $codSect; Filtru = $celule
            Indicator = $ind; Juridic = $valJ; Erp = (New-Celula $nrExp $ind $erp); Rezultat = $rez }
}

# Valideaza raspuns.json fata de schema, export si lista exacta de mesaje procesate.
# Intoarce @{Ok; Motiv (text sigur); Date}. Date = forma normalizata (singura folosita la compunere).
function Test-RaspunsAgent {
  param([Parameter(Mandatory)][string]$Cale, [Parameter(Mandatory)]$Schema, [Parameter(Mandatory)][hashtable]$Export,
        [Parameter(Mandatory)][int[]]$Juridic)
  try {
    $L = $Schema.limite
    $octeti = [System.IO.File]::ReadAllBytes($Cale)
    if ($octeti.Length -gt [int]$L.max_octeti) { Stop-Raspuns 'prea_mare' 'raspuns' $octeti.Length }
    try { $t = $script:Utf8Strict.GetString($octeti) } catch { Stop-Raspuns 'utf8_invalid' 'raspuns' }
    if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
    if ($t.Trim() -eq '') { Stop-Raspuns 'gol' 'raspuns' }
    try { $j = $t | ConvertFrom-Json } catch { Stop-Raspuns 'json_invalid' 'raspuns' }
    if ((Get-TipJson $j) -ne 'obj') { Stop-Raspuns 'nu_e_obiect' 'raspuns' }
    Test-CampuriJson $j 'raspuns' @('stare', 'mesaje') @('motiv_oprire', 'motiv_eroare')
    $stare = Test-CodJson (Get-CampJson $j 'stare') 'stare' @($Schema.stari)
    $mo = Get-CampJson $j 'motiv_oprire'; $me = Get-CampJson $j 'motiv_eroare'
    if ((Get-TipJson (Get-CampJson $j 'mesaje')) -ne 'arr') { Stop-Raspuns 'nu_e_lista' 'mesaje' }
    if ($stare -eq 'EROARE') {
      if ($null -ne $mo) { Stop-Raspuns 'motiv_la_stare_gresita' 'motiv_oprire' }
      $cod = Test-CodJson $me 'motiv_eroare' (Get-NumeProprietati $Schema.motive_eroare)
      return @{ Ok = $true; Motiv = (Format-Mesaj 'v.ok'); Date = @{ Stare = 'EROARE'; MotivEroare = $cod; Mesaje = @() } }
    }
    if ($null -ne $me) { Stop-Raspuns 'motiv_la_stare_gresita' 'motiv_eroare' }
    if ($stare -eq 'OPRIT') { $mo = Test-CodJson $mo 'motiv_oprire' (Get-NumeProprietati $Schema.motive_oprire) }
    elseif ($null -ne $mo) { Stop-Raspuns 'motiv_la_stare_gresita' 'motiv_oprire' }

    $mesaje = Get-CampJson $j 'mesaje'
    if ($mesaje.Count -ne $Juridic.Count) { Stop-Raspuns 'numar_mesaje' 'mesaje' $mesaje.Count }
    $vazute = @{}; $iesire = @()
    for ($i = 0; $i -lt $mesaje.Count; $i++) {
      $u = 'mesaje[' + $i + ']'
      $m = $mesaje[$i]
      # fara campuri optionale: un "nota" (sau orice text liber) = camp in afara contractului = nepublicat
      Test-CampuriJson $m $u @('juridic', 'cerere', 'verificari', 'neverificabile', 'atasamente', 'de_decis')
      $nr = Test-IntJson (Get-CampJson $m 'juridic') ($u + '.juridic') 1 999
      if ($Juridic -notcontains $nr) { Stop-Raspuns 'mesaj_neprocesat' ($u + '.juridic') }
      if ($vazute.ContainsKey($nr)) { Stop-Raspuns 'mesaj_repetat' ($u + '.juridic') }
      $vazute[$nr] = $true
      $cerere = Test-CodJson (Get-CampJson $m 'cerere') ($u + '.cerere') (Get-NumeProprietati $Schema.cereri)
      $vs = Get-CampJson $m 'verificari'
      if ((Get-TipJson $vs) -ne 'arr') { Stop-Raspuns 'nu_e_lista' ($u + '.verificari') }
      $vs = @($vs)
      if ($vs.Count -gt [int]$L.max_verificari_pe_mesaj) { Stop-Raspuns 'peste_limita' ($u + '.verificari') $vs.Count }
      $ver = @(); $chei = @{}
      for ($k = 0; $k -lt $vs.Count; $k++) {
        $x = Test-VerificareJson $vs[$k] ($u + '.verificari[' + $k + ']') $Schema $Export
        if ($chei.ContainsKey($x.Cheie)) { Stop-Raspuns 'comparatie_repetata' ($u + '.verificari[' + $k + ']') }
        $chei[$x.Cheie] = $true
        $ver += $x
      }
      $nev = Test-IntJson (Get-CampJson $m 'neverificabile') ($u + '.neverificabile') 0 ([int]$L.max_neverificabile)
      $at = Get-CampJson $m 'atasamente'
      Test-CampuriJson $at ($u + '.atasamente') @('citite', 'negasite_local', 'in_afara_radacinilor')
      $atv = @(foreach ($c in 'citite', 'negasite_local', 'in_afara_radacinilor') { Test-IntJson (Get-CampJson $at $c) ($u + '.atasamente.' + $c) 0 ([int]$L.max_atasamente) })
      $dd = Get-CampJson $m 'de_decis'
      if ((Get-TipJson $dd) -ne 'arr') { Stop-Raspuns 'nu_e_lista' ($u + '.de_decis') }
      $dd = @($dd)
      if ($dd.Count -gt [int]$L.max_de_decis_pe_mesaj) { Stop-Raspuns 'peste_limita' ($u + '.de_decis') $dd.Count }
      $ddv = @()
      for ($k = 0; $k -lt $dd.Count; $k++) {
        $c = Test-CodJson $dd[$k] ($u + '.de_decis[' + $k + ']') (Get-NumeProprietati $Schema.de_decis)
        if ($ddv -ccontains $c) { Stop-Raspuns 'cod_repetat' ($u + '.de_decis[' + $k + ']') }
        $ddv += $c
      }
      $iesire += @{ Juridic = $nr; Cerere = $cerere; Verificari = $ver; Neverificabile = $nev; Atasamente = $atv; DeDecis = $ddv }
    }
    $sortate = @($iesire | Sort-Object { $_.Juridic })
    return @{ Ok = $true; Motiv = (Format-Mesaj 'v.ok'); Date = @{ Stare = $stare; MotivOprire = $mo; Mesaje = $sortate } }
  } catch {
    $motiv = $null
    $m = [regex]::Match([string]$_.Exception.Message, '^RASPUNS\|([a-z_]{1,40})\|([a-z0-9_.\[\]]{1,200})\|([0-9]{0,12})\z')
    if ($m.Success) {
      try {
        if ($m.Groups[3].Value -ne '') { $motiv = Format-Mesaj 'v.motiv_nr' @($m.Groups[1].Value, $m.Groups[2].Value, [long]$m.Groups[3].Value) }
        else { $motiv = Format-Mesaj 'v.motiv' @($m.Groups[1].Value, $m.Groups[2].Value) }
      } catch { $motiv = $null }
    }
    if ($null -eq $motiv) { $motiv = Format-Mesaj 'v.motiv' @('eroare_interna', 'raspuns') }
    return @{ Ok = $false; Motiv = $motiv; Date = $null }
  }
}

# Cheia intentiei: numerele + amprentele EXACTE ale mesajelor la care se raspunde. Aceeasi cheie = acelasi raspuns.
function Get-CheieIntentie {
  param([Parameter(Mandatory)][int[]]$Numere, [Parameter(Mandatory)][hashtable]$Amprente)
  $parti = foreach ($n in ($Numere | Sort-Object)) {
    if (-not $Amprente.ContainsKey([int]$n)) { Stop-Dtgz 'cheie_invalida' }
    'juridic#{0:000}:{1}' -f $n, $Amprente[[int]$n]
  }
  $text = "dialog_tgz/r3`n" + ($parti -join "`n")
  return (Get-Sha256Octeti ($script:Utf8FaraBom.GetBytes($text))).Substring(0, 32)
}

# claude#NNN.md compus DOAR din sabloane + valori tipizate (celule de export validate, coduri, numere, data, cheie).
# Continutul NU depinde de NNN (se poate muta la coliziune). Intoarce textul sigur (refuz daca o linie e ascunsa).
function Format-RaspunsPublicat {
  param([Parameter(Mandatory)][hashtable]$Date, [Parameter(Mandatory)]$Schema, [Parameter(Mandatory)][string]$Cheie, [Parameter(Mandatory)][datetime]$Data)
  if ($Date.Stare -ne 'GATA' -and $Date.Stare -ne 'OPRIT') { Stop-Dtgz 'stare_nepublicabila' }
  $numere = @(@($Date.Mesaje) | ForEach-Object { [int]$_.Juridic })
  $L = New-Object System.Collections.ArrayList
  function A { param([string]$Id) [void]$L.Add((Format-Mesaj $Id $args)) }
  A 'p.de_la'; A 'p.data' $Data; A 'p.subiect' $numere; A 'p.raspuns_la' $numere; A 'p.cheie' $Cheie; A 'gol'
  foreach ($m in @($Date.Mesaje)) {
    A 'p.mesaj' $m.Juridic $m.Cerere; A 'gol'
    A 'p.verificare'
    if (@($m.Verificari).Count -eq 0) { A 'p.fara_verificari' }
    else {
      A 'gol'; A 'p.cap_tabel'; A 'p.sep_tabel'
      foreach ($v in @($m.Verificari)) { A 'p.rand' $v.Sectiune $v.Filtru $v.Indicator $v.Juridic $v.Erp $v.Rezultat }
    }
    A 'gol'
    if ($m.Neverificabile -gt 0) { A 'p.neverificabile' $m.Neverificabile }
    A 'p.atasamente' $m.Atasamente[0] $m.Atasamente[1] $m.Atasamente[2]; A 'gol'
    A 'p.de_decis'
    if (@($m.DeDecis).Count -eq 0) { A 'p.nimic' } else { foreach ($d in @($m.DeDecis)) { A 'p.de_decis_rand' $d } }
    A 'gol'
  }
  if ($Date.Stare -eq 'GATA') { A 'p.gata' } else { A 'p.oprit' $Date.MotivOprire }
  $doc = Format-Mesaj 'doc' @(, $L.ToArray())
  if ($doc.Ascuns) { Stop-Dtgz 'publicat_tipare' }
  if ($script:Utf8FaraBom.GetByteCount($doc.Text) -gt $script:MaxRaspunsOcteti) { Stop-Dtgz 'prea_mare' }
  return $doc
}

# Raspunsurile publicate de aceasta sarcina (antetul programului + "Raspuns la:" + "Cheie:" + ultima linie GATA / OPRIT).
# Alte claude#NNN.md (scrise de sesiunea chat) se ignora. Din fisier se iau doar numere, cheia hex si starea.
function Get-RaspunsuriProprii {
  param([Parameter(Mandatory)][string]$Folder)
  $rez = @()
  foreach ($f in (Get-FisiereDialog $Folder)) {
    if ($f.Tip -ne 'claude') { continue }
    if ((Get-Item -LiteralPath $f.Cale).Length -gt $script:MaxRaspunsOcteti) { continue }
    $t = Read-TextUtf8 $f.Cale
    $antet = Get-AntetText $t
    if ($antet.Count -lt 5 -or $antet[0] -cne $script:AntetDeLa) { continue }
    $rl = @($antet | Where-Object { $_ -cmatch '^Raspuns la: juridic#[0-9]{3}(?:, juridic#[0-9]{3})*$' })
    $ch = @($antet | Where-Object { $_ -cmatch '^Cheie: [0-9a-f]{32}$' })
    if ($rl.Count -ne 1 -or $ch.Count -ne 1) { continue }
    $nr = @([regex]::Matches($rl[0], 'juridic#([0-9]{3})') | ForEach-Object { [int]$_.Groups[1].Value })
    $linii = @($t -split "\r?\n" | Where-Object { $_.Trim() -ne '' })
    $ult = $linii[$linii.Count - 1].Trim()
    $stare = if ($ult -ceq 'GATA') { 'GATA' } elseif ($ult -cmatch '^OPRIT( |$)') { 'OPRIT' } else { $null }
    if (-not $stare) { continue }
    $rez += [pscustomobject]@{ Numar = $f.Numar; Cale = $f.Cale; Cheie = $ch[0].Substring(7, 32); Juridic = [int[]]$nr; Stare = $stare }
  }
  return ,@($rez)
}

# Publicare exclusiva: textul (DOAR text sigur) intr-un temporar din acelasi folder, apoi File.Move pe urmatorul numar
# liber (atomic pe acelasi volum; ESUEAZA daca destinatia exista: nu suprascrie niciodata). Ocupat intre timp = alt numar.
# $InainteDeMutare: doar pentru teste (simuleaza un scriitor concurent). Intoarce @{Numar; Nume; Cale}.
function Publish-RaspunsExclusiv {
  param([Parameter(Mandatory)][string]$Folder, [Parameter(Mandatory)][AllowNull()]$Text, [Parameter(Mandatory)][string]$Cheie,
        [int]$Incercari = 5, [scriptblock]$InainteDeMutare)
  if (-not (Test-TextSigur $Text)) { Stop-Dtgz 'iesire_nesigura' }
  if ($Text.Ascuns) { Stop-Dtgz 'publicat_tipare' }
  if ($Cheie -cnotmatch '^[0-9a-f]{32}\z') { Stop-Dtgz 'cheie_invalida' }
  $tmp = Join-Path $Folder ('_dialog_tgz_' + $Cheie + '.tmp')
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  try {
    $fs = [System.IO.File]::Open($tmp, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $b = $script:Utf8FaraBom.GetBytes($Text.Text); $fs.Write($b, 0, $b.Length); $fs.Flush($true) } finally { $fs.Dispose() }
    for ($i = 0; $i -lt $Incercari; $i++) {
      $n = Get-UrmatorulNumar $Folder
      $nume = 'claude#{0:000}.md' -f $n
      $final = Join-Path $Folder $nume
      if ($InainteDeMutare) { & $InainteDeMutare $n }
      try { [System.IO.File]::Move($tmp, $final); return @{ Numar = $n; Nume = $nume; Cale = $final } }
      catch { if (-not (Test-Path -LiteralPath $final)) { throw } }
    }
    Stop-Dtgz 'numar_liber' $Incercari
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  }
}

# Re-verificarea dupa publicare: daca exista juridic#NNN cu acelasi NNN ca raspunsul nostru, raspunsul se MUTA atomic
# (File.Move exclusiv) pe urmatorul numar liber; se repeta pana nu mai exista coliziune. Peste $Mutari = exceptie
# (coliziune nerezolvata = esec). Intoarce @{Numar; Cale; Mutari (lista @{De; La})}.
function Resolve-ColiziuneNumar {
  param([Parameter(Mandatory)][string]$Folder, [Parameter(Mandatory)][int]$Numar, [int]$Mutari = 5, [scriptblock]$InainteDeMutare)
  $cale = Join-Path $Folder ('claude#{0:000}.md' -f $Numar)
  if (-not (Test-Path -LiteralPath $cale -PathType Leaf)) { Stop-Dtgz 'raspuns_disparut' $Numar }
  $istoric = @()
  for ($i = 0; ; $i++) {
    if (-not (Test-Path -LiteralPath (Join-Path $Folder ('juridic#{0:000}.md' -f $Numar)))) {
      return @{ Numar = $Numar; Cale = $cale; Mutari = $istoric }
    }
    if ($i -ge $Mutari) { Stop-Dtgz 'coliziune_nerezolvata' $Numar $Mutari }
    $n = Get-UrmatorulNumar $Folder
    $dest = Join-Path $Folder ('claude#{0:000}.md' -f $n)
    if ($InainteDeMutare) { & $InainteDeMutare $n }
    $mutat = $false
    try { [System.IO.File]::Move($cale, $dest); $mutat = $true }
    catch { if (-not (Test-Path -LiteralPath $dest)) { Stop-Dtgz 'mutare_esuata' $Numar $n } }
    if ($mutat) { $istoric += @{ De = $Numar; La = $n }; $cale = $dest; $Numar = $n }
  }
}

# ---------------------------------------------------------------- prompt

function Format-Prompt {
  param([Parameter(Mandatory)][string]$Sablon, [Parameter(Mandatory)][hashtable]$Valori)
  $t = $Sablon
  foreach ($k in $Valori.Keys) { $t = $t.Replace('{{' + $k + '}}', [string]$Valori[$k]) }
  if ([regex]::IsMatch($t, '\{\{[A-Z_]+\}\}')) { Stop-Dtgz 'prompt_marcaj' }
  return $t
}

# Partile promptului generate din schema (o singura definitie a listelor, L19).
function Get-ValoriPromptSchema {
  param([Parameter(Mandatory)]$Schema)
  $coduri = foreach ($lista in 'motive_oprire', 'motive_eroare', 'cereri', 'de_decis') {
    $p = foreach ($k in (Get-NumeProprietati $Schema.$lista)) { '`' + $k + '` (' + $Schema.$lista.$k + ')' }
    '- `' + $lista + '`: ' + (@($p) -join '; ')
  }
  $sect = foreach ($c in (Get-NumeProprietati $Schema.sectiuni)) {
    $s = $Schema.sectiuni.$c
    '- `{0}` = tabelul "## {1}." din context; chei de filtru: {2}; indicatori: {3}' -f $c, $s.export,
      ((@($s.chei) | ForEach-Object { '`' + $_ + '`' }) -join ', '), ((@($s.indicatori) | ForEach-Object { '`' + $_ + '`' }) -join ', ')
  }
  return @{
    CODURI = ($coduri -join "`n")
    SECTIUNI = ($sect -join "`n")
  }
}

# Forma POSIX ceruta de regulile de permisiuni Claude Code pe Windows: C:\a\b -> //c/a/b
function ConvertTo-CaleRegula {
  param([Parameter(Mandatory)][string]$Cale)
  $c = $Cale.TrimEnd('\', '/') -replace '\\', '/'
  if ($c -match '^([A-Za-z]):/(.*)$') { return '//' + $Matches[1].ToLower() + '/' + $Matches[2] }
  Stop-Dtgz 'cale_fara_disc'
}

# ---------------------------------------------------------------- procese reale (psql / claude) intr-un Job Object

# Procesul porneste SUSPENDAT, e pus in job (fara BREAKAWAY: copiii nu pot iesi din job), apoi e reluat: nimic nu
# ruleaza in afara jobului. La final (iesire normala sau timeout) TerminateJobObject pe tot jobul, apoi confirmare
# ActiveProcesses = 0. KILL_ON_JOB_CLOSE: daca orchestratorul moare, sistemul inchide handle-ul si opreste tot jobul.
# r5: esecurile de lansare nu arunca exceptii cu text: Etapa (cod fix) + CodWin32 (numar).
$script:CodJob = @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace DialogTgzJob
{
    public sealed class Rezultat
    {
        public int Cod;
        public bool Timeout;
        public string Out = "";
        public string Err = "";
        public bool OprireConfirmata;
        public int[] Ramase = new int[0];
        public int OrfaniLaIesire;
        public string Etapa;
        public int CodWin32;
        public int Pid;
    }

    public static class Runner
    {
        const uint CREATE_SUSPENDED = 0x4, CREATE_UNICODE_ENVIRONMENT = 0x400, CREATE_NO_WINDOW = 0x08000000;
        const int STARTF_USESTDHANDLES = 0x100;
        const uint KILL_ON_JOB_CLOSE = 0x2000;
        const uint WAIT_OBJECT_0 = 0, WAIT_TIMEOUT = 0x102;

        [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong R, W, O, RB, WB, OB; }
        [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
            public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
        [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT {
            public BASIC_LIMIT Basic; public IO_COUNTERS Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
        [StructLayout(LayoutKind.Sequential)] struct BASIC_ACCOUNTING {
            public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
            public int cb; public string lpReserved, lpDesktop, lpTitle;
            public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
        [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr sa, string name);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXTENDED_LIMIT info, int len);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, out BASIC_ACCOUNTING info, int len, IntPtr ret);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, IntPtr info, int len, IntPtr ret);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string app, StringBuilder cmd,
            IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr t);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr p, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr p, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);

        // -1 = nu se poate citi (necunoscut: nu se confirma nimic)
        public static int ActiveProcese(IntPtr job)
        {
            BASIC_ACCOUNTING a;
            if (!QueryInformationJobObject(job, 1, out a, Marshal.SizeOf(typeof(BASIC_ACCOUNTING)), IntPtr.Zero)) return -1;
            return (int)a.ActiveProcesses;
        }

        // null = lista nu se poate citi
        public static int[] ListaProcese(IntPtr job)
        {
            int max = 4096, size = 8 + max * IntPtr.Size;
            IntPtr buf = Marshal.AllocHGlobal(size);
            try {
                if (!QueryInformationJobObject(job, 3, buf, size, IntPtr.Zero)) return null;
                int n = Marshal.ReadInt32(buf, 4);
                var r = new int[n];
                for (int i = 0; i < n; i++) r[i] = (int)Marshal.ReadIntPtr(buf, 8 + i * IntPtr.Size).ToInt64();
                return r;
            } finally { Marshal.FreeHGlobal(buf); }
        }

        static IntPtr BlocMediu(IDictionary env)
        {
            var chei = new List<string>();
            foreach (DictionaryEntry e in env) {
                string k = (string)e.Key;
                if (string.IsNullOrEmpty(k) || k.IndexOf('=') >= 0 || k.IndexOf('\0') >= 0) continue;
                chei.Add(k);
            }
            chei.Sort(StringComparer.OrdinalIgnoreCase);
            var sb = new StringBuilder();
            foreach (string k in chei) {
                string v = env[k] == null ? "" : env[k].ToString();
                if (v.IndexOf('\0') >= 0) continue;
                sb.Append(k).Append('=').Append(v).Append('\0');
            }
            sb.Append('\0');
            return Marshal.StringToHGlobalUni(sb.ToString());
        }

        static string Rezultatul(Task<string> t, int ms)
        {
            try { if (t.Wait(ms) && t.Status == TaskStatus.RanToCompletion) return t.Result; } catch (AggregateException) { }
            return "";
        }

        // Esec inainte de a exista un proces: nimic de oprit (OprireConfirmata = true), Cod = -1.
        static Rezultat Esec(Rezultat r, string etapa, int cod)
        {
            r.Etapa = etapa; r.CodWin32 = cod; r.Cod = -1; r.OprireConfirmata = true;
            return r;
        }

        public static Rezultat Run(string exe, string argumente, IDictionary env, string cwd, byte[] stdin, int timeoutMs, int confirmareMs)
        {
            var r = new Rezultat();
            IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return Esec(r, "job", Marshal.GetLastWin32Error());
            try {
                var lim = new EXTENDED_LIMIT();
                lim.Basic.LimitFlags = KILL_ON_JOB_CLOSE;
                if (!SetInformationJobObject(job, 9, ref lim, Marshal.SizeOf(typeof(EXTENDED_LIMIT))))
                    return Esec(r, "job", Marshal.GetLastWin32Error());
                using (var pOut = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable))
                using (var pErr = new AnonymousPipeServerStream(PipeDirection.In, HandleInheritability.Inheritable))
                using (var pIn = new AnonymousPipeServerStream(PipeDirection.Out, HandleInheritability.Inheritable))
                {
                    var si = new STARTUPINFO();
                    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                    si.dwFlags = STARTF_USESTDHANDLES;
                    si.hStdInput = pIn.ClientSafePipeHandle.DangerousGetHandle();
                    si.hStdOutput = pOut.ClientSafePipeHandle.DangerousGetHandle();
                    si.hStdError = pErr.ClientSafePipeHandle.DangerousGetHandle();
                    var cmd = new StringBuilder("\"" + exe + "\"" + (string.IsNullOrEmpty(argumente) ? "" : " " + argumente));
                    IntPtr bloc = BlocMediu(env);
                    PROCESS_INFORMATION pi;
                    bool ok; int eroare;
                    try {
                        ok = CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
                                            bloc, string.IsNullOrEmpty(cwd) ? null : cwd, ref si, out pi);
                        eroare = Marshal.GetLastWin32Error();
                    } finally { Marshal.FreeHGlobal(bloc); }
                    pOut.DisposeLocalCopyOfClientHandle(); pErr.DisposeLocalCopyOfClientHandle(); pIn.DisposeLocalCopyOfClientHandle();
                    if (!ok) return Esec(r, "creare_proces", eroare);
                    try {
                        r.Pid = pi.dwProcessId;
                        if (!AssignProcessToJobObject(job, pi.hProcess)) {
                            // procesul e inca suspendat: nu a executat nimic; se opreste si se confirma
                            r.Etapa = "asignare_job"; r.CodWin32 = Marshal.GetLastWin32Error();
                            TerminateProcess(pi.hProcess, 1);
                            r.OprireConfirmata = WaitForSingleObject(pi.hProcess, (uint)confirmareMs) == WAIT_OBJECT_0;
                            if (!r.OprireConfirmata) r.Ramase = new int[] { pi.dwProcessId };
                            r.Cod = -1;
                            return r;
                        }
                        var enc = new UTF8Encoding(false);
                        Task<string> tOut = new StreamReader(pOut, enc).ReadToEndAsync();
                        Task<string> tErr = new StreamReader(pErr, enc).ReadToEndAsync();
                        Task tIn = null;
                        if (ResumeThread(pi.hThread) == 0xFFFFFFFF) {
                            r.Etapa = "reluare"; r.CodWin32 = Marshal.GetLastWin32Error();
                            r.Cod = -1;
                        } else {
                            byte[] date = stdin ?? new byte[0];
                            tIn = Task.Run(() => {
                                try { if (date.Length > 0) pIn.Write(date, 0, date.Length); pIn.Flush(); }
                                catch (IOException) { } catch (ObjectDisposedException) { }
                                finally { try { pIn.Dispose(); } catch (IOException) { } }
                            });
                            uint w = WaitForSingleObject(pi.hProcess, (uint)timeoutMs);
                            if (w == WAIT_TIMEOUT) { r.Timeout = true; r.Cod = -1; }
                            else if (w == WAIT_OBJECT_0) {
                                uint c; GetExitCodeProcess(pi.hProcess, out c); r.Cod = unchecked((int)c);
                                r.OrfaniLaIesire = ActiveProcese(job);
                            } else { r.Etapa = "asteptare"; r.CodWin32 = Marshal.GetLastWin32Error(); r.Cod = -1; }
                        }
                        // mereu: tot ce a ramas in job se opreste (si copiii orfani dupa o iesire normala)
                        TerminateJobObject(job, 1);
                        DateTime limita = DateTime.UtcNow.AddMilliseconds(confirmareMs);
                        int activ = ActiveProcese(job);
                        while (activ != 0 && DateTime.UtcNow < limita) { Thread.Sleep(200); activ = ActiveProcese(job); }
                        r.OprireConfirmata = (activ == 0);
                        if (!r.OprireConfirmata) { int[] l = ListaProcese(job); r.Ramase = l ?? new int[0]; }
                        int asteptare = r.OprireConfirmata ? 30000 : 2000;
                        r.Out = Rezultatul(tOut, asteptare);
                        r.Err = Rezultatul(tErr, asteptare);
                        if (tIn != null) { try { tIn.Wait(2000); } catch (AggregateException) { } }
                        return r;
                    } finally { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); }
                }
            } finally { CloseHandle(job); }
        }
    }
}
'@

function Initialize-JobRunner {
  if (-not ('DialogTgzJob.Runner' -as [type])) {
    Add-Type -TypeDefinition $script:CodJob -Language CSharp -ReferencedAssemblies 'System.Core'
  }
}

# Viu = exista un proces cu acest PID pornit la acelasi moment (toleranta 1 s). Daca momentul nu se poate citi,
# se considera viu (fail-closed).
function Test-ProcesViu {
  param([Parameter(Mandatory)][int]$Id, [Parameter(Mandatory)][datetime]$Start)
  $p = Get-Process -Id $Id -ErrorAction SilentlyContinue
  if ($null -eq $p) { return $false }
  try { $s = $p.StartTime } catch { return $true }
  return ([math]::Abs(($s.ToUniversalTime() - $Start.ToUniversalTime()).TotalSeconds) -lt 1)
}

function Test-ProcesRamas {
  param([Parameter(Mandatory)]$Proces)
  if ($null -eq $Proces.Start) { return ($null -ne (Get-Process -Id $Proces.Pid -ErrorAction SilentlyContinue)) }
  return (Test-ProcesViu -Id $Proces.Pid -Start $Proces.Start)
}

# Marcajul "oprire neconfirmata": randuri "pid|ticks UTC" (0 = moment necunoscut: viu daca PID-ul exista) sau un singur
# rand "necunoscut" (lista proceselor din job nu s-a putut citi, sau o intrare nu are forma pid|ticks: blocheaza pana il
# sterge chat-ul, dupa verificare). Cat timp un proces listat e inca viu, nicio rulare noua nu porneste (EROARE).
function Write-MarcajProcese {
  param([Parameter(Mandatory)][string]$Cale, [AllowNull()][AllowEmptyCollection()][object[]]$Ramase)
  $linii = @(); $ok = $true
  foreach ($x in @($Ramase)) {
    if ($null -eq $x -or [string]$x -eq '') { continue }
    $m = [regex]::Match([string]$x, '^([0-9]{1,10})\|([0-9]{1,18})\z')
    if (-not $m.Success) { $ok = $false; break }
    $linii += (Format-Mesaj 'm.pid' @([long]$m.Groups[1].Value, [long]$m.Groups[2].Value))
  }
  if (-not $ok -or $linii.Count -eq 0) { $linii = @((Format-Mesaj 'm.necunoscut')) }
  Write-FisierSigur -Cale $Cale -Text (Format-Mesaj 'doc' @(, $linii)) -FaraLinieNoua
}

function Test-MarcajProcese {
  param([Parameter(Mandatory)][string]$Cale)
  if (-not (Test-Path -LiteralPath $Cale)) { return @{ Exista = $false; Vii = @(); Necunoscut = $false } }
  $vii = @(); $nec = $false
  foreach ($l in @((Read-TextUtf8 $Cale) -split "\r?\n" | Where-Object { $_.Trim() -ne '' })) {
    if ($l.Trim() -ceq 'necunoscut') { $nec = $true; continue }
    $m = [regex]::Match($l.Trim(), '^([0-9]{1,10})\|([0-9]{1,18})\z')
    if (-not $m.Success) { Stop-Dtgz 'marcaj_format' }
    $ticks = [long]$m.Groups[2].Value
    $start = if ($ticks -eq 0) { $null } else { New-Object DateTime $ticks, ([DateTimeKind]::Utc) }
    if (Test-ProcesRamas ([pscustomobject]@{ Pid = [int]$m.Groups[1].Value; Start = $start })) { $vii += [int]$m.Groups[1].Value }
  }
  return @{ Exista = $true; Vii = $vii; Necunoscut = $nec }
}

# Proces in Job Object, cu stdout / stderr capturate si stdin scris pe un fir separat (un copil care nu citeste
# stdin nu blocheaza timeout-ul). Intoarce @{Cod; Out; Err; Timeout; OprireConfirmata; Ramase (pid|ticks); OrfaniLaIesire;
# EtapaLansare (cod fix sau $null); CodWin32}. Out / Err sunt text extern: apelantul le citeste, nu le scrie.
function Invoke-ProcesCapturat {
  param([Parameter(Mandatory)][string]$Exe, [string[]]$Argumente, [hashtable]$Env = @{}, [string[]]$EnvSterse = @(),
        [string]$Cwd, [string]$Stdin, [int]$TimeoutSec = 600, [int]$ConfirmareSec = 30)
  Initialize-JobRunner
  $mediu = @{}
  foreach ($e in [System.Environment]::GetEnvironmentVariables().GetEnumerator()) { $mediu[[string]$e.Key] = [string]$e.Value }
  foreach ($k in $EnvSterse) { $mediu.Remove($k) }
  foreach ($k in $Env.Keys) { $mediu[$k] = [string]$Env[$k] }
  $octeti = if ($Stdin) { $script:Utf8FaraBom.GetBytes($Stdin) } else { [byte[]]@() }
  $r = [DialogTgzJob.Runner]::Run($Exe, (Join-ArgumenteWin $Argumente), $mediu, $Cwd, $octeti, $TimeoutSec * 1000, $ConfirmareSec * 1000)
  $ramase = @(foreach ($id in $r.Ramase) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    $ticks = 0
    if ($p) { try { $ticks = $p.StartTime.ToUniversalTime().Ticks } catch { $ticks = 0 } }
    '{0}|{1}' -f $id, $ticks
  })
  return @{ Cod = $r.Cod; Out = $r.Out; Err = $r.Err; Timeout = $r.Timeout; OprireConfirmata = [bool]$r.OprireConfirmata
            Ramase = $ramase; OrfaniLaIesire = $r.OrfaniLaIesire; EtapaLansare = $r.Etapa; CodWin32 = $r.CodWin32 }
}

# Utilizatori Postgres care pot scrie: refuzati inainte de conectare (garda principala e verificarea din BD,
# la inceputul sql\context_agregat.sql).
function Test-PgUserPermis {
  param([Parameter(Mandatory)][string]$PgUser)
  return -not ($PgUser -match '^(postgres|service_role|supabase_admin|supabase_auth_admin|supabase_storage_admin|authenticator|authenticated|anon)(\.|$)')
}

# stderr-ul psql (text extern: poate repeta date) -> clasa din lista inchisa + SQLSTATE (5 caractere [0-9A-Z]).
# r5: psql ruleaza cu VERBOSITY=sqlstate; garzile din SQL au coduri proprii (DTG01 scriere, DTG02 vizibil, DTG03 read only).
function Get-ClasaEroarePsql {
  param([AllowNull()][AllowEmptyString()][string]$Err)
  $e = [string]$Err
  $sql = $null
  $m = [regex]::Match($e, '(?m)(?:^|: )(?:ERROR|FATAL|PANIC):[ \t]+([0-9A-Z]{5})[ \t]*\r?$')
  if ($m.Success) { $sql = $m.Groups[1].Value }
  $clasa = 'necunoscut'
  if ($sql -ceq 'DTG01' -or $e -match 'dialog_tgz: rolul [^\r\n]* poate scrie') { $clasa = 'garda_scriere' }
  elseif ($sql -ceq 'DTG02' -or $e -match 'dialog_tgz: rolul [^\r\n]* nu vede') { $clasa = 'garda_vizibil' }
  elseif ($sql -ceq 'DTG03' -or $e -match 'dialog_tgz: tranzactia nu este READ ONLY') { $clasa = 'garda_read_only' }
  elseif ($e -match '(?i)password authentication failed|no password supplied|authentication failed') { $clasa = 'autentificare' }
  elseif ($e -match '(?i)timeout expired') { $clasa = 'timeout_conexiune' }
  elseif ($e -match '(?i)could not connect|connection to server|could not translate host name|connection refused') { $clasa = 'conexiune' }
  elseif ($sql) { $clasa = 'eroare_sql' }
  return @{ Clasa = $clasa; SqlState = $sql }
}

# psql cu fisier .sql FIX din repo, fara variabile psql in SQL.
function Invoke-PsqlFisier {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$FisierSql)
  if (-not (Test-PgUserPermis $Config.PgUser)) { Stop-Dtgz 'pguser' }
  $a = @('-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-h', $Config.PgHost, '-p', [string]$Config.PgPort,
         '-U', $Config.PgUser, '-d', $Config.PgDb, '-f', $FisierSql)
  $r = Invoke-ProcesCapturat -Exe $Config.PsqlExe -Argumente $a -TimeoutSec 180 `
       -Env @{ PGCLIENTENCODING = 'UTF8'; PGCONNECT_TIMEOUT = '20'; PGAPPNAME = 'dialog_tgz' } -EnvSterse @('PGPASSWORD')
  return @{ Cod = $r.Cod; Linii = @($r.Out -split "\r?\n"); Err = $r.Err; Timeout = $r.Timeout; OprireConfirmata = $r.OprireConfirmata
            Ramase = $r.Ramase; EtapaLansare = $r.EtapaLansare; CodWin32 = $r.CodWin32 }
}

# Agentul: citeste dialogul, contextul si radacinile NAS (--add-dir); SCRIE doar in folderul de iesire al rularii
# (directorul de lucru). Nicio regula de scriere pe dialog.
function Get-ArgumenteClaude {
  param([Parameter(Mandatory)][hashtable]$Config, [string[]]$Radacini, [Parameter(Mandatory)][string]$DirIntrare, [Parameter(Mandatory)][string]$DirIesire)
  $regula = 'Edit(' + (ConvertTo-CaleRegula $DirIesire) + '/**)'
  $a = @('-p',
         '--model', $Config.Model,
         '--effort', $Config.Effort,
         '--max-turns', [string]$Config.MaxTurns,
         '--restricted',
         '--tools', 'Read,Glob,Grep,Edit,Write',
         '--allowedTools', ('Read,Glob,Grep,' + $regula),
         '--disallowedTools', 'Bash,PowerShell,WebFetch,WebSearch',
         '--permission-mode', 'dontAsk',
         '--strict-mcp-config',
         '--no-session-persistence',
         '--disable-slash-commands',
         '--output-format', 'json',
         '--add-dir', $Config.DialogDir,
         '--add-dir', $DirIntrare)
  foreach ($r in $Radacini) { $a += @('--add-dir', $r) }
  return ,$a
}

# stdout-ul `claude -p --output-format json`: un obiect cu type=result. Succes DOAR pentru subtype=success si
# is_error=false. r5: campurile se reduc la coduri din liste inchise (alt / lipsa); textul raspunsului nu se foloseste.
# Intoarce @{Ok; Motiv (cod motiv_cli sau ''); Desc (text sigur)}.
function ConvertFrom-IesireClaude {
  param([AllowNull()][AllowEmptyString()][string]$Out)
  $fara = Format-Mesaj 'cli.desc' @('lipsa', 'lipsa', 'lipsa', $null)
  if ($null -eq $Out -or $Out.Trim() -eq '') { return @{ Ok = $false; Motiv = 'stdout_gol'; Desc = $fara } }
  try { $j = $Out.Trim() | ConvertFrom-Json } catch { return @{ Ok = $false; Motiv = 'stdout_nu_e_json'; Desc = $fara } }
  if ($j -is [array]) { return @{ Ok = $false; Motiv = 'stdout_lista'; Desc = $fara } }
  if (-not ($j -is [System.Management.Automation.PSCustomObject])) { return @{ Ok = $false; Motiv = 'stdout_nu_e_json'; Desc = $fara } }
  $v = @{}
  foreach ($k in 'type', 'subtype', 'is_error', 'num_turns') {
    $p = @($j.PSObject.Properties | Where-Object { $_.Name -ceq $k })
    $v[$k] = if ($p.Count -eq 1) { $p[0].Value } else { $null }
  }
  $tCod = if ($null -eq $v.type) { 'lipsa' } elseif ($v.type -is [string] -and $v.type -ceq 'result') { 'result' } else { 'alt' }
  $sCod = 'alt'
  if ($null -eq $v.subtype) { $sCod = 'lipsa' }
  elseif ($v.subtype -is [string] -and $v.subtype -cne 'alt' -and $v.subtype -cne 'lipsa' -and $script:Liste.cli_subtype -ccontains $v.subtype) { $sCod = $v.subtype }
  $bCod = if ($null -eq $v.is_error) { 'lipsa' } elseif ($v.is_error -is [bool]) { if ($v.is_error) { 'true' } else { 'false' } } else { 'alt' }
  $nt = if ((Test-Intreg $v.num_turns) -and $v.num_turns -ge 0) { $v.num_turns } else { $null }
  $desc = Format-Mesaj 'cli.desc' @($tCod, $sCod, $bCod, $nt)
  if ($tCod -cne 'result') { return @{ Ok = $false; Motiv = 'fara_type_result'; Desc = $desc } }
  if ($sCod -cne 'success') { return @{ Ok = $false; Motiv = 'fara_succes'; Desc = $desc } }
  if ($bCod -cne 'false') { return @{ Ok = $false; Motiv = 'is_error'; Desc = $desc } }
  return @{ Ok = $true; Motiv = ''; Desc = $desc }
}

function Invoke-ClaudeReal {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$Prompt, [Parameter(Mandatory)][string]$Token,
        [string[]]$Radacini, [Parameter(Mandatory)][string]$DirIntrare, [Parameter(Mandatory)][string]$DirIesire)
  # r5: configuratia Claude Code a rularii sta in folderul rularii (langa intrare / iesire, in afara directoarelor date
  # agentului) si se sterge odata cu el: nimic din ce scrie CLI-ul nu ramane pe disc dupa rulare.
  $cfgDir = Join-Path (Split-Path -Parent $DirIesire) 'cfg'
  if (-not (Test-Path -LiteralPath $cfgDir)) { [void](New-Item -ItemType Directory -Path $cfgDir) }
  $envNou = @{ CLAUDE_CODE_OAUTH_TOKEN = $Token; CLAUDE_CONFIG_DIR = $cfgDir; DISABLE_AUTOUPDATER = '1' }
  $r = Invoke-ProcesCapturat -Exe $Config.ClaudeExe -Argumente (Get-ArgumenteClaude $Config $Radacini $DirIntrare $DirIesire) -Env $envNou `
       -EnvSterse @('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX') `
       -Cwd $DirIesire -Stdin $Prompt -TimeoutSec ([int]$Config.TimeoutMin * 60)
  return $r
}

# ---------------------------------------------------------------- fluxul complet

# Intoarce @{Stare = GATA|OPRIT|EROARE|NIMIC NOU; Text (text sigur); Linie (= Text.Text); Cod}. Nu arunca.
# $Psql: { param($FisierSql) -> @{Cod; Linii; Err; OprireConfirmata; Ramase; [EtapaLansare; CodWin32]} }
# $Claude: { param([string]$Prompt, [string]$Token, [string[]]$Radacini, [string]$DirIntrare, [string]$DirIesire)
#            -> @{Cod; Out; Err; Timeout; OprireConfirmata; Ramase; [OrfaniLaIesire; EtapaLansare; CodWin32]} }
# $Log: { param($Text) }  - primeste DOAR texte sigure (Format-Mesaj); in productie: Write-JurnalSigur.
# $Asteapta: { param([int]$Sec) } fereastra dintre cele doua re-verificari de coliziune (in test: injecteaza un juridic#).
# Config: DialogDir, TokenFile, WorkDir, SqlDir, PromptFile, SchemaFile, CaleCursor, CaleMarcaj,
#         RadaciniAtasamente, Model, Effort, MaxTurns, TimeoutMin, [IdRulare], [AsteptareColiziuneSec], [MutariColiziune]
function Invoke-DialogTgz {
  param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][scriptblock]$Psql,
        [Parameter(Mandatory)][scriptblock]$Claude, [Parameter(Mandatory)][scriptblock]$Log, [datetime]$Acum = (Get-Date),
        [scriptblock]$Asteapta = { param([int]$Sec) if ($Sec -gt 0) { Start-Sleep -Seconds $Sec } })
  function M { param([string]$Id) return (Format-Mesaj $Id $args) }
  function Rez([string]$Stare, $Text, [int]$Cod) { return (New-Rezultat $Stare $Text $Cod) }
  function Eroare($Text) { return (New-Rezultat 'EROARE' (Format-Mesaj 'r.eroare' @(, $Text)) 1) }
  # rezultatele psql / claude sunt hashtable-uri cu chei optionale: se citesc DOAR cu indexer ($h['x'] = $null daca lipseste)
  function Test-OprireOk($R) { return ($R -is [hashtable] -and $R['OprireConfirmata'] -is [bool] -and $R['OprireConfirmata']) }
  function Write-LansareEsuata([string]$Proces, $R) {
    if (-not ($R -is [hashtable]) -or $null -eq $R['EtapaLansare'] -or [string]$R['EtapaLansare'] -eq '') { return }
    $et = if ($script:Liste.etapa_lansare -ccontains [string]$R['EtapaLansare']) { [string]$R['EtapaLansare'] } else { 'necunoscuta' }
    $w = if (Test-Intreg $R['CodWin32']) { $R['CodWin32'] } else { 0 }
    & $L (M 'j.lansare' $Proces $et $w)
  }
  $L = { param($T) if (-not (Test-TextSigur $T)) { Stop-Dtgz 'iesire_nesigura' }; & $Log $T }
  $asteptareSec = if ($Config.ContainsKey('AsteptareColiziuneSec')) { [int]$Config.AsteptareColiziuneSec } else { 0 }
  $mutari = if ($Config.ContainsKey('MutariColiziune')) { [int]$Config.MutariColiziune } else { 5 }
  $dirRulare = $null; $dirCreat = $false
  try {
    # (0) configurarea: model / effort din listele inchise (valoarea respinsa nu se scrie), numere intregi
    if ($script:Liste.model -cnotcontains [string]$Config['Model']) { return (Eroare (M 'e.model')) }
    if ($script:Liste.effort -cnotcontains [string]$Config['Effort']) { return (Eroare (M 'e.effort')) }
    if (-not (Test-Intreg $Config['MaxTurns']) -or -not (Test-Intreg $Config['TimeoutMin'])) { return (Eroare (M 'e.config_numar')) }

    # (0b) o rulare anterioara cu oprire neconfirmata blocheaza pana dispar procesele ei
    $mc = Test-MarcajProcese $Config.CaleMarcaj
    if ($mc.Exista) {
      if ($mc.Vii.Count -gt 0 -or $mc.Necunoscut) { return (Eroare (M 'e.procese_vii' $mc.Vii.Count $mc.Necunoscut)) }
      Remove-Item -LiteralPath $Config.CaleMarcaj -Force
      & $L (M 'j.marcaj_sters')
    }

    # (1) token, folder, contractul raspunsului
    $tok = Read-TokenFisier $Config.TokenFile
    if (-not $tok.Ok) { return (Eroare $tok.Motiv) }
    & $L (M 'j.token_ok')
    $folder = Get-Item -LiteralPath $Config.DialogDir -ErrorAction SilentlyContinue
    if ($null -eq $folder -or -not $folder.PSIsContainer -or (Test-EsteReparse $folder)) { return (Eroare (M 'e.dialog_lipsa')) }
    $schema = Read-SchemaRaspuns $Config.SchemaFile

    # (2) cursorul local + resturile rularilor oprite brusc (sub lock-ul global)
    $ultimul = Read-Cursor $Config.CaleCursor
    & $L (M 'j.cursor' $ultimul)
    $nTmp = Remove-TemporareProprii $Config.DialogDir
    if ($nTmp -gt 0) { & $L (M 'j.temporare_sterse' $nTmp) }
    $nRulari = Remove-RulariRamase $Config.WorkDir
    if ($nRulari -gt 0) { & $L (M 'j.rulari_sterse' $nRulari) }

    # (3) fisiere noi + amprentele lor
    $noi = Find-JuridicNoi -Folder $Config.DialogDir -UltimulProcesat $ultimul
    $amprente = @{}
    foreach ($f in $noi) { $amprente[[int]$f.Numar] = Get-Sha256Fisier $f.Cale }
    $numere = @($noi | ForEach-Object { [int]$_.Numar })

    # (3b) reconciliere cu dialogul: un GATA publicat deja pentru mesaje inca necursate (rulare oprita intre publicare
    # si cursor) = doar avans de cursor, fara inferenta noua. Potrivirea = cheia (numere + amprente exacte).
    $proprii = Get-RaspunsuriProprii $Config.DialogDir
    $gata = @($proprii | Where-Object { $_.Stare -eq 'GATA' -and @($_.Juridic | Where-Object { $numere -notcontains $_ }).Count -eq 0 -and
                                        $_.Cheie -ceq (Get-CheieIntentie $_.Juridic $amprente) })
    if ($gata.Count -gt 1) { return (Eroare (M 'e.gata_multiple' @($gata | ForEach-Object { $_.Numar }))) }
    if ($gata.Count -eq 1) {
      $g = $gata[0]
      $maxG = [int]($g.Juridic | Measure-Object -Maximum).Maximum
      $lipsa = @($numere | Where-Object { $_ -le $maxG -and $g.Juridic -notcontains $_ })
      if ($lipsa.Count -gt 0) { return (Eroare (M 'e.gata_neacoperit' $g.Numar $lipsa)) }
      $col = Resolve-ColiziuneNumar -Folder $Config.DialogDir -Numar $g.Numar -Mutari $mutari
      foreach ($x in $col.Mutari) { & $L (M 'j.coliziune' $x.De $x.La) }
      $rand = Write-Cursor -Cale $Config.CaleCursor -Vechi $ultimul -NrJuridic $maxG -NrClaude $col.Numar -Cand $Acum
      & $L (M 'j.reconciliere' $col.Numar $g.Juridic $rand)
      $ultimul = $maxG
      $noi = @($noi | Where-Object { $_.Numar -gt $maxG })
      $numere = @($noi | ForEach-Object { [int]$_.Numar })
      if ($noi.Count -eq 0) { return (Rez 'GATA' (M 'r.gata_reconciliat' $col.Numar) 0) }
    }
    if ($noi.Count -eq 0) {
      & $L (M 'j.nimic_nou')
      return (Rez 'NIMIC NOU' (M 'r.nimic_nou' $ultimul) 0)
    }
    $cheie = Get-CheieIntentie $numere $amprente
    $oprit = @($proprii | Where-Object { $_.Stare -eq 'OPRIT' -and $_.Cheie -ceq $cheie })
    if ($oprit.Count -gt 0) {
      # r4: inainte de iesirea "deja publicat", aceeasi recuperare a coliziunii ca la GATA (nerezolvata = EROARE)
      $numeOprit = @()
      foreach ($o in $oprit) {
        try { $col = Resolve-ColiziuneNumar -Folder $Config.DialogDir -Numar $o.Numar -Mutari $mutari }
        catch { return (Eroare (M 'e.oprit_coliziune' $o.Numar (ConvertTo-MesajEroare $_))) }
        foreach ($x in $col.Mutari) { & $L (M 'j.coliziune_oprit' $x.De $x.La) }
        $numeOprit += $col.Numar
      }
      & $L (M 'j.oprit_deja' $numeOprit)
      return (Rez 'OPRIT' (M 'r.oprit_deja' $numeOprit) 0)
    }
    $maxJuridic = [int]($numere | Measure-Object -Maximum).Maximum
    & $L (M 'j.fisiere_noi' $numere $cheie)

    # (4) folderul privat al rularii: intrare (context) + iesire (singurul loc unde agentul poate scrie) + cfg (CLI)
    $id = if ($Config.ContainsKey('IdRulare') -and $Config.IdRulare) { [string]$Config.IdRulare } else { [guid]::NewGuid().ToString('N') }
    if ($id -cnotmatch $script:TiparIdRulare) { return (Eroare (M 'e.id_rulare')) }
    $dirRulare = Join-Path (Join-Path $Config.WorkDir 'rulari') $id
    if (Test-Path -LiteralPath $dirRulare) { return (Eroare (M 'e.folder_rulare_exista')) }
    $dirIntrare = Join-Path $dirRulare 'intrare'
    $dirIesire = Join-Path $dirRulare 'iesire'
    [void](New-Item -ItemType Directory -Path $dirIntrare -Force)
    $dirCreat = $true
    [void](New-Item -ItemType Directory -Path $dirIesire)
    $caleAgent = Join-Path $dirIesire $script:NumeRaspunsAgent

    # (5) context agregat (psql, doar citire; SQL-ul refuza un rol care poate scrie), citit si VALIDAT ca tabele
    $caleContext = Join-Path $dirIntrare 'context.md'
    $r = & $Psql (Join-Path $Config.SqlDir 'context_agregat.sql')
    Write-LansareEsuata 'psql' $r
    if (-not (Test-OprireOk $r)) {
      $ram = if ($r -is [hashtable]) { @($r['Ramase']) } else { @() }
      Write-MarcajProcese $Config.CaleMarcaj $ram
      return (Eroare (M 'e.psql_oprire'))
    }
    $errP = [string]$r['Err']
    if (-not (Test-Intreg $r['Cod']) -or $r['Cod'] -ne 0) {
      $cl = Get-ClasaEroarePsql $errP
      $codP = if (Test-Intreg $r['Cod']) { $r['Cod'] } else { -1 }
      return (Eroare (M 'e.psql' $codP $cl.Clasa $cl.SqlState $errP.Length))
    }
    try { $export = ConvertFrom-ExportContext @($r['Linii']); Test-ExportFataDeSchema $export $schema }
    catch { return (Rez 'EROARE' (M 'r.export' (ConvertTo-MesajEroare $_)) 1) }
    foreach ($nr in @($export.Keys | Sort-Object)) {
      foreach ($c in @($export[$nr].Inlocuite.Keys | Sort-Object)) { & $L (M 'j.export_inlocuite' ([int]$nr) ([string]$c) ([int]$export[$nr].Inlocuite[$c])) }
    }
    $ctx = ConvertTo-ContextSigur -Export $export -Schema $schema -Acum $Acum
    Write-FisierSigur -Cale $caleContext -Text $ctx.Text -FaraLinieNoua
    & $L (M 'j.context' $ctx.Sectiuni $ctx.Randuri)

    # (6) agentul
    $radacini = @($Config.RadaciniAtasamente | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) })
    & $L (M 'j.radacini' $radacini.Count (@($Config.RadaciniAtasamente | Where-Object { $_ }).Count))
    $valori = Get-ValoriPromptSchema $schema
    $valori['FISIERE_JURIDIC'] = (($noi | ForEach-Object { '- ' + $_.Cale }) -join "`n")
    $valori['JURIDIC_NUMERE'] = (($numere | ForEach-Object { 'juridic#{0:000} ("juridic": {1})' -f $_, $_ }) -join ', ')
    $valori['CALE_RASPUNS'] = $caleAgent
    $valori['CALE_CONTEXT'] = $caleContext
    $valori['FOLDER_DIALOG'] = $Config.DialogDir
    $valori['RADACINI_ATASAMENTE'] = $(if ($radacini.Count) { ($radacini | ForEach-Object { '- ' + $_ }) -join "`n" } else { '- (niciuna accesibila pe acest calculator)' })
    $valori['DATA'] = $Acum.ToString('yyyy-MM-ddTHH:mm:sszzz')
    $valori['ULTIMUL_PROCESAT'] = ('{0:000}' -f $ultimul)
    $prompt = Format-Prompt (Read-TextUtf8 $Config.PromptFile) $valori
    $inainte = Get-InstantaneuDialog $Config.DialogDir
    & $L (M 'j.pornesc_claude' ([string]$Config['Model']) ([string]$Config['Effort']) $Config['MaxTurns'])
    $rc = & $Claude $prompt $tok.Token $radacini $dirIntrare $dirIesire
    $tok = $null
    if (-not ($rc -is [hashtable])) { $rc = @{} }
    $oprireOk = Test-OprireOk $rc
    $codC = $rc['Cod']; $codOk = Test-Intreg $codC
    $timeout = ($rc['Timeout'] -is [bool]) -and $rc['Timeout']
    $ramC = @($rc['Ramase'] | Where-Object { $null -ne $_ })
    if ($codOk) {
      if ($timeout) { & $L (M 'j.claude_timeout' $codC $oprireOk) } else { & $L (M 'j.claude_cod' $codC) }
    }
    if ((Test-Intreg $rc['OrfaniLaIesire']) -and $rc['OrfaniLaIesire'] -gt 0) { & $L (M 'j.claude_orfani' $rc['OrfaniLaIesire']) }
    Write-LansareEsuata 'claude' $rc
    # stderr-ul agentului e text extern: in jurnal intra doar lungimea
    $errC = [string]$rc['Err']
    if ($errC.Length -gt 0) { & $L (M 'j.claude_stderr' $errC.Length) }

    # (7) esecurile procesului: nimic nu se publica, cursorul nu avanseaza
    if (-not $oprireOk) {
      Write-MarcajProcese $Config.CaleMarcaj $ramC
      return (Eroare (M 'e.claude_oprire' $ramC.Count))
    }
    if ($timeout) { return (Eroare (M 'e.claude_timeout' $Config['TimeoutMin'])) }
    if (-not $codOk) { return (Eroare (M 'e.claude_cod_lipsa')) }
    if ($codC -ne 0) { return (Eroare (M 'e.claude_cod' $codC)) }
    $ij = ConvertFrom-IesireClaude ([string]$rc['Out'])
    & $L (M 'j.claude_rezultat' $ij.Desc)
    if (-not $ij.Ok) { return (Eroare (M 'e.claude_rezultat' $ij.Motiv)) }

    # (8) iesirea agentului: exact raspuns.json, fisier obisnuit, nimic altceva
    $elemente = @(Get-ChildItem -LiteralPath $dirIesire -Force -Recurse -ErrorAction Stop)
    $straine = @($elemente | Where-Object { $_.FullName -ne $caleAgent -or $_.PSIsContainer -or (Test-EsteReparse $_) })
    if ($straine.Count -gt 0) { return (Eroare (M 'e.iesire_straine' $straine.Count)) }
    if (-not (Test-Path -LiteralPath $caleAgent -PathType Leaf)) { return (Eroare (M 'e.fara_raspuns')) }

    # (9) dialogul: nimic atins, intrarile neschimbate, nicio intrebare noua sarita (doar contoare, fara nume)
    $dif = Compare-InstantaneuDialog -Inainte $inainte -Dupa (Get-InstantaneuDialog $Config.DialogDir)
    if ($dif.Total -gt 0) {
      & $L (M 'j.dialog_atins' $dif.Sterse $dif.Modificate $dif.Noi)
      return (Eroare (M 'e.dialog_schimbat' $dif.Sterse $dif.Modificate $dif.Noi))
    }
    foreach ($f in $noi) {
      if (-not (Test-Path -LiteralPath $f.Cale -PathType Leaf) -or (Get-Sha256Fisier $f.Cale) -ne $amprente[[int]$f.Numar]) {
        return (Eroare (M 'e.juridic_schimbat' ([int]$f.Numar)))
      }
    }
    $dupa = Find-JuridicNoi -Folder $Config.DialogDir -UltimulProcesat $ultimul   # in variabila: ,@() nu se enumera in pipe
    $tarzii = @($dupa | Where-Object { $numere -notcontains [int]$_.Numar -and $_.Numar -lt $maxJuridic } | ForEach-Object { [int]$_.Numar })
    if ($tarzii.Count -gt 0) { return (Eroare (M 'e.tarzii' $tarzii)) }

    # (10) raspunsul: contractul JSON, apoi compunerea de catre program (doar sabloane + valori tipizate)
    $va = Test-RaspunsAgent -Cale $caleAgent -Schema $schema -Export $export -Juridic $numere
    if (-not $va.Ok) {
      & $L (M 'j.raspuns_respins' $va.Motiv)
      return (Rez 'EROARE' (M 'r.nepublicat' $va.Motiv) 1)
    }
    $date = $va.Date
    & $L (M 'j.raspuns_valid' ([string]$date.Stare) (@($date.Mesaje).Count))
    if ($date.Stare -eq 'EROARE') { return (Eroare (M 'e.agent_eroare' ([string]$date.MotivEroare))) }
    try { $text = Format-RaspunsPublicat -Date $date -Schema $schema -Cheie $cheie -Data $Acum }
    catch { return (Rez 'EROARE' (M 'r.nepublicat' (ConvertTo-MesajEroare $_)) 1) }

    # (11) publicare exclusiva + re-verificarea numarului (imediat si dupa fereastra de asteptare)
    $pub = Publish-RaspunsExclusiv -Folder $Config.DialogDir -Text $text -Cheie $cheie
    & $L (M 'j.publicat' $pub.Numar $numere)
    try {
      $col = Resolve-ColiziuneNumar -Folder $Config.DialogDir -Numar $pub.Numar -Mutari $mutari
      & $Asteapta $asteptareSec
      $col = Resolve-ColiziuneNumar -Folder $Config.DialogDir -Numar $col.Numar -Mutari $mutari
    } catch {
      return (Rez 'EROARE' (M 'r.publicat_coliziune' (ConvertTo-MesajEroare $_)) 1)
    }
    if ($col.Numar -ne $pub.Numar) { & $L (M 'j.mutat' $col.Numar) }

    if ($date.Stare -eq 'OPRIT') {
      & $L (M 'j.oprit_cursor')
      return (Rez 'OPRIT' (M 'r.oprit' ([string]$date.MotivOprire) $col.Numar) 0)
    }

    # (12) cursorul local, cu CAS pe valoarea citita la (2)
    try { $rand = Write-Cursor -Cale $Config.CaleCursor -Vechi $ultimul -NrJuridic $maxJuridic -NrClaude $col.Numar -Cand $Acum }
    catch { return (Rez 'EROARE' (M 'r.cursor_dupa_publicare' $col.Numar (ConvertTo-MesajEroare $_)) 1) }
    & $L (M 'j.cursor_scris' $rand)
    return (Rez 'GATA' (M 'r.gata' $col.Numar) 0)
  } catch {
    return (Get-RezultatExceptie $_)
  } finally {
    # folderul rularii (context, raspuns.json al agentului, configuratia CLI) nu ramane pe disc, oricum s-a terminat
    if ($dirCreat -and $dirRulare) {
      Remove-Item -LiteralPath $dirRulare -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $dirRulare) { try { & $L (M 'j.rulare_nestearsa') } catch { } }
    }
  }
}

Export-ModuleMember -Function *
