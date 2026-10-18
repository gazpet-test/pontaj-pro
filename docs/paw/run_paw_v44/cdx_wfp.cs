// WFP ALE connect block for CodexSandboxOffline, including loopback and own IP.
// Persistent hard block; service-mediated DNS runs under another identity and is NOT covered.
// Based on Claude wfp_cdx.cs (18.10.2026). Production persistent only; no change on import/Inspect. Rollback: PawCdxWfp.Remove().
using System;
using System.Runtime.InteropServices;

public static class PawCdxWfp {
  public static int FilterSize() { return Marshal.SizeOf(typeof(FWPM_FILTER0)); }
  public static int SubLayerSize() { return Marshal.SizeOf(typeof(FWPM_SUBLAYER0)); }
  public static readonly Guid SubLayer = new Guid("5f1d7c2e-6a3b-4c1d-9e2f-0a1b2c3d4e51");
  public static readonly Guid FilterV4 = new Guid("5f1d7c2e-6a3b-4c1d-9e2f-0a1b2c3d4e52");
  public static readonly Guid FilterV6 = new Guid("5f1d7c2e-6a3b-4c1d-9e2f-0a1b2c3d4e53");
  static readonly Guid LayerConnectV4 = new Guid("c38d57d1-05a7-4c33-904f-7fbceee60e82");
  static readonly Guid LayerConnectV6 = new Guid("4a72393b-319f-44bc-84c3-ba54dcb3b6b4");
  static readonly Guid CondAleUserId = new Guid("af043a0a-b34d-4f86-979c-c90371af6e66");

  [StructLayout(LayoutKind.Sequential)] struct FWP_BYTE_BLOB { public uint size; public IntPtr data; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct FWPM_DISPLAY_DATA0 { [MarshalAs(UnmanagedType.LPWStr)] public string name; [MarshalAs(UnmanagedType.LPWStr)] public string description; }
  [StructLayout(LayoutKind.Sequential)] struct FWPM_SUBLAYER0 { public Guid subLayerKey; public FWPM_DISPLAY_DATA0 displayData; public uint flags; public IntPtr providerKey; public FWP_BYTE_BLOB providerData; public ushort weight; }
  [StructLayout(LayoutKind.Sequential)] struct FWP_VALUE0 { public uint type; public IntPtr value; }
  [StructLayout(LayoutKind.Sequential)] struct FWPM_FILTER_CONDITION0 { public Guid fieldKey; public uint matchType; public FWP_VALUE0 conditionValue; }
  [StructLayout(LayoutKind.Sequential)] struct FWPM_ACTION0 { public uint type; public Guid filterType; }
  [StructLayout(LayoutKind.Sequential)] struct FWPM_FILTER0 {
    public Guid filterKey; public FWPM_DISPLAY_DATA0 displayData; public uint flags; public IntPtr providerKey; public FWP_BYTE_BLOB providerData;
    public Guid layerKey; public Guid subLayerKey; public FWP_VALUE0 weight; public uint numFilterConditions; public IntPtr filterCondition;
    public FWPM_ACTION0 action; public ulong context0; public ulong context1; public IntPtr reserved; public ulong filterId; public FWP_VALUE0 effectiveWeight;
  }

  [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineOpen0(string serverName, uint authnService, IntPtr authIdentity, IntPtr session, out IntPtr engineHandle);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineClose0(IntPtr engineHandle);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionBegin0(IntPtr engineHandle, uint flags);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionCommit0(IntPtr engineHandle);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmTransactionAbort0(IntPtr engineHandle);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerAdd0(IntPtr engineHandle, ref FWPM_SUBLAYER0 subLayer, IntPtr sd);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerDeleteByKey0(IntPtr engineHandle, ref Guid key);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterAdd0(IntPtr engineHandle, ref FWPM_FILTER0 filter, IntPtr sd, out ulong id);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterDeleteByKey0(IntPtr engineHandle, ref Guid key);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint rev, out IntPtr sd, out uint size);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);

