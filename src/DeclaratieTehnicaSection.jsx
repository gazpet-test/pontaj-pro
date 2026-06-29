// ═══════════════════════════════════════════════════════════════════════════
// DeclaratieTehnicaSection.jsx — v1 (29.06.2026)
// Declarație de conformitate tehnică generală (separată de cea de supape).
// Gating diferențiat pe clasa utilajului:
//   - auto (Autoturism/Autoutilitară/Camion/Cap tractor): service la zi + ITP + RCA + Rovinietă
//   - tractat (Remorcă/Semiremorcă/Trailer/Rulotă): ITP + RCA
//   - utilaj: service la zi (+ autorizație ISCIR dacă e marcat necesita_iscir)
//   - container: nu primește declarație
// "Service la zi" = nicio scadență service depășită (nivel critic în v_logistica_alerte_globale).
// Sursa de adevăr a gating-ului: view v_declaratie_tehnica_status.
// Snapshot îngheţat la emitere în logistica_declaratii (tip='tehnica').
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const BUCKET = 'documente-flota'
const SEMNATAR = { id: 71, nume: 'MITRACHE ALEXANDRU', functie: 'Director Departament Logistică', prefix: 'ing.' }
const SERVICE_FALLBACK_ZILE = 180  // valabilitate declarație pt utilaje doar cu service (fără documente cu dată)

const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

const CLASA_LABEL = {
  auto: '🚗 Autovehicul',
  tractat: '🚛 Vehicul tractat',
  utilaj: '🏗️ Utilaj',
  container: '📦 Container',
}

// Cerințele aplicabile clasei + statusul lor
function cerinteAplicabile(st) {
  if (!st) return []
  const arr = []
  const add = (key, label, ok, exp) => arr.push({ key, label, ok: !!ok, exp: exp || null })
  if (st.clasa === 'auto') {
    add('service', 'Service la zi', st.service_ok)
    add('itp', 'ITP', st.itp_ok, st.itp_exp)
    add('rca', 'Asigurare RCA', st.rca_ok, st.rca_exp)
    add('rovinieta', 'Rovinietă', st.rovinieta_ok, st.rovinieta_exp)
  } else if (st.clasa === 'tractat') {
    add('itp', 'ITP', st.itp_ok, st.itp_exp)
    add('rca', 'Asigurare RCA', st.rca_ok, st.rca_exp)
  } else if (st.clasa === 'utilaj') {
    add('service', 'Service la zi', st.service_ok)
    if (st.necesita_iscir) add('iscir', 'Autorizație ISCIR', st.iscir_ok, st.iscir_exp)
  }
  return arr
}

async function fetchSignatureDataURL(employeeId) {
  try {
    const { data: sig } = await supabase.from('hr_semnaturi_electronice').select('fisier_path').eq('employee_id', employeeId).eq('activ', true).maybeSingle()
    if (!sig?.fisier_path) return null
    const { data: signed } = await supabase.storage.from('hr-semnaturi').createSignedUrl(sig.fisier_path, 120)
    if (!signed?.signedUrl) return null
    const blob = await (await fetch(signed.signedUrl)).blob()
    return await new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob) })
  } catch { return null }
}

