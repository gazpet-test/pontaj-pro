// Achiziții — retur la furnizor (TKT-2026-0347), PR2: istoricul retururilor pe comandă (retururi, anulări, înlocuiri, închideri — cine și
// când) + acțiunile pe un retur deschis: „Anulează returul” și „Închide fără înlocuire”, cu motiv. Scrierea = DOAR RPC-urile 20270110a.
import { useState, useRef } from 'react'
import { laMii, fmtMii, deInlocuitMii, planAnulareRetur, planInchidereRetur, cheieFereastra, ETICHETE_INCHIDERE } from '../achizitiiRetur.js'
import { BandaNeconfirmata } from './ReturModal.jsx'

function MotivModal({ fel, retur, G, S, actions, onClose, onDone }) {
  const anulare = fel === 'anulare'
  const idPlan = `${fel}:${retur.id}`
  const [pending, setPending] = useState(() => actions.planNeconfirmat(idPlan))
  const cheie = useRef(cheieFereastra()).current
  const [motiv, setMotiv] = useState('')
  const [busy, setBusy] = useState(false)
  const [mesaj, setMesaj] = useState('')
  const trimite = async () => {
    setBusy(true); setMesaj('')
    try {
      const constr = () => (anulare ? planAnulareRetur : planInchidereRetur)({ retur, motiv, cheie: cheie.get() })
      const rez = await actions.executaCF(idPlan, constr)
      if (rez.stare === 'ok') {
        onDone(anulare ? `⛔ Returul pe „${retur.denumire}” a fost anulat; cantitatea s-a pus la loc.` : `🚫 Returul pe „${retur.denumire}” s-a închis fără înlocuire.`)
        return
      }
      setPending(actions.planNeconfirmat(idPlan))
      setMesaj(rez.mesaj || 'Nimic de trimis.')
    } finally { setBusy(false) }
  }
  const titlu = anulare ? 'Anulează returul' : 'Închide fără înlocuire'
  return (
    <div role="dialog" aria-modal="true" aria-label={titlu} style={{ position:'fixed', inset:0, zIndex:1100, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={busy ? undefined : onClose}>
      <div style={{ ...S.card, width:'min(520px,100%)', padding:18 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight:800, marginBottom:6 }}>{titlu} — {retur.denumire} ({fmtMii(laMii(Number(retur.cantitate)))} {retur.um || ''})</div>
        <div style={{ fontSize:12, color:G.muted, marginBottom:10 }}>
          {anulare
            ? `Pune la loc cantitatea primită${Number(retur.din_stoc) > 0 ? ` și ${fmtMii(laMii(Number(retur.din_stoc)))} ${retur.um || ''} în stocul din care a ieșit` : ''}. Se poate o singură dată și doar înainte de orice înlocuire.`
            : 'Restul neînlocuit nu mai e așteptat de la furnizor. Decizia rămâne și după corecturi de recepție.'}
        </div>
        <BandaNeconfirmata G={G} plan={pending} descriere={pending ? `Motiv „${pending.pasi?.[0]?.args?.p_motiv}”.` : ''} />
        {!pending && <label>Motiv (minimum 5 caractere)<textarea autoFocus value={motiv} disabled={busy} onChange={e => setMotiv(e.target.value)} style={{ ...S.input, marginTop:8, minHeight:60 }} /></label>}
        {mesaj && <div style={{ fontSize:13, color: pending ? G.yellow : G.red, marginTop:10 }}>{mesaj}</div>}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
          <button onClick={onClose} disabled={busy} style={{ ...S.btnS, fontSize:14 }}>Renunță</button>
          <button onClick={trimite} disabled={busy || (!pending && motiv.trim().length < 5)}
            style={{ ...S.btnP, background: anulare ? G.red : G.orange, color:'#0D1117', fontSize:14, opacity: busy ? .6 : 1 }}>
            {busy ? '⏳ Se salvează...' : pending ? '🔁 Retrimite aceeași cerere' : 'Confirmă'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReturIstoric({ retururi, poateScrie, profilesMap, fmtDataOra, openStorageFile, G, S, actions, onDone }) {
  const [actiune, setActiune] = useState(null)
  const anulari = new Map((retururi || []).filter(r => r.tip === 'anulare').map(r => [r.retur_id, r]))
  const lista = (retururi || []).filter(r => r.tip === 'retur').slice().sort((a, b) => b.id - a.id)
  if (!lista.length) return null
  const cine = (uid) => profilesMap?.[uid] || '—'
  return (
    <div style={{ marginTop:14, padding:14, background:G.bg, borderRadius:10, border:`1px solid ${G.red}44` }}>
      <div style={{ fontSize:13, fontWeight:800, color:G.red, marginBottom:8 }}>↩️ Retururi la furnizor ({lista.length})</div>
      {lista.map(r => {
        const an = anulari.get(r.id)
        const deInl = deInlocuitMii(r)
        const um = r.um || ''
        const deschis = !r.inchis_fel && !an
        return (
          <div key={r.id} style={{ padding:'8px 0', borderTop:`1px solid ${G.border}`, fontSize:13 }}>
            <div style={{ display:'flex', gap:10, alignItems:'baseline', flexWrap:'wrap' }}>
              <b>{r.denumire}</b>
              <span>−{fmtMii(laMii(Number(r.cantitate)))} {um}</span>
              <span style={{ color:G.muted, fontSize:12 }}>
                {Number(r.din_stoc) > 0 ? `din stoc ${fmtMii(laMii(Number(r.din_stoc)))} (${r.locatie_tip === 'sediu' ? 'sediu' : 'proiect'})` : 'din marfa neintrată în stoc'}
              </span>
              <span style={{ color:G.dim, fontSize:12 }}>{fmtDataOra(r.creat_la)} · {cine(r.creat_de)}</span>
              {r.inchis_fel && <span style={{ fontSize:12, fontWeight:700, color: r.inchis_fel === 'acoperit' ? G.green : G.muted }}>{ETICHETE_INCHIDERE[r.inchis_fel] || r.inchis_fel} · {fmtDataOra(r.inchis_la)}</span>}
              {deInl > 0 && <span style={{ fontSize:12, fontWeight:700, color:G.orange }}>⏳ de înlocuit {fmtMii(deInl)} {um}</span>}
            </div>
            <div style={{ fontSize:12, color:G.muted }}>
              Motiv: {r.motiv}
              {Number(r.cantitate_inlocuita) > 0 && <> · înlocuit {fmtMii(laMii(Number(r.cantitate_inlocuita)))} {um}</>}
              {Number(r.cantitate_renuntata) > 0 && <> · renunțat {fmtMii(laMii(Number(r.cantitate_renuntata)))} {um}</>}
              {r.inchis_motiv && r.inchis_fel !== 'anulat' && <> · închidere: {r.inchis_motiv}</>}
              {an && <> · anulat de {cine(an.creat_de)} la {fmtDataOra(an.creat_la)}: {an.motiv}</>}
              {r.pv_retur_path && <> · <button onClick={() => openStorageFile(r.pv_retur_path)} style={{ background:'none', border:'none', color:G.blue, cursor:'pointer', padding:0, fontSize:12 }}>📄 PV retur</button></>}
            </div>
            {poateScrie && deschis && (
              <div style={{ display:'flex', gap:8, marginTop:6 }}>
                {!(Number(r.cantitate_inlocuita) > 0) && <button onClick={() => setActiune({ fel:'anulare', retur:r })} style={{ ...S.btnS, fontSize:12, padding:'5px 10px', color:G.red, borderColor:G.red + '66' }}>⛔ Anulează returul</button>}
                {r.asteapta_inlocuire && <button onClick={() => setActiune({ fel:'inchidere', retur:r })} style={{ ...S.btnS, fontSize:12, padding:'5px 10px', color:G.orange, borderColor:G.orange + '66' }}>🚫 Închide fără înlocuire</button>}
              </div>
            )}
          </div>
        )
      })}
      {actiune && <MotivModal fel={actiune.fel} retur={actiune.retur} G={G} S={S} actions={actions} onClose={() => setActiune(null)}
        onDone={(txt) => { setActiune(null); onDone(txt) }} />}
    </div>
  )
}