  const uint RPC_C_AUTHN_WINNT = 10, FWP_SECURITY_DESCRIPTOR_TYPE = 14, FWP_MATCH_EQUAL = 0, FWP_ACTION_BLOCK = 0x1001;
  const uint FLAG_PERSISTENT = 0x1, FLAG_CLEAR_ACTION_RIGHT = 0x8, FWP_E_NOT_FOUND_FILTER = 0x80320003, FWP_E_NOT_FOUND_SUBLAYER = 0x80320007;

  static IntPtr Open() { IntPtr h; uint r = FwpmEngineOpen0(null, RPC_C_AUTHN_WINNT, IntPtr.Zero, IntPtr.Zero, out h); if (r != 0) throw new Exception("FwpmEngineOpen0 0x" + r.ToString("X8")); return h; }

  public static string Install(string userSid, string readerSid) {
    uint pf = FLAG_PERSISTENT; // production is always persistent
    ValidateSid(userSid);
    ValidateSid(readerSid);
    IntPtr engine = Open(); IntPtr sd = IntPtr.Zero, objectSd = IntPtr.Zero, blob = IntPtr.Zero, cond = IntPtr.Zero; string log = ""; bool tx = false;
    try {
      // Tranzactie: totul sau nimic. Obiecte existente cu aceleasi chei = eroare (apelantul ruleaza Remove() inainte).
      uint rt = FwpmTransactionBegin0(engine, 0); if (rt != 0) throw new Exception("FwpmTransactionBegin0 0x" + rt.ToString("X8")); tx = true;
      uint objectSize;
      if (!ConvertStringSecurityDescriptorToSecurityDescriptorW("O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GR;;;" + readerSid + ")", 1, out objectSd, out objectSize)) throw new Exception("Object SDDL " + Marshal.GetLastWin32Error());
      var sl = new FWPM_SUBLAYER0 { subLayerKey = SubLayer, flags = pf, weight = 0x7FFF };
      sl.displayData.name = "Paw cdx sandbox block"; sl.displayData.description = "Gazpet: Codex sandbox fara retea (inclusiv loopback)";
      uint r = FwpmSubLayerAdd0(engine, ref sl, objectSd);
      if (r != 0) throw new Exception("FwpmSubLayerAdd0 0x" + r.ToString("X8"));
      log += "sublayer creat; ";
      uint sdSize; if (!ConvertStringSecurityDescriptorToSecurityDescriptorW("O:LSD:(A;;CC;;;" + userSid + ")", 1, out sd, out sdSize)) throw new Exception("SDDL " + Marshal.GetLastWin32Error());
      var b = new FWP_BYTE_BLOB { size = sdSize, data = sd }; blob = Marshal.AllocHGlobal(Marshal.SizeOf(b)); Marshal.StructureToPtr(b, blob, false);
      var c = new FWPM_FILTER_CONDITION0 { fieldKey = CondAleUserId, matchType = FWP_MATCH_EQUAL };
      c.conditionValue.type = FWP_SECURITY_DESCRIPTOR_TYPE; c.conditionValue.value = blob;
      cond = Marshal.AllocHGlobal(Marshal.SizeOf(c)); Marshal.StructureToPtr(c, cond, false);
      foreach (var pair in new[] { new[] { FilterV4, LayerConnectV4 }, new[] { FilterV6, LayerConnectV6 } }) {
        var f = new FWPM_FILTER0 { filterKey = pair[0], flags = pf | FLAG_CLEAR_ACTION_RIGHT, layerKey = pair[1], subLayerKey = SubLayer, numFilterConditions = 1, filterCondition = cond };
        f.displayData.name = "Paw cdx sandbox block " + (pair[1] == LayerConnectV4 ? "v4" : "v6"); f.displayData.description = "Blocheaza conexiunile iesite ale " + userSid;
        f.action.type = FWP_ACTION_BLOCK;
        ulong id; r = FwpmFilterAdd0(engine, ref f, objectSd, out id);
        if (r != 0) throw new Exception("FwpmFilterAdd0 0x" + r.ToString("X8"));
        log += f.displayData.name + " id " + id + "; ";
      }
      uint rc = FwpmTransactionCommit0(engine); if (rc != 0) throw new Exception("FwpmTransactionCommit0 0x" + rc.ToString("X8")); tx = false;
      return log + "COMMIT";
    } finally {
      if (tx) FwpmTransactionAbort0(engine);
      if (cond != IntPtr.Zero) Marshal.FreeHGlobal(cond); if (blob != IntPtr.Zero) Marshal.FreeHGlobal(blob); if (sd != IntPtr.Zero) LocalFree(sd); if (objectSd != IntPtr.Zero) LocalFree(objectSd); FwpmEngineClose0(engine);
    }
  }


