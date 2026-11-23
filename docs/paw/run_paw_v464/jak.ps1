# Profil separat jak: fara integrari sau variabile mostenite.
function GetJakConfig {
 return @'
approval_policy = "never"
sandbox_mode = "read-only"
forced_login_method = "chatgpt"
cli_auth_credentials_store = "file"
notify = []

[windows]
sandbox = "unelevated"

[features]
apps = false
plugins = false
remote_plugin = false
skill_mcp_dependency_install = false
hooks = false

[projects.'C:\Users\Gazpet-Ai\gazpet-erp']
trust_level = "untrusted"

'@
}

function InitializeJakProfile([string]$pawRoot,[string]$readerSid) {
 # Apel exclusiv din Install, sub bariera globala si cu lansatoarele oprite.
 $state=Join-Path $pawRoot 'state';[void](AssertCdxPath $state)
 if(-not(Test-Path -LiteralPath $state)){[void][IO.Directory]::CreateDirectory($state);SetCdxAdminAcl $state $readerSid}
 AssertCdxAdminAcl $state
 $jakHomePath=Join-Path $state 'jak-home';[void](AssertCdxPath $jakHomePath)
 if(-not(Test-Path -LiteralPath $jakHomePath)){
  [void][IO.Directory]::CreateDirectory($jakHomePath)
  # Ca la cdx: home modificabil pentru login/cache, config protejat separat.
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  foreach($sid in @('S-1-5-18','S-1-5-32-544',$readerSid)){
   $rights=if($sid -eq $readerSid){'Modify'}else{'FullControl'}
   $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),$rights,'ContainerInherit,ObjectInherit','None','Allow')))
  }
  Set-Acl -LiteralPath $jakHomePath -AclObject $acl
 }
 $config=Join-Path $jakHomePath 'config.toml';[void](AssertCdxPath $config)
 if(Test-Path -LiteralPath $config){AssertCdxSingleFile $config}
 [IO.File]::WriteAllText($config,(GetJakConfig),(New-Object Text.UTF8Encoding($false)))
 SetCdxAdminAcl $config $readerSid

}