export default function DeclaratieTehnicaSection({ activ, canEdit, showToast }) {
  const [status, setStatus] = useState(null)
  const [declaratii, setDeclaratii] = useState([])
  const [necesitaIscir, setNecesitaIscir] = useState(!!activ?.necesita_iscir)
  const [loading, setLoading] = useState(true)
  const [genBusy, setGenBusy] = useState(false)

  const load = useCallback(async () => {
    if (!activ?.id) return
    setLoading(true)
    const [rSt, rDecl] = await Promise.all([
      supabase.from('v_declaratie_tehnica_status').select('*').eq('activ_id', activ.id).maybeSingle(),
      supabase.from('logistica_declaratii').select('*').eq('activ_id', activ.id).eq('tip', 'tehnica').order('generat_la', { ascending: false }),
    ])
    setStatus(rSt.data || null)
    setDeclaratii(rDecl.data || [])
    if (rSt.data) setNecesitaIscir(!!rSt.data.necesita_iscir)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activ?.id])

  useEffect(() => { load() }, [load])

  const saveIscir = async (val) => {
    setNecesitaIscir(val)
    const { error } = await supabase.from('logistica_active').update({ necesita_iscir: val }).eq('id', activ.id)
    if (error) { showToast?.('Eroare la salvarea flag-ului ISCIR', 'error'); return }
    await load()
  }

  const veziPDF = async (path) => {
    if (!path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
    if (error || !data?.signedUrl) { showToast?.('Nu pot deschide documentul', 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  const genereazaDeclaratie = async () => {
    if (!status?.poate_emite_declaratie) return
    setGenBusy(true)
    try {
      const cerinte = cerinteAplicabile(status)
      // valabilitate = cea mai apropiată scadență dintre documentele aplicabile; fallback +180z dacă doar service
      const expDates = cerinte.map(c => c.exp).filter(Boolean)
      let dataValab = expDates.length ? expDates.reduce((m, e) => (!m || e < m) ? e : m, null) : null
      if (!dataValab) {
        const d = new Date(); d.setDate(d.getDate() + SERVICE_FALLBACK_ZILE); dataValab = d.toISOString().slice(0, 10)
      }
      const conditiiSnapshot = { clasa: status.clasa, cerinte: cerinte.map(c => ({ key: c.key, label: c.label, ok: c.ok, exp: c.exp })) }
      const utilajSnapshot = {
        marca: activ.marca, model: activ.model, nr_inmatriculare: activ.nr_inmatriculare,
        serie: activ.serie || activ.serie_sasiu, cod_intern: activ.cod_intern,
        an: activ.an_fabricatie, ore: activ.ore_functionare_actuale, km: activ.km_actuali,
      }
      const an = new Date().getFullYear()
      const { count } = await supabase.from('logistica_declaratii').select('id', { count: 'exact', head: true }).eq('tip', 'tehnica').gte('data_emitere', `${an}-01-01`)
      const numar = `DT-${String((count || 0) + 1).padStart(3, '0')}/${an}`
      const dataEmitere = new Date().toISOString().slice(0, 10)

      const semnaturaImg = await fetchSignatureDataURL(SEMNATAR.id)
      const blob = await construiestePDF({ numar, dataEmitere, dataValab, clasa: status.clasa, utilajSnapshot, cerinte, semnaturaImg })

      const path = `${activ.id}/declaratii/DT_${numar.replace(/\//g, '-')}_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw upErr

      const { data: { user } } = await supabase.auth.getUser()
      const { error: insErr } = await supabase.from('logistica_declaratii').insert({
        activ_id: activ.id, tip: 'tehnica', numar, data_emitere: dataEmitere, data_valabilitate: dataValab,
        conditii_snapshot: conditiiSnapshot, utilaj_snapshot: utilajSnapshot,
        semnatar_nume: `${SEMNATAR.prefix} ${SEMNATAR.nume}`, semnatar_functie: SEMNATAR.functie,
        pdf_path: path, pdf_nume: `Declaratie_tehnica_${numar.replace(/\//g, '-')}.pdf`,
        generat_de: user?.id || null,
      })
      if (insErr) throw insErr

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `Declaratie_tehnica_${numar.replace(/\//g, '-')}.pdf`; a.click()
      URL.revokeObjectURL(url)
      showToast?.(`Declarație ${numar} generată și arhivată`, 'success')
      await load()
    } catch (e) {
      showToast?.('Eroare generare: ' + (e.message || e), 'error')
    } finally { setGenBusy(false) }
  }

  if (!activ?.id) return null
  if (loading) return null
  if (status?.clasa === 'container') return null  // containerele nu primesc declarație tehnică

  const cerinte = cerinteAplicabile(status)
  const lipsuri = cerinte.filter(c => !c.ok)

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>
        📋 Declarație conformitate tehnică
      </div>

      <div style={{ ...S.card, padding: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 12.5, color: G.muted }}>
            Clasă: <strong style={{ color: G.text }}>{CLASA_LABEL[status?.clasa] || status?.clasa}</strong>
            {status?.cat_tip && <span style={{ color: G.dim }}> · {status.cat_tip}</span>}
          </span>
          {status?.clasa === 'utilaj' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: G.text, cursor: canEdit ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={necesitaIscir} disabled={!canEdit} onChange={e => saveIscir(e.target.checked)} style={{ width: 15, height: 15, accentColor: G.purple }} />
              🏗️ Utilaj ISCIR (necesită autorizație de ridicare)
            </label>
          )}
        </div>

        {/* Checklist cerințe */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {cerinte.map(c => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <span style={{ fontSize: 14 }}>{c.ok ? '✅' : '❌'}</span>
              <span style={{ color: c.ok ? G.text : G.red, fontWeight: 600 }}>{c.label}</span>
              {c.exp && <span style={{ color: daysUntil(c.exp) < 0 ? G.red : G.muted, fontSize: 11 }}>· valabil până {fmtDate(c.exp)}</span>}
              {!c.ok && !c.exp && <span style={{ color: G.red, fontSize: 11 }}>· {c.key === 'service' ? 'scadență depășită' : 'lipsă / expirat'}</span>}
            </div>
          ))}
        </div>

        <div style={{
          padding: '10px 12px', borderRadius: 8,
          background: status?.poate_emite_declaratie ? G.greenDim + 'aa' : G.bg,
          border: `1px solid ${status?.poate_emite_declaratie ? G.green + '55' : G.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 12.5, color: G.text }}>
            {status?.poate_emite_declaratie
              ? <span style={{ color: G.green, fontWeight: 700 }}>✓ Toate condițiile îndeplinite</span>
              : <span style={{ color: G.orange }}>Blocat: {lipsuri.map(l => l.label).join(', ')}</span>}
          </div>
          <button
            onClick={genereazaDeclaratie}
            disabled={!status?.poate_emite_declaratie || genBusy || !canEdit}
            title={status?.poate_emite_declaratie ? 'Generează declarația tehnică' : 'Necesită toate condițiile îndeplinite'}
            style={{
              ...S.btnP,
              background: status?.poate_emite_declaratie ? G.green : G.border,
              color: status?.poate_emite_declaratie ? '#0D1117' : G.dim,
              cursor: (status?.poate_emite_declaratie && canEdit && !genBusy) ? 'pointer' : 'not-allowed',
              opacity: (status?.poate_emite_declaratie && canEdit) ? 1 : .7,
            }}>
            {genBusy ? 'Se generează…' : '📄 Generează declarație'}
          </button>
        </div>
      </div>

      {/* Arhivă */}
      {declaratii.length > 0 && (
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${G.border}` }}>
            <span style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>📜 Declarații tehnice emise ({declaratii.length})</span>
          </div>
          {declaratii.map((d, idx) => {
            const exp = daysUntil(d.data_valabilitate)
            const expColor = exp === null ? G.muted : exp < 0 ? G.red : exp <= 30 ? G.orange : G.green
            return (
              <div key={d.id} style={{ padding: '10px 14px', borderBottom: idx < declaratii.length - 1 ? `1px solid ${G.border}` : 'none', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, color: G.text, fontSize: 13 }}>Declarație {d.numar}</div>
                  <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>
                    emisă {fmtDate(d.data_emitere)}
                    {d.data_valabilitate && <> · valabilă până <strong style={{ color: expColor }}>{fmtDate(d.data_valabilitate)}{exp < 0 ? ' (EXPIRATĂ)' : ''}</strong></>}
                  </div>
                </div>
                {d.pdf_path && <button onClick={() => veziPDF(d.pdf_path)} style={{ ...S.btnS, padding: '6px 12px', fontSize: 12, color: G.blue, borderColor: G.blue + '55' }}>📄 Vezi PDF</button>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── PDF declarație tehnică (HTML offscreen → html2canvas → jsPDF A4) ──
async function construiestePDF({ numar, dataEmitere, dataValab, clasa, utilajSnapshot, cerinte, semnaturaImg }) {
  const fmt = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const utilajNume = [utilajSnapshot.marca, utilajSnapshot.model].filter(Boolean).join(' ') || utilajSnapshot.cod_intern || '—';
  const esteAuto = clasa === 'auto' || clasa === 'tractat';

  const randuri = cerinte.map(c => `
    <tr>
      <td style="border:1px solid #999;padding:6px 8px;">${c.label}</td>
      <td style="border:1px solid #999;padding:6px 8px;text-align:center;font-weight:bold;color:${c.ok ? '#197a2e' : '#b32020'};">${c.ok ? 'CONFORM' : 'NECONFORM'}</td>
      <td style="border:1px solid #999;padding:6px 8px;text-align:center;">${c.exp ? 'valabil până ' + fmt(c.exp) : (c.ok ? 'la zi' : '—')}</td>
    </tr>`).join('');

  const introCerinte = clasa === 'auto'
    ? 'starea de service, inspecția tehnică periodică (ITP), asigurarea de răspundere civilă (RCA) și rovinieta'
    : clasa === 'tractat'
      ? 'inspecția tehnică periodică (ITP) și asigurarea de răspundere civilă (RCA)'
      : cerinte.some(c => c.key === 'iscir')
        ? 'starea de service și autorizația ISCIR de funcționare'
        : 'starea de service și mentenanță';

  const html = `
    <div style="width:738px;padding:28px;background:#fff;color:#111;font-family:'Times New Roman',serif;font-size:13px;line-height:1.5;box-sizing:border-box;">
      <div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid #E3B341;padding-bottom:12px;margin-bottom:18px;">
        <img src="${LOGO_B64}" style="height:54px;" />
        <div>
          <div style="font-size:18px;font-weight:bold;">S.C. GAZPET INSTAL S.R.L.</div>
          <div style="font-size:11px;color:#444;">Ploiești · CUI RO13038090</div>
        </div>
        <div style="margin-left:auto;text-align:right;font-size:11px;color:#444;">
          Nr. <strong>${numar}</strong><br/>Data: ${fmt(dataEmitere)}
        </div>
      </div>

      <div style="text-align:center;font-size:18px;font-weight:bold;letter-spacing:.5px;margin-bottom:4px;">DECLARAȚIE DE CONFORMITATE TEHNICĂ</div>
      <div style="text-align:center;font-size:12px;color:#555;margin-bottom:20px;">privind starea tehnică și utilizarea în siguranță a ${esteAuto ? 'vehiculului' : 'utilajului'}</div>

      <p style="margin:0 0 12px 0;">
        Subscrisa <strong>S.C. GAZPET INSTAL S.R.L.</strong>, în calitate de deținător al ${esteAuto ? 'vehiculului' : 'utilajului'} identificat mai jos,
        declarăm pe propria răspundere că acesta îndeplinește condițiile privind ${introCerinte}:
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12.5px;">
        <tr><td style="padding:3px 6px;width:42%;color:#555;">${esteAuto ? 'Vehicul' : 'Echipament'}</td><td style="padding:3px 6px;font-weight:bold;">${utilajNume}</td></tr>
        ${utilajSnapshot.nr_inmatriculare ? `<tr><td style="padding:3px 6px;color:#555;">Nr. înmatriculare</td><td style="padding:3px 6px;font-weight:bold;">${utilajSnapshot.nr_inmatriculare}</td></tr>` : ''}
        ${utilajSnapshot.serie ? `<tr><td style="padding:3px 6px;color:#555;">Serie / nr. identificare</td><td style="padding:3px 6px;">${utilajSnapshot.serie}</td></tr>` : ''}
        ${utilajSnapshot.cod_intern ? `<tr><td style="padding:3px 6px;color:#555;">Cod intern</td><td style="padding:3px 6px;">${utilajSnapshot.cod_intern}</td></tr>` : ''}
        ${utilajSnapshot.an ? `<tr><td style="padding:3px 6px;color:#555;">An fabricație</td><td style="padding:3px 6px;">${utilajSnapshot.an}</td></tr>` : ''}
        ${utilajSnapshot.km ? `<tr><td style="padding:3px 6px;color:#555;">Kilometraj</td><td style="padding:3px 6px;">${Number(utilajSnapshot.km).toLocaleString('ro-RO')} km</td></tr>` : ''}
        ${utilajSnapshot.ore ? `<tr><td style="padding:3px 6px;color:#555;">Ore funcționare</td><td style="padding:3px 6px;">${Number(utilajSnapshot.ore).toLocaleString('ro-RO')} ore</td></tr>` : ''}
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;">
        <thead>
          <tr style="background:#f0e6c8;">
            <th style="border:1px solid #999;padding:6px 8px;text-align:left;">Condiție verificată</th>
            <th style="border:1px solid #999;padding:6px 8px;">Stare</th>
            <th style="border:1px solid #999;padding:6px 8px;">Valabilitate</th>
          </tr>
        </thead>
        <tbody>${randuri}</tbody>
      </table>

      <p style="margin:0 0 12px 0;">
        În urma verificărilor efectuate, declarăm că ${esteAuto ? 'vehiculul' : 'utilajul'} <strong>corespunde din punct de vedere tehnic și poate fi
        utilizat în condiții de siguranță</strong>, în conformitate cu destinația sa și cu prevederile legale în vigoare.
      </p>

      <p style="margin:0 0 24px 0;font-size:12px;color:#333;">
        Prezenta declarație este valabilă până la data de <strong>${fmt(dataValab)}</strong> și își încetează valabilitatea
        la expirarea oricăreia dintre condițiile menționate mai sus.
      </p>

      <div style="display:flex;justify-content:flex-end;margin-top:10px;">
        <div style="text-align:center;width:280px;">
          <div style="font-size:12px;color:#333;margin-bottom:4px;">Întocmit,</div>
          ${semnaturaImg ? `<img src="${semnaturaImg}" style="height:48px;margin:2px 0;" />` : `<div style="height:48px;border-bottom:1px solid #111;margin:2px 20px 4px 20px;"></div>`}
          <div style="font-weight:bold;font-size:13px;">ing. MITRACHE ALEXANDRU</div>
          <div style="font-size:11px;color:#555;">Director Departament Logistică</div>
        </div>
      </div>

      <div style="margin-top:28px;padding-top:8px;border-top:1px solid #ccc;font-size:9px;color:#999;text-align:center;">
        Document generat electronic din sistemul Gazpet ERP · ${new Date().toLocaleString('ro-RO')} · valabil cu condițiile tehnice în termen
      </div>
    </div>`;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;';
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgW = 210, imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgW, Math.min(imgH, 297), undefined, 'FAST');
    return pdf.output('blob');
  } finally {
    document.body.removeChild(host);
  }
}
