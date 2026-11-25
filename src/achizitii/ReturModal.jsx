// Achiziții — retur la furnizor (TKT-2026-0347), PR2: fereastra „↩️ Retur” pe reper + fereastra de reconciliere a unei linii vechi (owner).
// Scrierea = DOAR RPC-urile din 20270110a (fn_cf_retur_inregistreaza, fn_cf_reconciliaza_linie), prin registrul local al cererilor
// neconfirmate (actions.executaCF): cheia se generează o dată pe fereastră și se refolosește la reîncercare (L04 / L05).
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import {
  laMii, fmtMii, primitaEfectivaMii, intrataMii, limiteDinStoc, locatiiRetur, locatieImplicita, planRetur, planReconciliere, cheieFereastra, ID_PLAN,
} from '../achizitiiRetur.js'

// citirea stocului unei locații pe cheia EXACTĂ (locație + denumirea liniei, ca fn_stoc_blocheaza): null = necunoscut, 'ambiguu' = mai multe rânduri
async function citesteStoc(loc, denumire) {
  let q = supabase.from('stocuri').select('id, cantitate').eq('locatie_tip', loc.locatie_tip).eq('material_denumire', denumire)
  q = loc.locatie_id == null ? q.is('locatie_id', null) : q.eq('locatie_id', loc.locatie_id)
  const { data, error } = await q
  if (error) throw error
  if (!data || !data.length) return 0
  if (data.length > 1) return 'ambiguu'
  return laMii(Number(data[0].cantitate))
}

