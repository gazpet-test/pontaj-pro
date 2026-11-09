// PoliteAlerteAdmin.jsx — Administrator → 🛡️ Alerte polițe (owner). Polițe 20261205a, etapa 1.
//   • comutatorul alertelor (mail + notificări): OPRIT la instalare; pornirea cere o probă în ultimele 24 h (și în BD);
//   • lista de destinatari pe departament (doar @gazpet.ro — și în BD); Execuție = șeful de șantier / MP-ul proiectului contractului;
//   • proba: „cine ce ar primi azi” — scrie doar rânduri de probă în jurnal, NU trimite nimic; previzualizarea mailului pe destinatar;
//   • jurnalul: ce s-a trimis, ce e „necunoscut” (timeout la trimitere: de verificat, nu se retrimite singur), ce n-a avut destinatar.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { ETICHETE_TIP, TIPURI_POLITA, grupeazaPeDestinatar, mailPolite, mesajEroare, situatiePolita, fmtZiRo } from './polite.js'

const G = { bg:'#F1F5F9', surface:'#FFFFFF', border:'#E2E8EF', text:'#263642', muted:'#617282', blue:'#24778B', green:'#38765A', red:'#B74D55', yellow:'#946B20' }
const S = {
  panel: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:10, padding:16, marginBottom:16 },
  button: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:7, padding:'8px 12px', minHeight:36, cursor:'pointer', fontFamily:'inherit', fontSize:13 },
  input: { border:`1px solid ${G.border}`, borderRadius:6, padding:'7px 9px', fontSize:13, fontFamily:'inherit', minWidth:0 },
  small: { color:G.muted, fontSize:12, lineHeight:1.6 },
  th: { textAlign:'left', padding:'7px 8px', fontSize:12, color:G.muted, borderBottom:`1px solid ${G.border}` },
  td: { padding:'7px 8px', fontSize:13, borderBottom:`1px solid ${G.border}`, verticalAlign:'top' },
}
const DEP = { financiar:'Financiar', executie:'Execuție', ofertare:'Ofertare' }
const FEL = { adresa:'Adresă fixă', sef_santier:'Șeful de șantier al proiectului', manager_proiect:'Managerul de proiect' }
const STARE = { trimis:['trimis', G.green], rezervat:['în trimitere', G.blue], necunoscut:['necunoscut — de verificat', G.yellow], eroare:['eroare', G.red], fara_adresa:['fără destinatar', G.red], proba:['probă', G.muted] }
const fmtLa = v => v ? new Date(v).toLocaleString('ro-RO', { timeZone:'Europe/Bucharest', dateStyle:'short', timeStyle:'short' }) : '—'