function GetJakRuntime {
 # Aceeasi instalare protejata ca la cdx; fara rezolvare npm/PATH din profil.
 $cfgPath=Join-Path $PSScriptRoot 'cdx_install.json'
 AssertCdxSingleFile $cfgPath;AssertCdxAdminAcl $cfgPath
 $cfg=Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
 if($cfg.schema -ne 2 -or $cfg.version -cne '0.162.0'){throw 'jak_runtime_versiune'}
 $root=AssertCdxPath ([IO.Path]::GetFullPath([string]$cfg.runtime_root))
 if(-not $root.StartsWith((Join-Path $PAW_ROOT 'codex')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'jak_runtime_outside'}
 foreach($p in @($PAW_ROOT,(Join-Path $PAW_ROOT 'codex'),$root)){AssertCdxAdminAcl $p}
 foreach($entry in GetCdxTree $root){AssertCdxAdminAcl $entry.FullName}
 $manifest=Join-Path $PSScriptRoot 'cdx_runtime_manifest.json'
 AssertCdxSingleFile $manifest;AssertCdxAdminAcl $manifest
 AssertCdxHashes (GetCdxTreeHashes $root) (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)
 $node=Join-Path $root 'node.exe';$cli=Join-Path $root 'package\bin\codex.js'
 AssertCdxSingleFile $node;AssertCdxSingleFile $cli
 return @{exe=$node;cli=$cli}
}

function GetJakOverrides([string]$repo) {
 $overrides=@('-c','windows.sandbox="unelevated"','-c','notify=[]')
 foreach($setting in @('features.apps=false','features.plugins=false','features.remote_plugin=false','features.skill_mcp_dependency_install=false','features.hooks=false')){
  $overrides+=@('-c',$setting)
 }
 $repoToml=$repo.Replace('\','\\').Replace('"','\"')
 $overrides+=@('-c',('projects."'+$repoToml+'".trust_level="untrusted"'))
 return ,$overrides
}

# CLI 0.162.0: only System/User/Project layers have a rules folder.
# --ignore-rules covers User/Project. Reject ALL local system policy inputs;
# do not attempt to parse Starlark/TOML with a permissive regex.
function GetJakSystemPolicyRoots {
 $common=[Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
 if([string]::IsNullOrWhiteSpace($common)){throw 'jak_rules_neverificabile'}
 return @((Join-Path $common 'OpenAI\Codex'),'C:\ProgramData\OpenAI\Codex') | Select-Object -Unique
}
function GetJakPolicyItem([string]$path) {
 try {return Get-Item -LiteralPath $path -Force -ErrorAction Stop}
 catch [Management.Automation.ItemNotFoundException] {return $null}
 catch {throw 'jak_rules_neverificabile'}
}
function AssertJakRules([string]$jakHomePath) {
 try {
  foreach($root in @(GetJakSystemPolicyRoots)){
   # Check ancestors too: a junction must not redirect the policy namespace.
   $cursor=$root
   while($cursor){
    $item=GetJakPolicyItem $cursor
    if($item -and ((-not $item.PSIsContainer) -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint))){throw 'policy'}
    $cursor=Split-Path $cursor -Parent
   }
   foreach($name in @('config.toml','requirements.toml','managed_config.toml')){
    if(GetJakPolicyItem (Join-Path $root $name)){throw 'policy'}
   }
  }
  # Home rules also refused, even though exec ignores them: fail before MCP.
  foreach($root in @($jakHomePath)+@(GetJakSystemPolicyRoots)){
   $dir=GetJakPolicyItem (Join-Path $root 'rules')
   if($dir){
    if((-not $dir.PSIsContainer) -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'policy'}
    $files=@(Get-ChildItem -LiteralPath $dir.FullName -Force -ErrorAction Stop)
    if(@($files | Where-Object {$_.Extension -ieq '.rules' -or ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)}).Count){throw 'policy'}
   }
  }
 } catch {throw 'jak_rules_neverificabile'}
}

function AssertJakMcp([string]$exe,[string]$cli,[string[]]$overrides,[string]$repo,[int]$timeout,$childEnv) {
 # Config/read inspects merged notify/hooks and configured MCP. Features list
 # applies managed requirements, including Apps synthesized only at runtime.
 $clock=[Diagnostics.Stopwatch]::StartNew()
 $probe=Join-Path $PSScriptRoot 'jak_config_probe.py'
 AssertCdxSingleFile $probe;AssertCdxAdminAcl $probe
 $r=Ruleaza 'C:\Program Files\Python313\python.exe' (@('-I','-B',$probe,$exe,$cli,$repo)+$overrides) '' $repo $timeout $childEnv $true $true
 if($r.timeout -or $r.exit -ne 0 -or ([string]$r.out).Trim() -cne 'JAK_CONFIG_OK'){throw 'jak_config_efectiv_refuzat'}
 $remaining=[int][Math]::Floor($timeout-$clock.Elapsed.TotalSeconds)
 if($remaining -lt 1){throw 'jak_preflight_timeout'}
 $r=Ruleaza $exe (@($cli)+$overrides+@('features','list')) '' $repo $remaining $childEnv $true $true
 if($r.timeout -or $r.exit -ne 0){throw 'jak_features_neverificabile'}
 foreach($name in @('apps','plugins','remote_plugin','hooks','skill_mcp_dependency_install')){
  $rows=@(([string]$r.out -split "`n") | Where-Object {$_ -cmatch ('^'+$name+'[ \t]+')})
  if($rows.Count -ne 1 -or $rows[0] -cnotmatch ('^'+$name+'[ \t]+[a-z_ ]+[ \t]+false[ \t\r]*$')){throw 'jak_features_active_sau_necunoscute'}
 }
 $remaining=[int][Math]::Floor($timeout-$clock.Elapsed.TotalSeconds)
 if($remaining -lt 1){throw 'jak_preflight_timeout'}
 $r=Ruleaza $exe (@($cli)+$overrides+@('mcp','list','--json')) '' $repo $remaining $childEnv $true $true
 if($r.timeout -or $r.exit -ne 0 -or ([string]$r.out).Trim() -cnotmatch '^\[[ \t\r\n]*\]$'){throw 'jak_mcp_refuzat'}
}

function AssertJakHome([string]$jakHomePath) {
 if(GetJakPolicyItem (Join-Path $jakHomePath '.env')){throw 'jak_env_refuzat'}
 AssertJakRules $jakHomePath
}

function InvokeJak([string]$exe,[string[]]$argv,[string]$prompt,[string]$repo,[int]$timeout) {
 $clock=[Diagnostics.Stopwatch]::StartNew()
 $jakHomePath=Join-Path $PAW_ROOT 'state\jak-home'
 $config=Join-Path $jakHomePath 'config.toml'
 [void](AssertCdxPath $jakHomePath);AssertCdxSingleFile $config;AssertCdxAdminAcl $config
 if([IO.File]::ReadAllText($config) -cne (GetJakConfig)){throw 'jak_config_modificat; refaceti profilul prin Install'}
 # Lista inchisa: fara tokenuri, CODEX_HOME ori configurari mostenite de la cont.
 $childEnv=@{}
 foreach($name in @('SystemRoot','WINDIR','PATH','PATHEXT','COMSPEC','USERPROFILE','USERNAME','USERDOMAIN','LOCALAPPDATA','APPDATA','TEMP','TMP','HOMEDRIVE','HOMEPATH','ProgramFiles','ProgramFiles(x86)','ProgramData')){
  $value=[Environment]::GetEnvironmentVariable($name)
  if($null -ne $value){$childEnv[$name]=$value}
 }
 $childEnv.CODEX_HOME=$jakHomePath
 if($argv[-1] -cne '-'){throw 'jak_stdin_obligatoriu'}
 $overrides=GetJakOverrides $repo
 $argv=@($argv | Select-Object -SkipLast 1)+@('--ephemeral','--ignore-rules')+$overrides+@('-')
 AssertJakHome $jakHomePath
 AssertJakMcp $exe $argv[0] $overrides $repo ([Math]::Min(60,$timeout)) $childEnv
 AssertJakHome $jakHomePath
 $remaining=[int][Math]::Floor($timeout-$clock.Elapsed.TotalSeconds)
 if($remaining -lt 1){throw 'jak_timeout'}
 try {return (Ruleaza $exe $argv $prompt $repo $remaining $childEnv $true $true)}
 catch {throw 'jak_proces_esuat'}
}
