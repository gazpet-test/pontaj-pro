// ===========================================================================
// TKT-2026-0333 — „⚠ Contract neînregistrat în Administrativ” (pagina proiectului din Execuție)
// ===========================================================================
// Apare doar pe proiectele cu nr_contract completat și contract_id NULL (logica în
// executieContractLegatura.js). Două ieșiri, fără formular nou și fără RPC:
//  • 🔗 Leagă de un contract din Administrativ — caută în contracte_terti (fără arhivate) și
//    face UPDATE executie_proiecte SET contract_id. RLS-ul existent decide; refuzul se afișează. Regula 1:1 o ține
//    indexul unic 20261030b: a doua legare a aceluiași contract dă 23505 → mesaj + lista se reîncarcă.
//  • 📃 Înregistrează în Administrativ ↗ — deschide Administrativ → Contracte cu terți într-un
//    tab nou și arată ce trebuie completat (șantierul face legătura automată la salvare).
// Butoanele apar doar pentru cine poate edita Execuția (owner / can_manage_contracts).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'
import {
  eContractNelegat, ETICHETA_CONTRACT_NELEGAT, TOOLTIP_CONTRACT_NELEGAT, LINK_ADMIN_CONTRACTE,
  filtreazaContracte, proiectLegatAltundeva, partenerContract, instructiuniInregistrare,
  textToastInregistrare, fmtZi, fmtLeiSimplu, mesajEroareLegare, eContractOcupat,
} from './executieContractLegatura.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636', yellow:'#D29922', orange:'#F0883E', red:'#F85149',
}
const S = {
  btnP:  { padding:'7px 13px', background:G.orange, border:'none', borderRadius:7, color:'#0D1117', fontSize:12, fontWeight:700, cursor:'pointer' },
  btn:   { padding:'7px 13px', background:'transparent', border:`1px solid ${G.border}`, borderRadius:7, color:G.text, fontSize:12, fontWeight:600, cursor:'pointer', textDecoration:'none', display:'inline-block' },
  input: { width:'100%', boxSizing:'border-box', padding:'9px 12px', background:G.bg, border:`1px solid ${G.border}`, borderRadius:7, color:G.text, fontSize:13, outline:'none' },
}
const STATUS_ETICHETA = { draft:'Draft', activ:'Activ', suspendat:'Suspendat', finalizat:'Finalizat', reziliat:'Reziliat' }

export default function ContractNelegatPanel({ proiect: p, canEdit, onSchimbat }) {
  const [toast, setToast] = useState(null)
  const [arataPasi, setArataPasi] = useState(false)
  const [deschis, setDeschis] = useState(false)
  const arataToast = (msg, tip = 'info', ms = 5000) => { setToast({ msg, tip }); setTimeout(() => setToast(null), ms) }

  // toast-ul rămâne vizibil și după ce proiectul s-a legat (panoul dispare, mesajul nu)
  const toastEl = toast && (
    <div style={{ position:'fixed', top:80, right:24, zIndex:9999, maxWidth:460, padding:'12px 18px', borderRadius:8, fontSize:13, fontWeight:600, color:'#fff',
      background: toast.tip === 'error' ? G.red : toast.tip === 'success' ? G.greenBg : G.blue, boxShadow:'0 4px 20px rgba(0,0,0,.5)' }}>{toast.msg}</div>
  )
  if (!eContractNelegat(p)) return toastEl || null

  return (
    <div style={{ marginTop:12, background:G.orange + '0D', border:`1px solid ${G.orange}55`, borderRadius:8, padding:'10px 14px' }}>
      {toastEl}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <span title={TOOLTIP_CONTRACT_NELEGAT} style={{ fontSize:13, fontWeight:700, color:G.orange, cursor:'help' }}>{ETICHETA_CONTRACT_NELEGAT}</span>
        <span style={{ fontSize:11, color:G.muted, flex:1, minWidth:220 }}>
          Nr. {p.nr_contract} e scris doar în Execuție — în Administrativ → Contracte cu terți nu apare (acte adiționale, garanții, facturare).
        </span>
        {canEdit ? (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={() => setDeschis(true)} style={S.btnP}>🔗 Leagă de un contract din Administrativ</button>
            <a href={LINK_ADMIN_CONTRACTE} target="_blank" rel="noopener noreferrer" style={S.btn}
              title="Deschide Administrativ → Contracte cu terți într-un tab nou"
              onClick={() => { setArataPasi(true); arataToast(textToastInregistrare(p), 'info', 9000) }}>📃 Înregistrează în Administrativ ↗</a>
          </div>
        ) : (
          <span style={{ fontSize:11, color:G.dim }}>Legătura o face cine are drept de editare pe contracte.</span>
        )}
      </div>

      {arataPasi && canEdit && (
        <div style={{ marginTop:10, background:G.card, border:`1px solid ${G.border}`, borderRadius:7, padding:'10px 12px' }}>
          <div style={{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:6 }}>Ce completezi în Administrativ → Contracte cu terți → „+ Contract nou”:</div>
          <ul style={{ margin:0, paddingLeft:18, fontSize:12, color:G.text, lineHeight:1.6 }}>
            {instructiuniInregistrare(p).map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:11, color:G.dim, flex:1, minWidth:200 }}>După salvare revino aici: dacă avertismentul nu dispare, apasă „🔗 Leagă…” și alege contractul.</span>
            <button onClick={() => onSchimbat && onSchimbat()} style={S.btn}>↻ Am salvat — verifică</button>
          </div>
        </div>
      )}

      {deschis && (
        <LegaContractModal proiect={p} onClose={() => setDeschis(false)} arataToast={arataToast}
          onLegat={() => { setDeschis(false); onSchimbat && onSchimbat() }} />
      )}
    </div>
  )
}

