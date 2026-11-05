# Offline only: extract actual functions through AST, never dot-source launcher.
# Windows PowerShell 5.1. No CDP, child launcher, install or network.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'run_paw.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
foreach($name in @('CaleSigura')){
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
