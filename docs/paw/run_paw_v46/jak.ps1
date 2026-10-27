# Profil separat pentru jak; cheia nu se copiaza in mediul lansatorului.
function GetJakConfig {
 return @'
approval_policy = "never"
sandbox_mode = "read-only"
forced_login_method = "chatgpt"
cli_auth_credentials_store = "file"
web_search = "disabled"

[windows]
sandbox = "unelevated"

[features]
apps = false
plugins = false
remote_plugin = false
skill_mcp_dependency_install = false
hooks = false

[shell_environment_policy]
exclude = ["FIRECRAWL_API_KEY"]
ignore_default_excludes = false

[projects.'C:\Users\Gazpet-Ai\gazpet-erp']
trust_level = "untrusted"

[mcp_servers.firecrawl]
url = "https://mcp.firecrawl.dev/v2/mcp"
bearer_token_env_var = "FIRECRAWL_API_KEY"
enabled = false
required = false
enabled_tools = ["firecrawl_search", "firecrawl_scrape", "firecrawl_map"]
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
 $secrets=Join-Path $state 'secrets';[void](AssertCdxPath $secrets)
 if(-not(Test-Path -LiteralPath $secrets)){[void][IO.Directory]::CreateDirectory($secrets)}
 SetCdxAdminAcl $secrets $readerSid
 $keyPath=Join-Path $secrets 'firecrawl_api_key';[void](AssertCdxPath $keyPath)
 if(Test-Path -LiteralPath $keyPath){AssertCdxSingleFile $keyPath;SetCdxAdminAcl $keyPath $readerSid}
 # Nu solicitam niciodata cheia in Prepare. Nu afisam obiectul SecureString.
 if((Read-Host 'Configurati acum cheia Firecrawl? Tastati DA sau Enter pentru a pastra starea') -ceq 'DA'){
  $secure=Read-Host 'Cheie API Firecrawl' -AsSecureString
  $ptr=[IntPtr]::Zero;$plain=$null
  try {
   $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
   if($plain -cnotmatch '^fc-[A-Za-z0-9_-]+$'){throw 'Cheie Firecrawl invalida; nu a fost salvata'}
   # Directorul este deja protejat inainte de prima scriere.
   [IO.File]::WriteAllText($keyPath,$plain,(New-Object Text.UTF8Encoding($false)))
   SetCdxAdminAcl $keyPath $readerSid
  } finally {
   if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
   $plain=$null;if($secure){$secure.Dispose()}
  }
 }
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

function GetJakOverrides([string]$repo,[bool]$withKey) {
 $overrides=@('-c','windows.sandbox="unelevated"')
 foreach($setting in @('features.apps=false','features.plugins=false','features.remote_plugin=false','features.skill_mcp_dependency_install=false','features.hooks=false')){
  $overrides+=@('-c',$setting)
 }
 $repoToml=$repo.Replace('\','\\').Replace('"','\"')
 $overrides+=@('-c',('projects."'+$repoToml+'".trust_level="untrusted"'))
 $overrides+=@('-c',('mcp_servers.firecrawl.enabled='+$withKey.ToString().ToLowerInvariant()))
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

function AssertJakFirecrawl($server,[bool]$withKey,[bool]$checkTools) {
 if($server.name -cne 'firecrawl' -or $server.enabled -isnot [bool] -or $server.enabled -ne $withKey -or
    $server.transport.type -cne 'streamable_http' -or $server.transport.url -cne 'https://mcp.firecrawl.dev/v2/mcp' -or
    $server.transport.bearer_token_env_var -cne 'FIRECRAWL_API_KEY' -or
    $server.transport.http_headers_helper -or ($null -ne $server.transport.http_headers -and @($server.transport.http_headers.PSObject.Properties).Count -gt 0) -or
    ($null -ne $server.transport.env_http_headers -and @($server.transport.env_http_headers.PSObject.Properties).Count -gt 0)){throw 'jak_mcp_neasteptat firecrawl'}
 if($checkTools){
  $tools=@($server.enabled_tools)
  if($tools.Count -ne 3 -or @($tools | Where-Object {$_ -isnot [string] -or $_ -cnotin @('firecrawl_search','firecrawl_scrape','firecrawl_map')}).Count -or
     @($tools | Select-Object -Unique).Count -ne 3 -or ($null -ne $server.disabled_tools -and @($server.disabled_tools).Count -gt 0)){throw 'jak_mcp_neasteptat firecrawl'}
 }
}

function AssertJakMcp([string]$exe,[string]$cli,[string[]]$overrides,[string]$repo,[int]$timeout,$childEnv,[bool]$withKey,[string]$redactKey) {
 if($childEnv.ContainsKey('FIRECRAWL_API_KEY')){throw 'jak_preflight_cu_secret'}
 # list nu include enabled_tools in CLI 0.162.0; get este obligatoriu, separat.
 # Fara brief pe stdin si fara publicarea stdout/stderr de diagnostic.
 $clock=[Diagnostics.Stopwatch]::StartNew()
 try {
  $r=Ruleaza $exe (@($cli)+$overrides+@('mcp','list','--json')) '' $repo $timeout $childEnv $true $true
  if($r.timeout -or $r.exit -ne 0){throw 'query'}
  if(([string]$r.out).Trim() -notmatch '^\['){throw 'shape'}
  $parsed=ConvertFrom-Json -InputObject $r.out -ErrorAction Stop
  $servers=@();foreach($entry in $parsed){$servers+=,$entry}
 } catch {throw 'jak_mcp_interogare_esuata'}
 foreach($server in $servers){
  if($server.name -cne 'firecrawl'){
   # Numele extern este date: nu permitem injectare de linii/secrete in log.
   $name=if($server.name -is [string] -and $server.name -cmatch '^[A-Za-z0-9_.-]{1,80}$'){$server.name}else{'nume_invalid'}
   if($redactKey){$name=$name.Replace($redactKey,'[REDACTED]')}
   throw ('jak_mcp_neasteptat '+$name)
  }
  AssertJakFirecrawl $server $withKey $false
 }
 if($servers.Count -ne 1){throw 'jak_mcp_neasteptat firecrawl'}
 try {
  $remaining=[int][Math]::Floor($timeout-$clock.Elapsed.TotalSeconds)
  if($remaining -lt 1){throw 'timeout'}
  $r=Ruleaza $exe (@($cli)+$overrides+@('mcp','get','firecrawl','--json')) '' $repo $remaining $childEnv $true $true
  if($r.timeout -or $r.exit -ne 0){throw 'query'}
  if(([string]$r.out).Trim() -notmatch '^\{'){throw 'shape'}
  $server=ConvertFrom-Json -InputObject $r.out -ErrorAction Stop
 } catch {throw 'jak_mcp_interogare_esuata'}
 AssertJakFirecrawl $server $withKey $true
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
 $key=$null
 $keyPath=Join-Path $PAW_ROOT 'state\secrets\firecrawl_api_key'
 [void](AssertCdxPath $keyPath)
 if(Test-Path -LiteralPath $keyPath){
  AssertCdxSingleFile $keyPath;AssertCdxAdminAcl $keyPath
  try {$key=[IO.File]::ReadAllText($keyPath).Trim()}catch{throw 'jak_firecrawl_cheie_necitibila'}
  if($key -cnotmatch '^fc-[A-Za-z0-9_-]+$'){throw 'jak_firecrawl_cheie_invalida'}
 }
 if(-not $key){Add-Content -LiteralPath $script:OutFull -Value 'FIRECRAWL: indisponibil' -Encoding UTF8}
 # CLI are precedenta peste config de proiect/cont. Nu exista selectie automata OAuth.
 # Pastram markerul stdin ultimul, inclusiv dupa override-urile interne.
 if($argv[-1] -cne '-'){throw 'jak_stdin_obligatoriu'}
 $overrides=GetJakOverrides $repo ([bool]$key)
 $argv=@($argv | Select-Object -SkipLast 1)+@('--ephemeral','--ignore-rules')+$overrides+@('-')
 try {
  AssertJakRules $jakHomePath
  # MCP auth discovery may contact unvalidated servers: NO secret in env.
  AssertJakMcp $exe $argv[0] $overrides $repo ([Math]::Min(60,$timeout)) $childEnv ([bool]$key) $key
  AssertJakRules $jakHomePath
  # Only the validated exec child receives the dedicated Firecrawl key.
  if($key){$childEnv.FIRECRAWL_API_KEY=$key}
  $remaining=[int][Math]::Floor($timeout-$clock.Elapsed.TotalSeconds)
  if($remaining -lt 1){throw 'jak_timeout'}
  try {$result=Ruleaza $exe $argv $prompt $repo $remaining $childEnv $true $true}
  catch {throw 'jak_proces_esuat; detaliile potential sensibile au fost omise'}
  # Aparare la un copil care repeta accidental credentialul in stdout/stderr.
  if($key){foreach($stream in @('out','err')){if($result[$stream]){$result[$stream]=$result[$stream].Replace($key,'[REDACTED]')}}}
  return $result
 } finally {$childEnv.Remove('FIRECRAWL_API_KEY');$key=$null}
}