function LegaContractModal({ proiect: p, onClose, onLegat, arataToast }) {
  const [incarc, setIncarc] = useState(true)
  const [eroare, setEroare] = useState(null)
  const [contracte, setContracte] = useState([])
  const [benefMap, setBenefMap] = useState({})
  const [legaturi, setLegaturi] = useState([])
  const [cautare, setCautare] = useState('')
  const [doarIncasare, setDoarIncasare] = useState(true)
  const [salvez, setSalvez] = useState(null)
  const [reincarc, setReincarc] = useState(0)   // după 23505 lista se citește din nou

  useEffect(() => {
    let live = true
    setIncarc(true); setEroare(null)
    ;(async () => {
      const [ct, ben, leg] = await Promise.all([
        supabase.from('contracte_terti')
          .select('id, numar_contract, denumire, partener_text, beneficiar_id, data_semnare, valoare_lei, valoare_eur, sens, categorie, status, site_id, santiere_ids, arhivat_la')
          .is('arhivat_la', null)
          .order('data_semnare', { ascending:false, nullsFirst:false }),
        supabase.from('beneficiari').select('id, nume'),
        supabase.from('executie_proiecte').select('id, cod_intern, contract_id').not('contract_id', 'is', null),
      ])
      if (!live) return
      // fără lista legăturilor nu știm ce contracte sunt ocupate → legarea se blochează (Jakarinos r1 P2)
      if (ct.error) setEroare('Nu am putut citi contractele din Administrativ: ' + ct.error.message)
      else if (leg.error) setEroare('Nu am putut verifica ce contracte sunt deja legate de alte proiecte (' + leg.error.message + '). Legarea e blocată — închide și încearcă din nou.')
      setContracte(ct.data || [])
      setBenefMap(Object.fromEntries((ben.data || []).map(b => [b.id, b.nume])))
      setLegaturi(leg.data || [])
      setIncarc(false)
    })()
    return () => { live = false }
  }, [reincarc])

  const lista = useMemo(() => filtreazaContracte(contracte, { cautare, doarIncasare, proiect: p, benefMap }),
    [contracte, cautare, doarIncasare, p, benefMap])

  async function leaga(c) {
    if (incarc || eroare || proiectLegatAltundeva(c.id, legaturi, p.id)) return
    const ok = window.confirm(
      `Legi proiectul ${p.cod_intern || p.nume} de contractul nr. ${c.numar_contract || '—'} (${partenerContract(c, benefMap)})?\n\n` +
      'Se salvează doar legătura. De acum Execuția arată valoarea și termenul din contractul din Administrativ (cu actele adiționale); ' +
      'numărul și data scrise în Execuție nu se modifică.')
    if (!ok) return
    setSalvez(c.id)
    // .is('contract_id', null): nu suprascrie o legătură făcută între timp din altă parte
    const { data, error } = await supabase.from('executie_proiecte')
      .update({ contract_id: c.id, updated_at: new Date().toISOString() })
      .eq('id', p.id).is('contract_id', null).select('id')
    setSalvez(null)
    // 23505 = indexul unic 20261030b: altcineva a legat între timp contractul de alt proiect → lista se reîncarcă
    if (error) { arataToast(mesajEroareLegare(error), 'error', 9000); if (eContractOcupat(error)) setReincarc(k => k + 1); return }
    if (!data?.length) { arataToast('Legătura nu s-a salvat: fie nu ai drept de modificare pe proiect, fie proiectul a fost legat între timp. Reîncarcă pagina.', 'error', 9000); return }
    arataToast(`✔ Proiect legat de contractul nr. ${c.numar_contract || '#' + c.id} din Administrativ`, 'success')
    onLegat()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:G.surface, border:`1px solid ${G.border}`, borderRadius:14, width:'100%', maxWidth:760, maxHeight:'85vh', display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:800, color:G.text }}>🔗 Leagă de un contract din Administrativ</div>
            <div style={{ fontSize:12, color:G.muted, marginTop:4 }}>
              {p.cod_intern || p.nume} · în Execuție: nr. {p.nr_contract}{fmtZi(p.data_contract) ? ` din ${fmtZi(p.data_contract)}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer', lineHeight:1, padding:4 }}>×</button>
        </div>

        <div style={{ padding:'12px 20px', borderBottom:`1px solid ${G.border}`, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          <input autoFocus value={cautare} onChange={e => setCautare(e.target.value)} placeholder="🔍 Caută număr, partener, dată, valoare..." style={{ ...S.input, flex:1, minWidth:240, width:'auto' }} />
          <label style={{ fontSize:12, color:G.muted, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
            <input type="checkbox" checked={doarIncasare} onChange={e => setDoarIncasare(e.target.checked)} />
            doar încasare (contractul cu beneficiarul)
          </label>
        </div>

        <div style={{ overflowY:'auto', padding:'10px 20px', flex:1 }}>
          {incarc ? <div style={{ padding:30, textAlign:'center', color:G.muted, fontSize:13 }}>⏳ Se încarcă contractele...</div>
          : eroare ? <div style={{ padding:20, color:G.red, fontSize:13 }}>{eroare}</div>
          : lista.length === 0 ? (
            <div style={{ padding:24, textAlign:'center', color:G.muted, fontSize:13 }}>
              Niciun contract {doarIncasare ? 'de încasare ' : ''}nearhivat nu se potrivește.
              <div style={{ fontSize:12, marginTop:6 }}>Dacă nu există încă, folosește „📃 Înregistrează în Administrativ ↗”.</div>
            </div>
          ) : lista.map(({ contract: c, motive }) => {
            const alt = proiectLegatAltundeva(c.id, legaturi, p.id)
            const nrDiferit = !motive.some(m => m.includes('număr'))
            return (
              <div key={c.id} style={{ background:G.card, border:`1px solid ${motive.length ? G.green + '55' : G.border}`, borderRadius:8, padding:'10px 12px', marginBottom:8, display:'flex', alignItems:'center', gap:12, opacity: alt ? 0.6 : 1 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:G.text }}>
                    Nr. {c.numar_contract || '—'} <span style={{ fontWeight:500, color:G.muted }}>· {partenerContract(c, benefMap)}</span>
                  </div>
                  <div style={{ fontSize:11, color:G.muted, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }} title={c.denumire || ''}>
                    {fmtZi(c.data_semnare) || 'fără dată'} · {fmtLeiSimplu(c.valoare_lei) || '—'} · {c.sens === 'incasare' ? '⬇ Încasare' : '⬆ Plată'} · {STATUS_ETICHETA[c.status] || c.status || '—'}{c.denumire ? ` · ${c.denumire}` : ''}
                  </div>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginTop:5 }}>
                    {motive.map(m => <span key={m} style={{ fontSize:10, padding:'1px 7px', borderRadius:8, background:G.green + '22', color:G.green, fontWeight:700 }}>🎯 {m}</span>)}
                    {nrDiferit && <span style={{ fontSize:10, padding:'1px 7px', borderRadius:8, background:G.yellow + '22', color:G.yellow, fontWeight:700 }}>⚠ număr diferit de cel din Execuție</span>}
                    {alt && <span style={{ fontSize:10, padding:'1px 7px', borderRadius:8, background:G.border, color:G.muted, fontWeight:700 }}>legat deja de {alt.cod_intern || 'proiectul #' + alt.id}</span>}
                  </div>
                </div>
                <button disabled={!!alt || salvez != null} onClick={() => leaga(c)}
                  title={alt ? 'Contractul e deja legat de alt proiect — mutarea se face din Administrativ' : 'Leagă proiectul de acest contract'}
                  style={{ ...S.btnP, background: alt ? G.border : G.greenBg, color: alt ? G.muted : '#fff', cursor: alt || salvez != null ? 'not-allowed' : 'pointer', flexShrink:0 }}>
                  {salvez === c.id ? '⏳' : '✓ Leagă'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