function Fereastra({ G, S, titlu, onClose, children }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={titlu} style={{ position:'fixed', inset:0, zIndex:1100, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'40px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(600px,100%)', padding:20 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div style={{ fontSize:17, fontWeight:800 }}>{titlu}</div>
          <button onClick={onClose} style={{ ...S.btnIcon, border:'none', fontSize:18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// banda „cerere neconfirmată”: câmpurile se blochează, butonul retrimite EXACT aceeași cerere (aceeași cheie, aceiași parametri)
export function BandaNeconfirmata({ G, plan, descriere }) {
  if (!plan) return null
  return (
    <div style={{ padding:10, borderRadius:8, border:`1px solid ${G.yellow}66`, background:G.yellow + '12', fontSize:12, marginBottom:12 }}>
      <b style={{ color:G.yellow }}>⏳ Cerere trimisă fără rezultat confirmat</b> ({new Date(plan.creat_la).toLocaleString('ro-RO')}).
      <div style={{ color:G.muted, marginTop:4 }}>{descriere} La „Retrimite” se trimite exact aceeași cerere: dacă s-a înregistrat deja, nu se dublează.</div>
    </div>
  )
}

export default function ReturModal({ comanda, linie, G, S, bucket, caleFisierPv, actions, onClose, onDone }) {
  const idPlan = ID_PLAN.retur(linie.id)
  const [pending, setPending] = useState(() => actions.planNeconfirmat(idPlan))
  const cheie = useRef(cheieFereastra()).current
  const [cant, setCant] = useState('')
  const [din, setDin] = useState('')
  const [loc, setLoc] = useState(() => locatieImplicita(comanda))
  const [motiv, setMotiv] = useState('')
  const [asteapta, setAsteapta] = useState(true)
  const [pv, setPv] = useState(null)
  const pvIncarcat = useRef({ file: null, path: null })
  const [stoc, setStoc] = useState({ incarcat: false, eroare: '', val: {} })
  const [busy, setBusy] = useState(false)
  const [mesaj, setMesaj] = useState('')
  const locatii = locatiiRetur(comanda)
  const um = linie.um || ''

  // L24: rezultatul citirii se aplică doar dacă fereastra e încă pe aceeași linie / comandă
  useEffect(() => {
    let anulat = false
    setStoc({ incarcat: false, eroare: '', val: {} })
    ;(async () => {
      try {
        const val = {}
        for (const l of locatiiRetur(comanda)) val[l.cheie] = await citesteStoc(l, linie.denumire)
        if (!anulat) setStoc({ incarcat: true, eroare: '', val })
      } catch (e) {
        if (!anulat) setStoc({ incarcat: true, eroare: 'Stocul nu s-a putut citi (' + (e.message || e) + ') — verificarea se face oricum la înregistrare.', val: {} })
      }
    })()
    return () => { anulat = true }
  }, [comanda.id, comanda.proiect_id, linie.id, linie.denumire])

  const p = primitaEfectivaMii(linie, comanda)
  const i = intrataMii(linie)
  const lim = cant.trim() ? limiteDinStoc(linie, cant, comanda) : null
  const stocAles = stoc.val[loc]
  const stocMii = typeof stocAles === 'number' ? stocAles : null
  const dinEfectiv = lim && !lim.eroare ? (din.trim() ? laMii(din) : lim.implicitMii) : null
  const parametri = (pvPath) => ({ linie, comanda, cantitate: cant, dinStoc: din, locatie: loc, motiv, pvPath, asteaptaInlocuire: asteapta,
    cheie: cheie.get(), stocLocatieMii: stocMii })

  const trimite = async () => {
    setBusy(true); setMesaj('')
    try {
      let pvPath = null
      if (!actions.planNeconfirmat(idPlan)) {
        const proba = planRetur(parametri(pv ? 'proba' : null))
        if (proba.eroare) { setMesaj(proba.eroare); return }
        if (pv) {
          if (pvIncarcat.current.file === pv && pvIncarcat.current.path) pvPath = pvIncarcat.current.path
          else {
            const ext = (pv.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
            const cale = caleFisierPv(ext)
            const { error: eUp } = await supabase.storage.from(bucket).upload(cale, pv, { contentType: pv.type || undefined, upsert: false })
            if (eUp) { setMesaj('PV-ul nu s-a putut încărca: ' + (eUp.message || eUp) + ' — nu s-a înregistrat nimic.'); return }
            pvIncarcat.current = { file: pv, path: cale }
            pvPath = cale
          }
        }
      }
      const rez = await actions.executaCF(idPlan, () => planRetur(parametri(pvPath)))
      if (rez.stare === 'ok') {
        const r = rez.rezultate?.[0] || {}
        onDone(`↩️ Retur înregistrat pe „${linie.denumire}”${r.din_stoc != null ? ` — din stoc ${fmtMii(laMii(Number(r.din_stoc)))} ${um}` : ''}${rez.reluat ? ' (cererea anterioară, confirmată acum)' : ''}.`)
        return
      }
      setPending(actions.planNeconfirmat(idPlan))
      setMesaj(rez.mesaj || 'Nimic de trimis.')
    } finally { setBusy(false) }
  }

  const blocat = !!pending || busy
  const lbl = { fontSize:12, color:G.muted, marginBottom:4, display:'block', fontWeight:600 }
  const argsPending = pending?.pasi?.[0]?.args
  return (
    <Fereastra G={G} S={S} titlu={`↩️ Retur la furnizor — ${linie.denumire}`} onClose={busy ? () => {} : onClose}>
      <div style={{ fontSize:13, color:G.muted, marginBottom:12 }}>
        Comanda {comanda.numar_comanda} · primit efectiv <b style={{ color:G.text }}>{fmtMii(p)} {um}</b> · intrat în stoc <b style={{ color:G.text }}>{fmtMii(i)} {um}</b>
        <div>Maxim returnabil: <b style={{ color:G.text }}>{fmtMii(p)} {um}</b>. Nu se trimite nimic furnizorului; documentul de retur îl atașați aici.</div>
      </div>
      <BandaNeconfirmata G={G} plan={pending} descriere={argsPending ? `Retur ${argsPending.p_cantitate} ${um}, din stoc ${argsPending.p_din_stoc ?? 'implicit'}, motiv „${argsPending.p_motiv}”.` : ''} />
      {!pending && <>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <label><span style={lbl}>Cantitate returnată ({um})</span>
            <input type="number" min="0" step="any" value={cant} disabled={blocat} onChange={e => setCant(e.target.value)} style={S.input} /></label>
          <label><span style={lbl}>Din stoc ({um}) — gol = {lim && !lim.eroare ? fmtMii(lim.implicitMii) : 'maximul'}</span>
            <input type="number" min="0" step="any" value={din} disabled={blocat || !lim || !!lim.eroare} onChange={e => setDin(e.target.value)} style={S.input} /></label>
        </div>
        {lim && !lim.eroare && <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>
          Din stoc: între {fmtMii(lim.minMii)} și {fmtMii(lim.maxMii)} {um}. Restul ({fmtMii(lim.cantitateMii - (dinEfectiv ?? lim.implicitMii))} {um}) vine din marfa primită, dar neintrată în stoc.
        </div>}
        {lim?.eroare && <div style={{ fontSize:12, color:G.red, marginTop:6 }}>{lim.eroare}</div>}
        <div style={{ marginTop:10 }}>
          <span style={lbl}>Din ce locație iese</span>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {locatii.map(l => {
              const v = stoc.val[l.cheie]
              return (
                <button key={l.cheie} disabled={blocat} onClick={() => setLoc(l.cheie)}
                  style={{ ...S.btnS, fontSize:13, padding:'8px 12px', borderColor: loc === l.cheie ? G.blue : G.border2, color: loc === l.cheie ? G.blue : G.text }}>
                  {l.eticheta} · {!stoc.incarcat ? '…' : v === 'ambiguu' ? '⚠️ poziție dublată' : typeof v === 'number' ? `stoc ${fmtMii(v)} ${um}` : 'stoc necunoscut'}
                </button>
              )
            })}
          </div>
          {stoc.eroare && <div style={{ fontSize:12, color:G.orange, marginTop:6 }}>{stoc.eroare}</div>}
          {dinEfectiv > 0 && stocMii !== null && dinEfectiv > stocMii && <div style={{ fontSize:12, color:G.red, marginTop:6 }}>În locația aleasă sunt doar {fmtMii(stocMii)} {um}.</div>}
        </div>
        <label style={{ display:'block', marginTop:10 }}><span style={lbl}>Motiv (minim 5 caractere)</span>
          <textarea value={motiv} disabled={blocat} onChange={e => setMotiv(e.target.value)} style={{ ...S.input, minHeight:60 }} placeholder="ex. neconform la recepție, abatere dimensională" /></label>
        <div style={{ display:'flex', gap:16, alignItems:'center', marginTop:10, flexWrap:'wrap' }}>
          <label style={{ fontSize:13, display:'flex', gap:6, alignItems:'center' }}>
            <input type="checkbox" checked={asteapta} disabled={blocat} onChange={e => setAsteapta(e.target.checked)} /> Așteptăm înlocuire de la furnizor</label>
          <label style={{ fontSize:13 }}>PV / poză retur (opțional) <input type="file" accept="application/pdf,image/*" disabled={blocat} onChange={e => setPv(e.target.files?.[0] || null)} /></label>
        </div>
      </>}
      {mesaj && <div style={{ fontSize:13, color: pending ? G.yellow : G.red, marginTop:12, whiteSpace:'pre-line' }}>{mesaj}</div>}
      <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:16 }}>
        <button onClick={onClose} disabled={busy} style={{ ...S.btnS, fontSize:14 }}>Închide</button>
        <button onClick={trimite} disabled={busy || (!pending && (!lim || !!lim.eroare))}
          style={{ ...S.btnP, background:G.red, color:'#0D1117', fontSize:14, opacity: busy ? .6 : 1 }}>
          {busy ? '⏳ Se înregistrează...' : pending ? '🔁 Retrimite aceeași cerere' : '↩️ Înregistrează returul'}
        </button>
      </div>
    </Fereastra>
  )
}

// Reconcilierea manuală a unei linii vechi (owner): câte din marfa liniei a intrat deja în stoc prin mișcările vechi (legate doar de comandă)
export function ReconciliereModal({ comanda, linie, G, S, actions, onClose, onDone }) {
  const idPlan = ID_PLAN.reconciliere(linie.id)
  const [pending, setPending] = useState(() => actions.planNeconfirmat(idPlan))
  const cheie = useRef(cheieFereastra()).current
  const [val, setVal] = useState('')
  const [motiv, setMotiv] = useState('')
  const [indiciu, setIndiciu] = useState({ incarcat: false, eroare: '', sumaMii: null, n: 0 })
  const [busy, setBusy] = useState(false)
  const [mesaj, setMesaj] = useState('')
  const um = linie.um || ''
  const p = primitaEfectivaMii(linie, comanda)

  // indiciu: intrările vechi ale comenzii pe denumirea EXACTĂ a liniei (alte linii cu aceeași denumire le împart — de aceea decide omul)
  useEffect(() => {
    let anulat = false
    ;(async () => {
      const { data, error } = await supabase.from('stocuri_miscari').select('id, delta, material_denumire')
        .eq('tip', 'intrare_achizitie').eq('ref_tip', 'comanda_furnizor').eq('ref_id', comanda.id).eq('material_denumire', linie.denumire)
      if (anulat) return
      if (error) { setIndiciu({ incarcat: true, eroare: error.message || String(error), sumaMii: null, n: 0 }); return }
      const suma = (data || []).reduce((a, m) => a + (laMii(Number(m.delta)) || 0), 0)
      setIndiciu({ incarcat: true, eroare: '', sumaMii: suma, n: (data || []).length })
    })()
    return () => { anulat = true }
  }, [comanda.id, linie.id, linie.denumire])

  const trimite = async () => {
    setBusy(true); setMesaj('')
    try {
      const rez = await actions.executaCF(idPlan, () => planReconciliere({ linie, comanda, intrataStoc: val, motiv, cheie: cheie.get() }))
      if (rez.stare === 'ok') { onDone(`✅ „${linie.denumire}” reconciliată${rez.reluat ? ' (cererea anterioară, confirmată acum)' : ''}.`); return }
      setPending(actions.planNeconfirmat(idPlan))
      setMesaj(rez.mesaj || 'Nimic de trimis.')
    } finally { setBusy(false) }
  }
  const lbl = { fontSize:12, color:G.muted, marginBottom:4, display:'block', fontWeight:600 }
  return (
    <Fereastra G={G} S={S} titlu={`⚠️ Reconciliere — ${linie.denumire}`} onClose={busy ? () => {} : onClose}>
      <div style={{ fontSize:13, color:G.muted, marginBottom:10 }}>
        Recepție veche: intrările în stoc sunt legate doar de comandă, nu de reper. Stabiliți cât din <b style={{ color:G.text }}>{fmtMii(p)} {um}</b> primite
        a intrat deja în stoc. După reconciliere, predarea, returul și corectura funcționează pe reper.
      </div>
      <div style={{ fontSize:12, color:G.muted, marginBottom:10 }}>
        {!indiciu.incarcat ? 'Se citesc intrările vechi…' : indiciu.eroare ? `Intrările vechi nu s-au putut citi: ${indiciu.eroare}`
          : `Intrări vechi pe comandă cu denumirea exactă a reperului: ${fmtMii(indiciu.sumaMii)} ${um} (${indiciu.n} mișcări). Dacă mai multe repere au aceeași denumire, suma se împarte între ele.`}
      </div>
      <BandaNeconfirmata G={G} plan={pending} descriere={pending ? `Intrat în stoc ${pending.pasi?.[0]?.args?.p_intrata_stoc} ${um}.` : ''} />
      {!pending && <>
        <label><span style={lbl}>Intrat deja în stoc ({um})</span>
          <input type="number" min="0" step="any" value={val} disabled={busy} onChange={e => setVal(e.target.value)} style={S.input} /></label>
        <label style={{ display:'block', marginTop:10 }}><span style={lbl}>Motiv (minim 5 caractere)</span>
          <textarea value={motiv} disabled={busy} onChange={e => setMotiv(e.target.value)} style={{ ...S.input, minHeight:50 }} placeholder="ex. verificat fizic în magazie" /></label>
      </>}
      {mesaj && <div style={{ fontSize:13, color: pending ? G.yellow : G.red, marginTop:12 }}>{mesaj}</div>}
      <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:16 }}>
        <button onClick={onClose} disabled={busy} style={{ ...S.btnS, fontSize:14 }}>Închide</button>
        <button onClick={trimite} disabled={busy} style={{ ...S.btnP, background:G.orange, color:'#0D1117', fontSize:14, opacity: busy ? .6 : 1 }}>
          {busy ? '⏳ Se salvează...' : pending ? '🔁 Retrimite aceeași cerere' : '💾 Reconciliază'}
        </button>
      </div>
    </Fereastra>
  )
}