  [DllImport("fwpuclnt.dll")] static extern uint FwpmFilterGetByKey0(IntPtr h, ref Guid key, out IntPtr filter);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmSubLayerGetByKey0(IntPtr h, ref Guid key, out IntPtr sublayer);
  [DllImport("fwpuclnt.dll")] static extern void FwpmFreeMemory0(ref IntPtr p);

  static void Check(uint rc, string op) { if(rc != 0) throw new Exception(op + " 0x" + rc.ToString("X8")); }
  static void ValidateSid(string sid) {
    if (!System.Text.RegularExpressions.Regex.IsMatch(sid, @"^S-1-5-21-\d+-\d+-\d+-\d+$")) throw new Exception("SID invalid");
    new System.Security.Principal.SecurityIdentifier(sid);
  }
  // Pure validators shared with tests. No WFP engine calls here.
  public static void ValidateCondition(byte[] bytes, string sid) {
    ValidateSid(sid);
    var sd = new System.Security.AccessControl.RawSecurityDescriptor(bytes, 0);
    if(sd.DiscretionaryAcl == null || sd.DiscretionaryAcl.Count != 1) throw new Exception("WFP condition DACL mismatch");
    var ace = sd.DiscretionaryAcl[0] as System.Security.AccessControl.CommonAce;
    if(ace == null || ace.AceQualifier != System.Security.AccessControl.AceQualifier.AccessAllowed || ace.IsCallback || ace.AceFlags != 0 || ace.AccessMask != 1 || ace.SecurityIdentifier.Value != sid)
      throw new Exception("WFP condition SID/mask mismatch");
  }
  public static void ValidateShape(Guid key, Guid layer, Guid sublayer, uint flags, uint action, uint count, Guid condition, uint match, uint valueType, uint weightType) {
    if(!((key == FilterV4 && layer == LayerConnectV4) || (key == FilterV6 && layer == LayerConnectV6)) || sublayer != SubLayer || flags != (FLAG_PERSISTENT | FLAG_CLEAR_ACTION_RIGHT) || action != FWP_ACTION_BLOCK || count != 1 || condition != CondAleUserId || match != FWP_MATCH_EQUAL || valueType != FWP_SECURITY_DESCRIPTOR_TYPE || weightType != 0)
      throw new Exception("WFP filter shape mismatch");
  }
  public static string Inspect(string sid) {
    // Fixed-key lookup is read-only. Missing, nonpersistent, disabled, wrong SID/layer/action -> fail closed.
    ValidateSid(sid); IntPtr engine=Open(), ptr=IntPtr.Zero;
    try {
      Guid sk=SubLayer; Check(FwpmSubLayerGetByKey0(engine, ref sk, out ptr), "FwpmSubLayerGetByKey0");
      var sl=(FWPM_SUBLAYER0)Marshal.PtrToStructure(ptr, typeof(FWPM_SUBLAYER0));
      if(sl.subLayerKey != SubLayer || sl.flags != FLAG_PERSISTENT || sl.weight != 0x7FFF || sl.providerKey != IntPtr.Zero) throw new Exception("WFP sublayer mismatch");
      FwpmFreeMemory0(ref ptr);
      foreach(var id in new[]{FilterV4, FilterV6}) {
        Guid key=id; Check(FwpmFilterGetByKey0(engine, ref key, out ptr), "FwpmFilterGetByKey0");
        var f=(FWPM_FILTER0)Marshal.PtrToStructure(ptr, typeof(FWPM_FILTER0));
        if(f.numFilterConditions != 1 || f.filterCondition == IntPtr.Zero || f.providerKey != IntPtr.Zero) throw new Exception("WFP condition count/provider mismatch");
        var c=(FWPM_FILTER_CONDITION0)Marshal.PtrToStructure(f.filterCondition, typeof(FWPM_FILTER_CONDITION0));
        ValidateShape(f.filterKey,f.layerKey,f.subLayerKey,f.flags,f.action.type,f.numFilterConditions,c.fieldKey,c.matchType,c.conditionValue.type,f.weight.type);
        if(c.conditionValue.value == IntPtr.Zero) throw new Exception("WFP missing SD");
        var b=(FWP_BYTE_BLOB)Marshal.PtrToStructure(c.conditionValue.value, typeof(FWP_BYTE_BLOB));
        if(b.data == IntPtr.Zero || b.size < 20 || b.size > 65536) throw new Exception("WFP invalid SD size");
        byte[] bytes=new byte[b.size]; Marshal.Copy(b.data,bytes,0,bytes.Length); ValidateCondition(bytes,sid);
        FwpmFreeMemory0(ref ptr);
      }
      return "persistent-ale-connect-v1|"+sid+"|"+SubLayer+"|"+FilterV4+"|"+FilterV6;
    } finally { if(ptr != IntPtr.Zero) FwpmFreeMemory0(ref ptr); FwpmEngineClose0(engine); }
  }
  public static string Remove() {
    // Explicit operator rollback only. Transactional; missing own keys are allowed, every other error aborts.
    IntPtr engine=Open(); bool tx=false;
    try {
      Check(FwpmTransactionBegin0(engine,0),"FwpmTransactionBegin0"); tx=true;
      foreach(var id in new[]{FilterV4,FilterV6}) {
        Guid key=id; uint rc=FwpmFilterDeleteByKey0(engine,ref key);
        if(rc != FWP_E_NOT_FOUND_FILTER) Check(rc,"FwpmFilterDeleteByKey0");
      }
      Guid sk=SubLayer; uint rs=FwpmSubLayerDeleteByKey0(engine,ref sk);
      if(rs != FWP_E_NOT_FOUND_SUBLAYER) Check(rs,"FwpmSubLayerDeleteByKey0");
      Check(FwpmTransactionCommit0(engine),"FwpmTransactionCommit0"); tx=false;
      return "Own WFP filters and sublayer removed; COMMIT";
    } finally { if(tx) FwpmTransactionAbort0(engine); FwpmEngineClose0(engine); }
  }

