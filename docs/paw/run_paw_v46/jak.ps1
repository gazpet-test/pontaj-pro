# Profil separat pentru jak; cheia nu se copiaza in mediul lansatorului.
function GetJakConfig {
 return @'
approval_policy = "never"
sandbox_mode = "read-only"
forced_login_method = "chatgpt"
cli_auth_credentials_store = "file"
web_search = "disabled"

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

function InvokeJak([string]$exe,[string[]]$argv,[string]$prompt,[string]$repo,[int]$timeout) {
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
 if($key){$childEnv.FIRECRAWL_API_KEY=$key}
 else {Add-Content -LiteralPath $script:OutFull -Value 'FIRECRAWL: indisponibil' -Encoding UTF8}
 # CLI are precedenta peste config de proiect/cont. Nu exista selectie automata OAuth.
 # Pastram markerul stdin ultimul, inclusiv dupa override-urile interne.
 if($argv[-1] -cne '-'){throw 'jak_stdin_obligatoriu'}
 $argv=@($argv | Select-Object -SkipLast 1)
 foreach($setting in @('features.apps=false','features.plugins=false','features.remote_plugin=false','features.skill_mcp_dependency_install=false','features.hooks=false')){
  $argv+=@('-c',$setting)
 }
 $repoToml=$repo.Replace('\','\\').Replace('"','\"')
 $argv+=@('-c',('projects."'+$repoToml+'".trust_level="untrusted"'))
 $argv+=@('-c',('mcp_servers.firecrawl.enabled='+([bool]$key).ToString().ToLowerInvariant()))
 $argv+=@('-')
 try {
  $result=Ruleaza $exe $argv $prompt $repo $timeout $childEnv $true $true
  # Aparare la un copil care repeta accidental credentialul in stdout/stderr.
  if($key){foreach($stream in @('out','err')){if($result[$stream]){$result[$stream]=$result[$stream].Replace($key,'[REDACTED]')}}}
  return $result
 } catch {throw 'jak_proces_esuat; detaliile potential sensibile au fost omise'}
 finally {$childEnv.Remove('FIRECRAWL_API_KEY');$key=$null}
}
