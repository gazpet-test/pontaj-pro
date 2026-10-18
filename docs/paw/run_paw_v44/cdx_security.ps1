# Shared, side-effect-free guards. Windows PowerShell 5.1. No installation on import.
if (-not ('PawCdx.Files' -as [type])) {
 Add-Type -TypeDefinition @"
using System; using System.IO; using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace PawCdx { public static class Files {
 [StructLayout(LayoutKind.Sequential)] struct Info { public uint a,b,c,d,e,f,g,h,i,j,links,k,l; }
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
 public static string Identity(SafeFileHandle h) { Info i; if(!GetFileInformationByHandle(h,out i)) throw new System.ComponentModel.Win32Exception(); return i.h.ToString("X8")+":"+i.k.ToString("X8")+":"+i.l.ToString("X8"); }
 public static uint Links(SafeFileHandle h) { Info i; if(!GetFileInformationByHandle(h,out i)) throw new System.ComponentModel.Win32Exception(); return i.links; }
}}
"@
}
function HashCdx([string]$path) {
 $s=[IO.File]::OpenRead($path);$h=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','') } finally {$s.Dispose();$h.Dispose()}
}
function WriteCdxJson($path,$value) { [IO.File]::WriteAllText($path,($value|ConvertTo-Json -Depth 30),(New-Object Text.UTF8Encoding($false))) }
function AssertCdxPath([string]$path) {
 if($path -notmatch '^[A-Za-z]:[\\/]' -or $path.Substring(2).Contains(':') -or $path -match '["\r\n]'){throw 'cdx_path_invalid'}
 $full=[IO.Path]::GetFullPath($path)
 foreach($part in $path.Substring(3).Split([char[]]'\/')) {
  if($part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)' -or $part -match '[. ]$'){throw 'cdx_reserved_path'}
 }
 for($x=$full;$x;$x=Split-Path $x -Parent) {
  if(Test-Path -LiteralPath $x) {if((Get-Item -LiteralPath $x -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'cdx_reparse_refused'}}
 }
 return $full
}
function AssertCdxSingleFile([string]$path) {
 [void](AssertCdxPath $path)
 $f=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 try {if([PawCdx.Files]::Links($f.SafeFileHandle) -ne 1){throw 'cdx_hardlink_refused'}}finally{$f.Dispose()}
}
# Deliberately do not use -Recurse: check a directory BEFORE traversing it.
function GetCdxTree([string]$root,[bool]$skipRootGit=$false) {
 [void](AssertCdxPath $root)
 $todo=New-Object 'Collections.Generic.Stack[string]';$todo.Push($root)
 while($todo.Count) {
  $dir=$todo.Pop()
  foreach($e in Get-ChildItem -LiteralPath $dir -Force) {
   [void](AssertCdxPath $e.FullName)
   if($e.PSIsContainer){if(-not($skipRootGit -and $e.FullName -ieq (Join-Path $root '.git'))){$todo.Push($e.FullName)}}else{AssertCdxSingleFile $e.FullName}
   $e
  }
 }
}
function AssertCdxAdminAcl([string]$path) {
 [void](AssertCdxPath $path)
 $acl=Get-Acl -LiteralPath $path
 $admins=@('S-1-5-18','S-1-5-32-544')
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $admins){throw 'cdx_acl_owner_not_admin'}
 $write=[int][Security.AccessControl.FileSystemRights]::Write -bor [int][Security.AccessControl.FileSystemRights]::Delete -bor [int][Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [int][Security.AccessControl.FileSystemRights]::ChangePermissions -bor [int][Security.AccessControl.FileSystemRights]::TakeOwnership
 foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if($r.AccessControlType -eq 'Allow' -and ([int]$r.FileSystemRights -band $write) -and $r.IdentityReference.Value -notin $admins){throw 'cdx_acl_non_admin_writer'}
 }
}
function SetCdxAdminAcl([string]$path,[string]$readerSid) {
 $item=Get-Item -LiteralPath $path -Force
 if($item.PSIsContainer){$a=New-Object Security.AccessControl.DirectorySecurity;$inherit='ContainerInherit,ObjectInherit'}
 else{$a=New-Object Security.AccessControl.FileSecurity;$inherit='None'}
 $a.SetAccessRuleProtection($true,$false)
 $a.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
 foreach($id in @('S-1-5-18','S-1-5-32-544',$readerSid)|Select-Object -Unique){
  $rights=if($id -eq $readerSid){'ReadAndExecute'}else{'FullControl'}
  $r=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($id)),$rights,$inherit,'None','Allow');$a.AddAccessRule($r)
 }
 Set-Acl -LiteralPath $path -AclObject $a
 AssertCdxAdminAcl $path
}
function GetCdxTreeHashes([string]$root) {
 $result=[ordered]@{}
 foreach($e in @(GetCdxTree $root)|Sort-Object FullName){$rel=$e.FullName.Substring($root.TrimEnd('\').Length+1).Replace('\','/');$result[$rel]=if($e.PSIsContainer){'DIRECTORY'}else{HashCdx $e.FullName}}
 return $result
}
function AssertCdxHashes($actual,$expected) {
 $a=$actual|ConvertTo-Json -Depth 30 -Compress;$e=$expected|ConvertTo-Json -Depth 30 -Compress
 if($a -cne $e){throw 'cdx_hash_set_mismatch'}
}
function AssertCdxCertificateFresh($certificate) {
 if(-not $certificate.certified_utc -or -not $certificate.expires_utc){throw 'cdx_certificate_expiry_missing'}
 $issued=[DateTimeOffset]::Parse($certificate.certified_utc).ToUniversalTime()
 $expires=[DateTimeOffset]::Parse($certificate.expires_utc).ToUniversalTime()
 $now=[DateTimeOffset]::UtcNow
 if($issued -gt $now.AddMinutes(1) -or $expires -le $now -or $expires -le $issued -or ($expires-$issued).TotalHours -gt 24){throw 'cdx_certificate_expired_or_invalid; recertification required'}
}
function AssertCdxEvidenceFresh($evidence) {
 # Seal cannot renew old evidence indefinitely: expiration is anchored to Run start.
 if(-not $evidence.run_started_utc -or -not $evidence.run_completed_utc){throw 'cdx_evidence_time_missing'}
 $start=[DateTimeOffset]::Parse($evidence.run_started_utc).ToUniversalTime()
 $end=[DateTimeOffset]::Parse($evidence.run_completed_utc).ToUniversalTime()
 $now=[DateTimeOffset]::UtcNow
 if($end -lt $start -or $end -gt $now.AddMinutes(1) -or $start -gt $now.AddMinutes(1) -or $start.AddHours(24) -le $now){throw 'cdx_evidence_expired_or_invalid; repeat Run'}
 return $start
}
function ClearCdxCertificationLinks([string]$root,$probes) {
 # ONLY after Job idle, ONLY protected permit's three root-level probe names.
 # This exception is never used for a normal cdx run. No recursive removal.
 $root=(AssertCdxPath $root).TrimEnd('\')
 $known=@{'link-hardlink'='HardLink';'link-junction'='Junction';'link-symlink'='SymbolicLink'}
 if(@($probes).Count -ne 3 -or @($probes.id|Select-Object -Unique).Count -ne 3){throw 'cdx_link_probe_manifest_invalid'}
 foreach($p in $probes){
  if(-not $known.ContainsKey([string]$p.id) -or $p.kind -cne $known[[string]$p.id]){throw 'cdx_link_probe_manifest_invalid'}
  $target=AssertCdxPath $p.target
  if($target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'cdx_link_probe_target_not_external'}
  $path=[IO.Path]::GetFullPath((Join-Path $root $p.id))
  if((Split-Path $path) -ine $root){throw 'cdx_link_probe_path_escape'}
  $item=Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if(-not $item){continue} # creation itself may have been denied
  if($p.kind -eq 'HardLink') {
   if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'cdx_probe_unexpected_link_type'}
   $a=[IO.File]::OpenRead($path);$b=$null
   try{
    $b=[IO.File]::OpenRead($target)
    if([PawCdx.Files]::Links($a.SafeFileHandle) -lt 2 -or [PawCdx.Files]::Identity($a.SafeFileHandle) -cne [PawCdx.Files]::Identity($b.SafeFileHandle)){throw 'cdx_probe_hardlink_target_mismatch'}
   } finally {if($b){$b.Dispose()};$a.Dispose()}
   [IO.File]::Delete($path)
  } else {
   if(-not($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.LinkType -cne $p.kind){throw 'cdx_probe_unexpected_link_type'}
   $actual=@($item.Target)
   if($actual.Count -ne 1){throw 'cdx_probe_link_target_ambiguous'}
   $actualPath=[string]$actual[0]
   if($actualPath.StartsWith('\\?\')){$actualPath=$actualPath.Substring(4)}
   if(-not [IO.Path]::IsPathRooted($actualPath) -or [IO.Path]::GetFullPath($actualPath).TrimEnd('\') -ine $target.TrimEnd('\')){throw 'cdx_probe_link_target_mismatch'}
   # Directory.Delete(path) unlinks junction/directory symlink; never recurse into target.
   if($item.PSIsContainer){[IO.Directory]::Delete($path)}else{[IO.File]::Delete($path)}
  }
  if(Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue){throw 'cdx_probe_link_not_removed'}
  [pscustomobject]@{id=$p.id;path=$path;target=$target;kind=$p.kind;detected=$true;removed=$true}
 }
}
function GetCdxBinding {
 # The lock is outside bin so a version update cannot replace a held lock inode.
 foreach($p in @($PAW_ROOT,(Join-Path $PAW_ROOT 'bin'),(Join-Path $PAW_ROOT 'codex'))){AssertCdxAdminAcl $p}
 $cfgPath=Join-Path $PSScriptRoot 'cdx_install.json';AssertCdxAdminAcl $cfgPath;AssertCdxSingleFile $cfgPath
 $cfg=Get-Content -LiteralPath $cfgPath -Raw|ConvertFrom-Json
 if($cfg.schema -ne 2 -or $cfg.isolation -ne 'native-elevated-candidate'){throw 'cdx_install_schema'}
 $runtime=[IO.Path]::GetFullPath($cfg.runtime_root)
 if(-not $runtime.StartsWith((Join-Path $PAW_ROOT 'codex')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'cdx_runtime_outside'}
 AssertCdxAdminAcl $runtime
 foreach($e in GetCdxTree $runtime){AssertCdxAdminAcl $e.FullName}
 $manifest=Join-Path $PSScriptRoot 'cdx_runtime_manifest.json';AssertCdxAdminAcl $manifest
 AssertCdxHashes (GetCdxTreeHashes $runtime) (Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json)
 $bin=[ordered]@{}
 foreach($name in @('run_paw.cmd','run_paw.ps1','cdx.ps1','cdx_security.ps1','certifica_cdx.ps1','cdx_install.json','cdx_runtime_manifest.json')) {
  $p=Join-Path $PSScriptRoot $name;AssertCdxAdminAcl $p;AssertCdxSingleFile $p;$bin[$name]=HashCdx $p
 }
 $git='C:\Program Files\Git\cmd\git.exe'
 AssertCdxAdminAcl (Split-Path (Split-Path $git));AssertCdxAdminAcl (Split-Path $git);AssertCdxAdminAcl $git;AssertCdxSingleFile $git
 $bin['git.exe']=HashCdx $git
 if($cfg.git_credential_helper) {
  $helper='C:\Program Files\Git\mingw64\bin\git-credential-manager.exe'
  if($cfg.git_credential_helper -cne $helper){throw 'cdx_unapproved_git_helper'}
  AssertCdxAdminAcl (Split-Path (Split-Path $helper));AssertCdxAdminAcl (Split-Path $helper);AssertCdxAdminAcl $helper;AssertCdxSingleFile $helper
  $bin['git-credential-manager.exe']=HashCdx $helper
 }
 $script:CdxInstall=$cfg
 $auth=Join-Path $cfg.codex_home 'auth.json';AssertCdxSingleFile $auth
 $authAcl=(Get-Acl -LiteralPath $auth).Sddl
 $win=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
 if(-not $win.CurrentBuildNumber -or $null -eq $win.UBR){throw 'cdx_windows_revision_unavailable'}
 return [ordered]@{schema=3;windows_build=[string]$win.CurrentBuildNumber;windows_ubr=[int]$win.UBR;codex_version=$cfg.version;auth_acl_sddl=$authAcl;bin=$bin;runtime_manifest_sha256=HashCdx $manifest;node_sha256=HashCdx (Join-Path $runtime 'node.exe');os=[Environment]::OSVersion.Version.ToString();identity=$cfg.reader_sid;isolation=$cfg.isolation}
}
# Windows CRT quoting for controlled internal arguments (not a shell command).
function ArgCdx([string]$value) {
 if($value -match '[\r\n]'){throw 'cdx_argument_newline'}
 if($value -ne '' -and $value -notmatch '[\s"]'){return $value}
 $b=New-Object Text.StringBuilder;[void]$b.Append('"');$slashes=0
 foreach($ch in $value.ToCharArray()) {
  if($ch -eq '\'){$slashes++;continue}
  if($ch -eq '"'){[void]$b.Append(('\'*(2*$slashes+1)));[void]$b.Append('"')}
  else{[void]$b.Append(('\'*$slashes));[void]$b.Append($ch)}
  $slashes=0
 }
 [void]$b.Append(('\'*(2*$slashes)));[void]$b.Append('"');return $b.ToString()
}
function GetCdxEnvironment([string]$target,[string]$runtime,[string]$codexHome) {
 # No inherited secrets, proxies, NODE_OPTIONS, PYTHONPATH, Git config injection or profile.
 return @{SystemRoot=$env:SystemRoot;WINDIR=$env:SystemRoot;ComSpec=(Join-Path $env:SystemRoot 'System32\cmd.exe');PATH=($runtime+';'+$env:SystemRoot+'\System32;'+$env:SystemRoot+'\System32\WindowsPowerShell\v1.0');TEMP=(Join-Path $target '.tmp');TMP=(Join-Path $target '.tmp');CODEX_HOME=$codexHome;GIT_CONFIG_GLOBAL='NUL';GIT_CONFIG_NOSYSTEM='1';GIT_TERMINAL_PROMPT='0';GCM_INTERACTIVE='Never';GIT_OPTIONAL_LOCKS='0'}
}
function AssertCdxGitConfig([string]$path) {
 if(-not(Test-Path -LiteralPath $path)){return}
 AssertCdxSingleFile $path
 $section='';$sub=''
 foreach($line in [IO.File]::ReadAllLines($path)) {
  $s=$line.Trim();if(-not $s -or $s.StartsWith('#') -or $s.StartsWith(';')){continue}
  if($s -match '^\[([A-Za-z]+)(?:\s+"([^"\\]+)")?\]$'){$section=$matches[1].ToLower();$sub=$matches[2];continue}
  if($s -notmatch '^([A-Za-z][A-Za-z0-9-]*)\s*=\s*([^\r\n]*)$'){throw 'cdx_git_config_syntax_refused'}
  $key=$matches[1].ToLower();$value=$matches[2]
  if($value.Contains('\') -or $value -match '[";#]'){throw 'cdx_git_config_value_refused'}
  $allowed=switch($section){
   'core' {@('repositoryformatversion','filemode','bare','logallrefupdates','symlinks','ignorecase','autocrlf','safecrlf','protectntfs','longpaths')}
   'remote' {if($sub -ne 'origin'){throw 'cdx_git_remote_refused'};@('url','fetch')}
   'branch' {@('remote','merge')}
   'user' {@('name','email')}
   'extensions' {@('worktreeconfig')}
   default {throw ('cdx_git_config_section_refused_'+$section)}
  }
  if($key -notin $allowed){throw ('cdx_git_config_key_refused_'+$key)}
  if($section -eq 'remote' -and $key -eq 'url' -and $value -cne 'https://github.com/gazpet-test/pontaj-pro.git'){throw 'cdx_git_origin_not_pinned'}
 }
}
function AssertCdxOutput([string]$root) {
 [void](AssertCdxPath $root)
 foreach($e in GetCdxTree $root $true) {
  if($e.Name -ieq '.git' -and $e.FullName -ine (Join-Path $root '.git')){throw 'cdx_nested_git_refused'}
  if($e.Name -ieq '.gitattributes' -or $e.Name -ieq '.gitmodules') {
   if($e.PSIsContainer){throw 'cdx_attributes_directory_refused'}
   # Reject even unset/custom diff attributes: conservative, review needed, no equivalence guessing.
   if([IO.File]::ReadAllText($e.FullName) -match '(?i)(filter|diff|merge|textconv)'){throw 'cdx_executable_attributes_refused'}
   if($e.Name -ieq '.gitmodules'){throw 'cdx_submodules_refused'}
  }
 }
}
function GetCdxGitSnapshot([string]$common,[string]$meta) {
 $snap=[ordered]@{}
 foreach($name in @('config','config.worktree','info\attributes','info\exclude')) {
  $p=Join-Path $common $name
  if(Test-Path -LiteralPath $p){AssertCdxSingleFile $p;$snap[$name]=HashCdx $p}else{$snap[$name]='ABSENT'}
 }
 if($meta){$snap['worktree']=GetCdxTreeHashes $meta}
 return $snap
}
function OpenCdxInstallBarrier([bool]$exclusive=$false) {
 $p=Join-Path $PAW_ROOT 'install.lock';AssertCdxAdminAcl $PAW_ROOT;AssertCdxAdminAcl $p;AssertCdxSingleFile $p
 $share=if($exclusive){[IO.FileShare]::None}else{[IO.FileShare]::Read}
 $h=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,$share)
 if([PawCdx.Files]::Links($h.SafeFileHandle) -ne 1){$h.Dispose();throw 'cdx_install_lock_hardlink'}
 return $h
}