  // Microsoft fwpmu.h: OPEN=0x40, READ=0x80 (NOT the 0x2/0x4 values in the review).
  // Separate, explicit ADMIN maintenance step. No transaction and no mutation on import.
  public const int EngineReadMask = 0x000000C0;
  public sealed class EngineReadPlan {
    public string Sid, Before, After;
    public bool Added;
    public int Mask = EngineReadMask;
  }
  [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineGetSecurityInfo0(IntPtr h, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr sd);
  [DllImport("fwpuclnt.dll")] static extern uint FwpmEngineSetSecurityInfo0(IntPtr h, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  static System.Security.AccessControl.RawAcl ReadAcl(string b64) {
    byte[] bytes=Convert.FromBase64String(b64);
    var acl=new System.Security.AccessControl.RawAcl(bytes,0);
    if(acl.BinaryLength != bytes.Length) throw new Exception("WFP DACL trailing bytes");
    return acl;
  }
  static string AclBase64(System.Security.AccessControl.RawAcl acl) {
    byte[] bytes=new byte[acl.BinaryLength]; acl.GetBinaryForm(bytes,0); return Convert.ToBase64String(bytes);
  }
  public static EngineReadPlan PlanEngineRead(string before, string sid) {
    ValidateSid(sid); var acl=ReadAcl(before); int matches=0, insertAt=acl.Count;
    for(int i=0;i<acl.Count;i++) {
      if((acl[i].AceFlags & System.Security.AccessControl.AceFlags.Inherited) != 0 && insertAt==acl.Count) insertAt=i;
      var ace=acl[i] as System.Security.AccessControl.CommonAce;
      if(ace != null && !ace.IsCallback && ace.AceFlags==0 && ace.AceQualifier==System.Security.AccessControl.AceQualifier.AccessAllowed && ace.AccessMask==EngineReadMask && ace.SecurityIdentifier.Value==sid) matches++;
    }
    if(matches>1) throw new Exception("Ambiguous duplicate reader ACEs; manual review required");
    if(matches==0) acl.InsertAce(insertAt,new System.Security.AccessControl.CommonAce(System.Security.AccessControl.AceFlags.None,System.Security.AccessControl.AceQualifier.AccessAllowed,EngineReadMask,new System.Security.Principal.SecurityIdentifier(sid),false,null));
    return new EngineReadPlan { Sid=sid, Before=before, After=AclBase64(acl), Added=(matches==0) };
  }
  public static string PlanEngineRevoke(string current, string before, string after, string sid, bool added) {
    ReadAcl(current); var plan=PlanEngineRead(before,sid);
    if(plan.After!=after || plan.Added!=added) throw new Exception("WFP receipt does not prove one exact added ACE");
    if(!added) return current; // Preexisting identical ACE was not ours; never remove it.
    if(current==before) return current; // Already rolled back.
    if(current!=after) throw new Exception("WFP DACL drift; no rollback over other changes");
    return before; // Exact after==before+one ACE: removes only our addition.
  }
  static string ReadEngineDacl(IntPtr h) {
    IntPtr owner,group,dacl,sacl,sd=IntPtr.Zero;
    try {
      Check(FwpmEngineGetSecurityInfo0(h,4,out owner,out group,out dacl,out sacl,out sd),"FwpmEngineGetSecurityInfo0");
      if(dacl==IntPtr.Zero) throw new Exception("Null engine DACL; manual review required");
      int size=(ushort)Marshal.ReadInt16(dacl,2);
      if(size<8) throw new Exception("Invalid engine DACL length");
      byte[] bytes=new byte[size];Marshal.Copy(dacl,bytes,0,size);
      string b64=Convert.ToBase64String(bytes);ReadAcl(b64);return b64;
    } finally {if(sd!=IntPtr.Zero) FwpmFreeMemory0(ref sd);}
  }
  public static string GetEngineDacl() {
    IntPtr h=Open();try{return ReadEngineDacl(h);}finally{FwpmEngineClose0(h);}
  }
  static void RequireEngineAdmin() {
    var p=new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent());
    if(!p.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator)) throw new Exception("WFP engine maintenance requires administrator");
  }
  static void WriteEngineDacl(IntPtr h, string expected, string desired) {
    if(ReadEngineDacl(h)!=expected) throw new Exception("WFP DACL changed before write");
    if(expected==desired) return;
    byte[] bytes=Convert.FromBase64String(desired);ReadAcl(desired);IntPtr acl=Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes,0,acl,bytes.Length);
      // DACL_SECURITY_INFORMATION ONLY; owner/group/SACL untouched. Never inside a WFP transaction.
      Check(FwpmEngineSetSecurityInfo0(h,4,IntPtr.Zero,IntPtr.Zero,acl,IntPtr.Zero),"FwpmEngineSetSecurityInfo0");
    } finally {Marshal.FreeHGlobal(acl);}
    if(ReadEngineDacl(h)!=desired) throw new Exception("WFP DACL post-write differs; preserve receipt, manual review required");
  }
  public static void GrantEngineRead(string before, string after, string sid) {
    RequireEngineAdmin();var plan=PlanEngineRead(before,sid);
    if(plan.After!=after) throw new Exception("WFP reader plan changed");
    IntPtr h=Open();try{WriteEngineDacl(h,before,after);}finally{FwpmEngineClose0(h);}
  }
  public static void RevokeEngineRead(string before, string after, string sid, bool added) {
    RequireEngineAdmin();IntPtr h=Open();
    try{string current=ReadEngineDacl(h);string desired=PlanEngineRevoke(current,before,after,sid,added);WriteEngineDacl(h,current,desired);}
    finally{FwpmEngineClose0(h);}
  }
}