export default function PoliteAlerteAdmin({ profile }) {
  const [cfg, setCfg] = useState(null)
  const [dest, setDest] = useState([])
  const [jurnal, setJurnal] = useState([])
  const [eroare, setEroare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [nou, setNou] = useState({ departament:'financiar', fel:'adresa', nume:'', email:'' })
  const [preview, setPreview] = useState(null)

  // r2 (Jakarinos r1 P2-8): încărcarea NU șterge eroarea unei acțiuni; întoarce eroarea ei de citire (sau null), iar apelantul decide
  const incarca = useCallback(async () => {
    const COL = 'id, cheie, zi, prag, departamente, destinatar_email, stare, eroare, rand, creat_la'
    const [c, d, p, j] = await Promise.all([
      supabase.from('polite_alerte_config').select('activ, schimbat_la, proba_la').maybeSingle(),
      supabase.from('polite_alerte_destinatari').select('*').order('departament').order('fel').order('id'),
      // proba (ultima, toată): cerere separată, ca trimiterile noi să nu o împingă afară din listă
      supabase.from('polite_alerte_jurnal').select(COL, { count:'exact' }).eq('stare', 'proba').order('id').limit(1000),
      // jurnalul: explicit doar ultimele 200 de trimiteri reale
      supabase.from('polite_alerte_jurnal').select(COL).neq('stare', 'proba').order('creat_la', { ascending:false }).order('id', { ascending:false }).limit(200),
    ])
    const e = c.error || d.error || p.error || j.error
    if (e) return /polite_alerte|schema cache|does not exist/i.test(e.message || '') ? 'Alertele polițelor nu sunt încă instalate în baza de date (migrarea 20261205a).' : mesajEroare(e)
    setCfg(c.data); setDest(d.data || []); setJurnal([...(p.data || []), ...(j.data || [])])
    return (p.count ?? 0) > (p.data || []).length ? 'Proba are peste 1000 de rânduri: lista de mai jos e incompletă.' : null
  }, [])
  useEffect(() => { incarca().then(setEroare) }, [incarca])

  // acțiune → reîncărcare → eroarea acțiunii are prioritate față de cea a citirii (nu se pierde)
  const ruleaza = async (fn, args) => {
    setBusy(true); setEroare(null)
    const { data, error } = await supabase.rpc(fn, args)
    const eCitire = await incarca()
    setBusy(false)
    setEroare(error ? mesajEroare(error) : eCitire)
    return error ? null : data
  }
  const proba = () => ruleaza('fn_polite_alerte_proba', {})
  const comuta = async activ => {
    if (activ && !confirm('Pornești alertele polițelor? De mâine dimineață (07:15) pleacă mailuri reale către lista de mai jos și notificări în aplicație.')) return
    if (!activ && !confirm('Oprești alertele polițelor (mail + notificări)?')) return
    await ruleaza('fn_polite_alerte_porneste', { p_activ:activ })
  }
  // scrierea întoarce true doar dacă a atins efectiv un rând (RLS poate filtra în tăcere: 0 rânduri = eroare vizibilă)
  const scrie = async (op, mesaj) => {
    setBusy(true); setEroare(null)
    const { data, error } = await op.select('id')
    const eCitire = await incarca()
    setBusy(false)
    const eScriere = error ? (/polite_dest_email_check/.test(error.message || '') ? 'adresa trebuie să fie @gazpet.ro' : /polite_dest_unic/.test(error.message || '') ? 'destinatarul există deja' : mesajEroare(error))
      : !data?.length ? 'nicio înregistrare modificată (reîncarcă pagina)' : null
    setEroare(eScriere ? `${mesaj}: ${eScriere}` : eCitire)
    return !eScriere
  }
  const adauga = async () => {
    const rand = { departament:nou.departament, fel:nou.fel, nume:nou.nume.trim() || null, email:nou.fel === 'adresa' ? (nou.email.trim() || null) : null }
    if (rand.fel === 'adresa' && !rand.email) { setEroare('Completează adresa (@gazpet.ro).'); return }
    if (await scrie(supabase.from('polite_alerte_destinatari').insert(rand), 'Nu s-a adăugat')) setNou(x => ({ ...x, nume:'', email:'' }))
  }
  const actualizeaza = (r, campuri) => scrie(supabase.from('polite_alerte_destinatari').update(campuri).eq('id', r.id), 'Nu s-a salvat')
  const sterge = r => { if (confirm(`Scoți destinatarul ${r.email || FEL[r.fel]} din lista ${DEP[r.departament]}?`)) scrie(supabase.from('polite_alerte_destinatari').delete().eq('id', r.id), 'Nu s-a șters') }

  const probe = useMemo(() => jurnal.filter(j => j.stare === 'proba'), [jurnal])
  const grupeProba = useMemo(() => grupeazaPeDestinatar(probe.map(p => ({ ...p, stare:p.destinatar_email ? 'rezervat' : 'fara_adresa' }))), [probe])
  const faraProba = probe.filter(p => !p.destinatar_email)
  const reale = jurnal.filter(j => j.stare !== 'proba')
  const probaProaspata = cfg?.proba_la && Date.now() - new Date(cfg.proba_la).getTime() < 24 * 3600 * 1000

  if (profile?.is_owner !== true) return <p style={S.small}>Doar owner-ul vede această pagină.</p>
  return (
    <div>
      {eroare && <div role="alert" style={{ ...S.panel, color:G.red }}>{eroare}</div>}
      <section style={S.panel} aria-label="Comutatorul alertelor">
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ fontSize:15, fontWeight:700 }}>🛡️ Alertele de expirare a polițelor</div>
          <span style={{ fontWeight:700, color:cfg?.activ ? G.green : G.red }}>{cfg ? (cfg.activ ? 'PORNITE' : 'OPRITE') : '—'}</span>
          <span style={S.small}>{cfg?.schimbat_la ? `schimbat ${fmtLa(cfg.schimbat_la)}` : ''}{cfg?.proba_la ? ` · ultima probă ${fmtLa(cfg.proba_la)}` : ' · nicio probă încă'}</span>
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <button type="button" disabled={busy || !cfg} onClick={proba} style={S.button}>Rulează proba (cine ce ar primi azi)</button>
            {cfg?.activ
              ? <button type="button" disabled={busy} onClick={() => comuta(false)} style={{ ...S.button, color:G.red, borderColor:G.red + '66' }}>Oprește alertele</button>
              : <button type="button" disabled={busy || !probaProaspata} title={probaProaspata ? '' : 'Rulează întâi proba (valabilă 24 de ore)'} onClick={() => comuta(true)} style={{ ...S.button, color:G.green, borderColor:G.green + '66' }}>Pornește alertele</button>}
          </div>
        </div>
        <p style={{ ...S.small, margin:'8px 0 0' }}>Zilnic la 07:15: mail la 60 / 30 / 15 zile înainte de expirare și în ziua expirării, apoi o dată pe săptămână până se încarcă prelungirea (actul adițional) sau până se închide polița. Aceleași alerte apar în aplicație, la cei care au cont. Proba nu trimite nimic.</p>
      </section>

      <section style={S.panel} aria-label="Destinatari">
        <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>Destinatari</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ borderCollapse:'collapse', width:'100%' }}>
            <thead><tr>{['Departament', 'Cine', 'Adresă', 'Tipuri urmărite', 'Activ', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {dest.map(r => (
                <tr key={r.id}>
                  <td style={S.td}>{DEP[r.departament]}</td>
                  <td style={S.td}>{r.fel === 'adresa' ? (r.nume || '—') : FEL[r.fel]}{r.observatii && <div style={{ ...S.small, color:G.yellow }}>{r.observatii}</div>}</td>
                  <td style={S.td}>{r.fel === 'adresa'
                    ? <input defaultValue={r.email || ''} placeholder="nume@gazpet.ro" style={{ ...S.input, width:230, borderColor:r.email ? G.border : G.red }}
                        onBlur={e => { const v = e.target.value.trim().toLowerCase(); if (v !== (r.email || '')) actualizeaza(r, { email:v || null, observatii:v ? null : r.observatii }) }} />
                    : <span style={S.small}>contul ERP al omului (doar @gazpet.ro)</span>}</td>
                  <td style={S.td}>{TIPURI_POLITA.map(t => (
                    <label key={t} style={{ marginRight:8, fontSize:12, whiteSpace:'nowrap' }} title={ETICHETE_TIP[t]}>
                      <input type="checkbox" checked={(r.tipuri || []).includes(t)} disabled={busy}
                        onChange={e => { const n = e.target.checked ? [...new Set([...(r.tipuri || []), t])] : (r.tipuri || []).filter(x => x !== t); if (n.length) actualizeaza(r, { tipuri:n }) }} /> {t}
                    </label>))}</td>
                  <td style={S.td}><input type="checkbox" checked={r.activ} disabled={busy} onChange={e => actualizeaza(r, { activ:e.target.checked })} /></td>
                  <td style={S.td}><button type="button" onClick={() => sterge(r)} disabled={busy} style={{ ...S.button, minHeight:28, padding:'4px 8px', color:G.red }}>Scoate</button></td>
                </tr>))}
              {dest.length === 0 && <tr><td colSpan={6} style={{ ...S.td, color:G.muted }}>Niciun destinatar.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10, alignItems:'center' }}>
          <select value={nou.departament} onChange={e => setNou(x => ({ ...x, departament:e.target.value, fel:e.target.value === 'executie' ? x.fel : 'adresa' }))} style={S.input}>
            {Object.entries(DEP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={nou.fel} onChange={e => setNou(x => ({ ...x, fel:e.target.value }))} style={S.input}>
            {Object.entries(FEL).filter(([k]) => k === 'adresa' || nou.departament === 'executie').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {nou.fel === 'adresa' && <>
            <input value={nou.nume} onChange={e => setNou(x => ({ ...x, nume:e.target.value }))} placeholder="Nume" style={{ ...S.input, width:170 }} />
            <input value={nou.email} onChange={e => setNou(x => ({ ...x, email:e.target.value }))} placeholder="nume@gazpet.ro" style={{ ...S.input, width:230 }} /></>}
          <button type="button" onClick={adauga} disabled={busy} style={S.button}>＋ Adaugă</button>
        </div>
      </section>

      <section style={S.panel} aria-label="Proba">
        <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>Proba {cfg?.proba_la ? `din ${fmtLa(cfg.proba_la)}` : ''}: cine ce ar primi</div>
        {!cfg?.proba_la && <p style={S.small}>Nicio probă rulată.</p>}
        {cfg?.proba_la && probe.length === 0 && <p style={S.small}>Nicio poliță nu atinge azi un prag (sau toate au fost deja anunțate).</p>}
        {grupeProba.map(g => (
          <div key={g.email} style={{ display:'flex', gap:10, alignItems:'center', padding:'6px 0', borderBottom:`1px solid ${G.border}`, flexWrap:'wrap' }}>
            <b>{g.email}</b><span style={S.small}>{g.randuri.length} poliț{g.randuri.length === 1 ? 'ă' : 'e'}: {g.randuri.map(r => `${r.rand?.tip} ${r.rand?.nr_polita || '—'} (${situatiePolita(r.prag, Number(r.rand?.zile))})`).join('; ')}</span>
            <button type="button" style={{ ...S.button, marginLeft:'auto', minHeight:28, padding:'4px 8px' }} onClick={() => setPreview(mailPolite({ randuri:g.randuri, faraAdresa:g.faraAdresa }))}>Vezi mailul</button>
          </div>))}
        {faraProba.length > 0 && <div style={{ marginTop:8, color:G.red, fontSize:13 }}>Fără destinatar: {faraProba.map(p => `${p.rand?.tip} ${p.rand?.nr_polita || '—'} → ${(p.departamente || []).map(d => DEP[d]).join(', ')}`).join('; ')}</div>}
        {preview && <div style={{ marginTop:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}><b>Subiect:</b> {preview.subiect}<button type="button" onClick={() => setPreview(null)} style={{ ...S.button, marginLeft:'auto', minHeight:28, padding:'4px 8px' }}>Închide</button></div>
          <iframe title="Previzualizare mail" sandbox="" srcDoc={preview.html} style={{ width:'100%', height:420, border:`1px solid ${G.border}`, borderRadius:8, background:'#fff' }} />
        </div>}
      </section>

      <section style={S.panel} aria-label="Jurnal">
        <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>Jurnal (ultimele trimiteri)</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ borderCollapse:'collapse', width:'100%' }}>
            <thead><tr>{['Zi', 'Poliță', 'Situație', 'Destinatar', 'Stare'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {reale.slice(0, 200).map(j => {
                const [l, c] = STARE[j.stare] || [j.stare, G.muted]
                return <tr key={j.id}>
                  <td style={S.td}>{fmtZiRo(j.zi)}</td>
                  <td style={S.td}>{j.rand?.tip} {j.rand?.nr_polita || '—'}<div style={S.small}>{j.rand?.numar_contract || ''} {j.rand?.proiect_nume ? `· ${j.rand.proiect_nume}` : ''}</div></td>
                  <td style={S.td}>{situatiePolita(j.prag, Number(j.rand?.zile))}</td>
                  <td style={S.td}>{j.destinatar_email || (j.departamente || []).map(d => DEP[d]).join(', ')}</td>
                  <td style={{ ...S.td, color:c, fontWeight:600 }}>{l}{j.eroare && <div style={S.small}>{j.eroare}</div>}</td>
                </tr>
              })}
              {reale.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color:G.muted }}>Nicio alertă trimisă încă.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
