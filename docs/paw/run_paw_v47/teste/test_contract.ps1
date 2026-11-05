# Offline only: extract actual functions through AST, never dot-source launcher.
# Windows PowerShell 5.1. No CDP, child launcher, install or network.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'run_paw.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
foreach($name in @('CaleSigura','CxwRemaining','CxwProtocolState','Ruleaza','Arg')){
 $node=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 if(-not $node){throw 'Function missing'}
 . ([scriptblock]::Create($node.Extent.Text))
}
$source=[IO.File]::ReadAllText((Join-Path $root 'run_paw.ps1'))
$regexes=[regex]::Matches($source,"\\Ahttps://chatgpt\\.com/codex/tasks/task_\[a-f0-9\]\{16,64\}\\z")
if($regexes.Count -ne 2){throw 'URL gates missing or inconsistent'}
$fixtures=Get-Content (Join-Path $PSScriptRoot 'contract_cases.json') -Raw|ConvertFrom-Json
foreach($row in $fixtures.urls){
 if(($row.value -cmatch $regexes[0].Value) -ne $row.valid){throw 'URL fixture mismatch'}
}
# Same JSON wire shape as Python. Pre-Send waiting is success with a URL,
# but HOME is never accepted for a submitted/completed task or continuation.
$url='https://chatgpt.com/codex/tasks/task_0123456789abcdef'
foreach($case in @(
 @{mode='cxw';url=$url;state='gata';submitted=$true;valid=$true},
 @{mode='cxw';url='https://chatgpt.com/codex';state='asteapta_confirmare';submitted=$false;valid=$true},
 @{mode='cxw-continua';url=$url;state='asteapta_confirmare';submitted=$false;valid=$true},
 @{mode='cxw';url='https://chatgpt.com/codex';state='gata';submitted=$false;valid=$false},
 @{mode='cxw-continua';url='https://chatgpt.com/codex';state='asteapta_confirmare';submitted=$false;valid=$false},
 @{mode='cxw';url=$url;state='gata';submitted=$false;valid=$false},
 @{mode='cxw';url=$url;state='gata';submitted='false';valid=$false},
 @{mode='cxw';url=$url;state='unknown';submitted=$true;valid=$false}
)) {
 $payload=(@{state=$case.state;chat_url=$case.url;submitted=$case.submitted}|ConvertTo-Json|ConvertFrom-Json)
 $valid=$true
 try{$actual=CxwProtocolState $case.mode $url $payload;if($actual -cne $case.state){throw 'Wrong state'}}catch{$valid=$false}
 if($valid -ne $case.valid){throw 'Protocol fixture mismatch'}
}
if((CxwRemaining 60 59) -ne 1 -or (CxwRemaining 2400 30.2) -ne 2369){throw 'Remaining time mismatch'}
$expired=$false
try{[void](CxwRemaining 60 60)}catch{$expired=$true}
if(-not $expired){throw 'Expired deadline accepted'}
# Actual process runner must reject an expired common clock BEFORE Process.Start.
# Only the Job-binding call is stubbed; no child is created in this test.
function LeagaCopiiiDeLansator {}
$runnerExpired=$false
try { [void](Ruleaza 'paw-never-start-this-executable' @('fixture','1') '' $root 60 $null $false $false ([Diagnostics.Stopwatch]::StartNew()) 0) }
catch { if($_.Exception.Message -cne 'cxw_deadline_epuizat_inainte_de_pornire'){throw};$runnerExpired=$true }
if(-not $runnerExpired){throw 'Runner accepted an expired common deadline'}
if($env:OS -ne 'Windows_NT') {
 'PASS: PowerShell AST, URL/protocol and deadline fixtures; SKIP Windows paths/junction'
 exit 0
}
$brief='C:\Users\Public\paw-data\brief'
foreach($row in $fixtures.paths){
 $valid=$true
 try{[void](CaleSigura $row.value @($brief) $false)}catch{$valid=$false}
 if($valid -ne $row.valid){throw 'Path fixture mismatch'}
}
# Real reparse fixture in a test directory, without requiring symlink privilege.
$fixture=Join-Path $env:TEMP ('paw-v47-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixture)
try {
 $target=Join-Path $fixture 'target';[void][IO.Directory]::CreateDirectory($target)
 $link=Join-Path $fixture 'junction'
 [void](New-Item -ItemType Junction -Path $link -Target $target)
 $refused=$false
 try{[void](CaleSigura (Join-Path $link 'brief.txt') @($fixture) $false)}catch{$refused=$_.Exception.Message -like '*reparse point refuzat*'}
 if(-not $refused){throw 'Reparse gate failed'}
} finally {
 if(Test-Path -LiteralPath (Join-Path $fixture 'junction')){[IO.Directory]::Delete((Join-Path $fixture 'junction'))}
 if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Recurse -Force}
}
'PASS: launcher parse, shared URL/path fixtures, real junction rejection'
