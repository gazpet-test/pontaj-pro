// ════════════════════════════════════════════════════════════════
// Execuție → dashboard proiect → Echipă: legătura cu registrul deciziilor HR (spec §7, PR3; C10, VA9).
// Cardurile de rol se leagă de decizii pe tip_cod (RTE, RTS, MP, SEF_SANTIER), NU pe camp_efect.
// Citirea trece prin RLS (exec vede deciziile de numire pe proiect); butoanele apar doar cu fn_hr_decizii_poate('emitere').
// Generatorul se încarcă leneș (jspdf/html2canvas nu intră în chunk-ul Execuție decât la nevoie).
// ════════════════════════════════════════════════════════════════
import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { nrAfisat as nrAfis, stareRol as stareRolPur } from './hrDeciziiUtil.js'

const HrDeciziiGenerator = lazy(() => import('./HrDeciziiGenerator.jsx'))

export const TIP_ROL = { mp_employee_id: 'MP', rte_employee_id: 'RTE', rts_employee_id: 'RTS', sef_santier_employee_id: 'SEF_SANTIER' }
const EXTINSA = { CTC_QC: 'CTC / CQ', INSPECTOR_SSM: 'Inspector SSM', COORDONATOR_SSM: 'Coordonator SSM', PSI: 'PSI / SU', MEDIU: 'Mediu', RESPONSABIL_DESEURI: 'Deșeuri', RTE_MEC: 'RTE MEC' }

const azi = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const inVigoare = d => !d.data_efect_pana || d.data_efect_pana >= azi()

/** Deciziile de numire ale proiectului (emise/semnate/revocate) + dreptul de emitere + numele persoanelor. */
export function useDeciziiProiect(proiectId, reloadKey) {
  const [st, setSt] = useState({ decizii: [], poateEmite: false, nume: {} })
  useEffect(() => {
    if (!proiectId) return
    let viu = true
    ;(async () => {
      const [rd, rp] = await Promise.all([
        supabase.from('hr_decizii').select('id, tip_cod, employee_id, persoana_nume, stare, serie, an, numar, numar_sufix, data_emitere, data_efect_pana, eticheta_functie, snapshot')
          .eq('proiect_id', proiectId).in('stare', ['emisa', 'semnata', 'revocata']).order('id', { ascending: false }),
        supabase.rpc('fn_hr_decizii_poate', { p_actiune: 'emitere' }),
      ])
      if (!viu) return
      const decizii = rd.error ? [] : (rd.data || [])
      const ids = [...new Set(decizii.map(d => d.employee_id).filter(Boolean))]
      let nume = {}
      if (ids.length) {
        const { data } = await supabase.from('employees').select('id, name').in('id', ids)
        nume = Object.fromEntries((data || []).map(e => [e.id, e.name]))
      }
      if (viu) setSt({ decizii, poateEmite: rp.data === true, nume })
    })()
    return () => { viu = false }
  }, [proiectId, reloadKey])
  return st
}

const CULOARE = { ok: '#2EA043', diferit: '#F0883E', nesemnata: '#D29922', revocata: '#F85149', lipsa: '#F0883E' }
export const stareRol = (tipCod, idEchipa, decizii, nume) => stareRolPur(tipCod, idEchipa, decizii, nume, azi())

export function EtichetaDecizie({ tipCod, idEchipa, decizii, nume, poateEmite, onGenereaza }) {
  const s = stareRol(tipCod, idEchipa, decizii, nume)
  if (!s && !poateEmite) return null
  return (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {s && <span style={{ fontSize: 10.5, fontWeight: 700, color: CULOARE[s.cod] }}>{s.t}</span>}
      {poateEmite && <button onClick={() => onGenereaza(tipCod, idEchipa)} title="Generează decizie de numire"
        style={{ padding: '2px 7px', fontSize: 10.5, background: 'transparent', color: '#EC6CB9', border: '1px solid #EC6CB966', borderRadius: 6, cursor: 'pointer' }}>📜 Generează decizie</button>}
    </div>
  )
}

/** „Echipă extinsă din decizii": CTC, SSM, PSI, Mediu, Deșeuri, MEC — doar decizii semnate/emise în vigoare. */
export function EchipaExtinsa({ decizii, nume }) {
  const r = Object.entries(EXTINSA).map(([cod, label]) => {
    const d = decizii.find(x => x.tip_cod === cod && x.stare === 'semnata' && inVigoare(x)) || decizii.find(x => x.tip_cod === cod && x.stare === 'emisa')
    return d ? { label, d } : null
  }).filter(Boolean)
  if (!r.length) return null
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 9, color: '#8B949E', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Echipă extinsă din decizii</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {r.map(({ label, d }) => (
          <span key={d.id} style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 6, background: '#161B22', border: '1px solid #30363D' }}>
            <b>{label}</b>: {d.snapshot?.persoana?.nume || nume[d.employee_id] || d.persoana_nume || '?'} · nr {nrAfis(d)}{d.stare === 'emisa' ? ' (nesemnată)' : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Generatorul, precompletat cu proiectul, rolul și persoana curentă. */
export function GeneratorProiect({ preset, onClose }) {
  if (!preset) return null
  return (
    <Suspense fallback={null}>
      <HrDeciziiGenerator initial={{ preset: 'proiect', ...preset }} onClose={onClose} showToast={() => {}} />
    </Suspense>
  )
}
