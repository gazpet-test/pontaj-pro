// ═══════════════════════════════════════════════════════════════════════════
// SedintePage.jsx — Ședințe de progres
// Problema (Razvan 26.07.2026): ședințele sunt verbale, fiecare notează pe
// agenda lui, la următoarea toată lumea a uitat și fiecare a reținut altceva.
// Soluția: un singur loc comun + ședința nouă începe cu RESTANȚELE din cea
// anterioară. Accentul e pe acțiuni (cine / ce / până când), nu pe minute.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import { verificaProiect, consemneazaLipsuri } from './lib/verificariProiect.js'
import { genereazaSedintaPdf } from './sedinteExport.js'

const BUCKET_PDF = 'sedinte-pdf'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', purple: '#BC8CFF', orange: '#F0883E', cyan: '#56D4DD',
}
const S = {
  card: { background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 12 },
  inp: { background: G.bg, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 8, padding: '8px 11px', fontFamily: 'inherit', fontSize: 13.5, outline: 'none' },
  btn: { border: 'none', borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
}

const TIPURI_SEDINTA = [
  { k: 'executie', label: '🏗️ Execuție', color: G.blue },
  { k: 'logistica', label: '🚛 Logistică', color: G.yellow },
  { k: 'general', label: '💬 General', color: G.purple },
]
const TIPURI_LINIE = [
  { k: 'problema', label: '⚠️ Problemă', color: G.orange, hint: 'ce nu merge' },
  { k: 'actiune', label: '✅ Acțiune', color: G.green, hint: 'ce ne propunem — cine, până când' },
  { k: 'decizie', label: '⚖️ Decizie', color: G.cyan, hint: 'ce s-a hotărât' },
  { k: 'info', label: 'ℹ️ Info', color: G.dim, hint: 'de reținut' },
]
const tLinie = (k) => TIPURI_LINIE.find(x => x.k === k) || TIPURI_LINIE[3]
const tSed = (k) => TIPURI_SEDINTA.find(x => x.k === k) || TIPURI_SEDINTA[2]
const STATUSURI = [
  { k: 'deschis', label: 'Deschis', color: G.muted },
  { k: 'in_lucru', label: 'În lucru', color: G.blue },
  { k: 'rezolvat', label: 'Rezolvat', color: G.green },
  { k: 'anulat', label: 'Anulat', color: G.dim },
]
const stInfo = (k) => STATUSURI.find(x => x.k === k) || STATUSURI[0]
const fmtData = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const azi = () => new Date().toISOString().slice(0, 10)

export default function SedintePage() {
  const [profile, setProfile] = useState(null)
  const [sedinte, setSedinte] = useState([])
  const [proiecte, setProiecte] = useState([])
  const [profiles, setProfiles] = useState([])
  const [restante, setRestante] = useState([])
  const [deschisa, setDeschisa] = useState(null)      // ședința deschisă
  const [loading, setLoading] = useState(true)
  const [filtruProiect, setFiltruProiect] = useState('')
  const [doarAleMele, setDoarAleMele] = useState(false)
  const [toast, setToast] = useState(null)

  const show = useCallback((m, k = 'ok') => { setToast({ m, k }); setTimeout(() => setToast(null), 3500) }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const [pr, sd, pj, pf, rs] = await Promise.all([
      user ? supabase.from('profiles').select('id, name, is_owner, role').eq('id', user.id).maybeSingle() : { data: null },
      supabase.from('sedinte').select('*').order('data', { ascending: false }).order('id', { ascending: false }).limit(60),
      supabase.from('executie_proiecte').select('id, nume').eq('activ', true).order('nume'),
      supabase.from('profiles').select('id, name').order('name'),
      supabase.from('v_sedinte_restante').select('*').order('termen', { ascending: true, nullsFirst: false }),
    ])
    setProfile(pr.data || null)
    setSedinte(sd.data || [])
    setProiecte(pj.data || [])
    setProfiles(pf.data || [])
    setRestante(rs.data || [])
    setLoading(false)
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const numeProfil = useCallback((id) => profiles.find(p => p.id === id)?.name || '—', [profiles])
  const numeProiect = useCallback((id) => proiecte.find(p => p.id === id)?.nume || null, [proiecte])

  const sedinteFiltrate = useMemo(() => sedinte
    .filter(s => !filtruProiect || String(s.proiect_id || '') === filtruProiect)
    .filter(s => !doarAleMele || !profile || (s.participanti_ids || []).includes(profile.id) || s.created_by === profile.id),
    [sedinte, filtruProiect, doarAleMele, profile])

  const restanteFiltrate = useMemo(() => filtruProiect
    ? restante.filter(r => String(r.proiect_id || '') === filtruProiect)
    : restante, [restante, filtruProiect])

  // ── Participanți impliciți (regulă Razvan 29.07.2026): la orice ședință intră
  // automat Logistica (Mitrache Alexandru) + managerul de proiect alocat pe
  // proiectul ședinței. Restul (HR, Financiar, Achiziții) se bifează manual.
  const participantiImpliciti = async (proiectId, userId) => {
    const ids = new Set(userId ? [userId] : [])
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const mitrache = profiles.find(p => norm(p.name).includes('mitrache'))
    if (mitrache) ids.add(mitrache.id)
    if (proiectId) {
      // employees.name e „NUME_FAMILIE PRENUME"; profiles e „Prenume Nume" —
      // potrivim pe mulțimea de cuvinte, nu pe ordinea lor
      const { data: p } = await supabase.from('executie_proiecte')
        .select('mp_employee_id, employees:mp_employee_id(name)').eq('id', proiectId).maybeSingle()
      const mpNume = p?.employees?.name
      if (mpNume) {
        // minim 2 cuvinte comune — angajatul poate avea 3 nume („TOMA RAZVAN ALIN")
        // iar profilul doar 2 („Razvan Toma")
        const tokMp = norm(mpNume).split(/\s+/).filter(Boolean)
        const mp = profiles.find(pr => {
          const tokPr = norm(pr.name).split(/\s+/).filter(Boolean)
          return tokMp.filter(t => tokPr.includes(t)).length >= 2
        })
        if (mp) ids.add(mp.id)
      }
    }
    return [...ids]
  }

  // ── Ședință nouă: preia restanțele din ședințele anterioare (același proiect+tip) ──
  const sedintaNoua = async (tip, proiectId) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: s, error } = await supabase.from('sedinte').insert({
      data: azi(), tip_sedinta: tip, proiect_id: proiectId || null,
      participanti_ids: await participantiImpliciti(proiectId, user?.id), created_by: user?.id || null,
    }).select('*').single()
    if (error) { show('Eroare: ' + error.message, 'err'); return }

    // restanțele care se potrivesc (același proiect; dacă ședința n-are proiect, toate)
    const rest = restante.filter(r =>
      (!proiectId || r.proiect_id === proiectId) && r.tip_sedinta === tip)
    if (rest.length) {
      // cheia de verificare se ia de pe linia-sursă, ca dedup-ul verificărilor să funcționeze
      const { data: surse } = await supabase.from('sedinte_linii')
        .select('id, cheie_verificare, auto_generata').in('id', rest.map(r => r.id))
      const chei = Object.fromEntries((surse || []).map(x => [x.id, x]))
      const rows = rest.map((r, i) => ({
        sedinta_id: s.id, ordine: i, tip: 'actiune', text: r.text,
        responsabil_id: r.responsabil_id, termen: r.termen, status: r.status,
        tichet_id: r.tichet_id, provine_din_id: r.id,
        cheie_verificare: chei[r.id]?.cheie_verificare || null,
        auto_generata: chei[r.id]?.auto_generata || false,
      }))
      await supabase.from('sedinte_linii').insert(rows)
      // liniile vechi se închid ca „mutate" — rămân în istoric, dar nu mai apar ca restanțe
      await supabase.from('sedinte_linii').update({ status: 'anulat' }).in('id', rest.map(r => r.id))
    }
    // ── Verificarea datelor de proiect: lipsurile devin acțiuni cu termen ──
    let vRez = null
    if (proiectId) {
      try {
        vRez = await consemneazaLipsuri(s.id, proiectId, { termenZile: 7, ordineStart: rest.length })
      } catch (e) { show('Verificare date: ' + e.message, 'err') }
    }
    const parti = [`✓ Ședință nouă`]
    if (rest.length) parti.push(`${rest.length} restanțe preluate`)
    if (vRez?.adaugate) parti.push(`${vRez.adaugate} lipsuri de date consemnate`)
    show(parti.join(' — '))
    await loadAll()
    setDeschisa(s.id)
  }

  if (loading) return <div style={{ padding: 40, color: G.dim, textAlign: 'center' }}>Se încarcă…</div>
  if (deschisa) return (
    <SedintaDetaliu
      sedintaId={deschisa} onBack={() => { setDeschisa(null); loadAll() }}
      proiecte={proiecte} profiles={profiles} profile={profile} show={show}
      numeProfil={numeProfil} numeProiect={numeProiect}
    />
  )

  const intarziate = restanteFiltrate.filter(r => r.zile_intarziere > 0)

  return (
    <div style={{ padding: '18px 20px 60px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: G.text }}>🗓️ Ședințe de progres</h1>
          <div style={{ fontSize: 13, color: G.muted, marginTop: 3 }}>
            Ce ne-am propus, cine răspunde, până când — și ce a rămas din ședința trecută.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: G.muted, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={doarAleMele} onChange={e => setDoarAleMele(e.target.checked)} />
            doar ale mele
          </label>
          <select value={filtruProiect} onChange={e => setFiltruProiect(e.target.value)} style={{ ...S.inp, minWidth: 220 }}>
            <option value="">Toate proiectele</option>
            {proiecte.map(p => <option key={p.id} value={String(p.id)}>{p.nume}</option>)}
          </select>
        </div>
      </div>

      {/* ── Restanțe: ecranul cu care începe orice ședință ── */}
      <div style={{ ...S.card, padding: 16, marginBottom: 18, borderLeft: `4px solid ${intarziate.length ? G.red : G.green}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: restanteFiltrate.length ? 12 : 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: G.text }}>
            📌 Restanțe — {restanteFiltrate.length} {restanteFiltrate.length === 1 ? 'acțiune deschisă' : 'acțiuni deschise'}
            {intarziate.length > 0 && <span style={{ color: G.red, marginLeft: 8 }}>· {intarziate.length} cu termen depășit</span>}
          </div>
        </div>
        {restanteFiltrate.length === 0 ? (
          <div style={{ fontSize: 13, color: G.dim }}>Nimic restant. {sedinte.length === 0 && 'Începe prima ședință mai jos.'}</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {restanteFiltrate.slice(0, 12).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 11px', background: G.bg, border: `1px solid ${r.zile_intarziere > 0 ? G.red + '55' : G.border2}`, borderRadius: 8, fontSize: 13 }}>
                <span style={{ flex: 1, minWidth: 0, color: G.text }}>{r.text}</span>
                {r.proiect_nume && <span style={{ fontSize: 11, color: G.dim, whiteSpace: 'nowrap' }}>{r.proiect_nume.slice(0, 22)}</span>}
                <span style={{ fontSize: 11.5, color: G.muted, whiteSpace: 'nowrap' }}>{r.responsabil_nume || 'fără responsabil'}</span>
                <span style={{ fontSize: 11.5, whiteSpace: 'nowrap', color: r.zile_intarziere > 0 ? G.red : G.muted, fontWeight: r.zile_intarziere > 0 ? 700 : 400 }}>
                  {r.termen ? (r.zile_intarziere > 0 ? `+${r.zile_intarziere} zile` : fmtData(r.termen)) : 'fără termen'}
                </span>
              </div>
            ))}
            {restanteFiltrate.length > 12 && <div style={{ fontSize: 11.5, color: G.dim, paddingLeft: 4 }}>… și încă {restanteFiltrate.length - 12}</div>}
          </div>
        )}
      </div>

      {/* ── Ședință nouă ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {TIPURI_SEDINTA.map(t => (
          <button key={t.k} onClick={() => sedintaNoua(t.k, filtruProiect ? Number(filtruProiect) : null)}
            style={{ ...S.btn, background: t.color + '22', color: t.color, border: `1px solid ${t.color}55` }}>
            ＋ Ședință {t.label.split(' ')[1]}
          </button>
        ))}
        <span style={{ fontSize: 11.5, color: G.dim, alignSelf: 'center' }}>
          {filtruProiect ? 'pe proiectul selectat — preia restanțele lui' : 'fără proiect — alege unul din filtru dacă vrei ședință pe proiect'}
        </span>
      </div>

      {/* ── Istoric ── */}
      <div style={{ fontSize: 12, color: G.dim, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Istoric ședințe</div>
      {sedinteFiltrate.length === 0 ? (
        <div style={{ ...S.card, padding: 22, textAlign: 'center', color: G.dim, fontSize: 13.5 }}>
          Nicio ședință încă.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {sedinteFiltrate.map(s => <RandSedinta key={s.id} s={s} onOpen={() => setDeschisa(s.id)} numeProiect={numeProiect} />)}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 96, right: 18, zIndex: 9999, padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: toast.k === 'err' ? G.red : G.green, color: '#0D1117', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>{toast.m}</div>
      )}
    </div>
  )
}

// ── Rând din istoric ──
function RandSedinta({ s, onOpen, numeProiect }) {
  const [nr, setNr] = useState(null)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('sedinte_linii').select('tip, status').eq('sedinta_id', s.id)
      const l = data || []
      setNr({
        total: l.length,
        actiuni: l.filter(x => x.tip === 'actiune').length,
        deschise: l.filter(x => x.tip === 'actiune' && ['deschis', 'in_lucru'].includes(x.status)).length,
      })
    })()
  }, [s.id])
  const t = tSed(s.tip_sedinta)
  const proiect = numeProiect(s.proiect_id)
  return (
    <div onClick={onOpen} style={{ ...S.card, padding: '11px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${t.color}` }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: G.text, whiteSpace: 'nowrap' }}>{fmtData(s.data)}</span>
      <span style={{ fontSize: 12, color: t.color, whiteSpace: 'nowrap' }}>{t.label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: G.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {s.titlu || proiect || '—'}
      </span>
      {nr && (
        <span style={{ fontSize: 11.5, color: G.dim, whiteSpace: 'nowrap' }}>
          {nr.total} {nr.total === 1 ? 'punct' : 'puncte'}
          {nr.deschise > 0 && <span style={{ color: G.orange, fontWeight: 700 }}> · {nr.deschise} deschise</span>}
        </span>
      )}
      {s.pdf_path && <span title="Proces-verbal generat" style={{ fontSize: 13 }}>📄</span>}
      <span style={{ color: G.dim }}>›</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// DETALIU ȘEDINȚĂ — aici se scrie în timpul discuției
// ═══════════════════════════════════════════════════════════════════════════
function SedintaDetaliu({ sedintaId, onBack, proiecte, profiles, profile, show, numeProfil, numeProiect }) {
  const [sed, setSed] = useState(null)
  const [linii, setLinii] = useState([])
  const [stare, setStare] = useState(null)          // verificaProiect() — termen, risc, lipsuri
  const [vechime, setVechime] = useState({})        // {cheie_verificare: în câte ședințe a apărut}
  const [loading, setLoading] = useState(true)
  const [nouTip, setNouTip] = useState('actiune')
  const [nouText, setNouText] = useState('')
  const [nouResp, setNouResp] = useState('')
  const [nouTermen, setNouTermen] = useState('')
  const inputRef = useRef(null)

  const [rsvp, setRsvp] = useState([])
  const [invitati, setInvitati] = useState([])      // parteneri din afara platformei
  const [agenda, setAgenda] = useState([])          // parteneri folosiți în ședințe anterioare
  const load = useCallback(async () => {
    setLoading(true)
    const [s, l, r, iv] = await Promise.all([
      supabase.from('sedinte').select('*').eq('id', sedintaId).maybeSingle(),
      supabase.from('sedinte_linii').select('*').eq('sedinta_id', sedintaId).order('ordine').order('id'),
      supabase.from('sedinte_rsvp').select('status').eq('sedinta_id', sedintaId),
      supabase.from('sedinte_invitati').select('*').eq('sedinta_id', sedintaId).order('id'),
    ])
    setSed(s.data || null)
    setLinii(l.data || [])
    setRsvp(r.data || [])
    setInvitati(iv.data || [])
    setLoading(false)
    supabase.from('v_sedinte_invitati_agenda').select('*').order('ultima_folosire', { ascending: false }).limit(40)
      .then(({ data }) => setAgenda(data || []))
    // stare proiect + vechimea verificărilor (în câte ședințe a tot apărut aceeași lipsă)
    if (s.data?.proiect_id) {
      verificaProiect(s.data.proiect_id).then(setStare).catch(() => setStare(null))
      supabase.from('sedinte_linii')
        .select('cheie_verificare, sedinta_id, sedinte!inner(proiect_id)')
        .eq('sedinte.proiect_id', s.data.proiect_id).not('cheie_verificare', 'is', null)
        .then(({ data }) => {
          const m = {}
          for (const r of (data || [])) (m[r.cheie_verificare] = m[r.cheie_verificare] || new Set()).add(r.sedinta_id)
          setVechime(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.size])))
        })
    } else { setStare(null); setVechime({}) }
  }, [sedintaId])
  useEffect(() => { load() }, [load])

  const salvSed = async (patch) => {
    setSed(x => ({ ...x, ...patch }))
    await supabase.from('sedinte').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', sedintaId)
  }

  const toggleParticipant = (pid) => {
    const cur = sed.participanti_ids || []
    salvSed({ participanti_ids: cur.includes(pid) ? cur.filter(x => x !== pid) : [...cur, pid] })
  }

  // ── Invitați externi (parteneri): primesc invitația și PV-ul pe mail ──
  const adaugaInvitat = async ({ nume, firma, email }) => {
    if (!nume?.trim()) return
    const { data, error } = await supabase.from('sedinte_invitati')
      .insert({ sedinta_id: sedintaId, nume: nume.trim(), firma: firma?.trim() || null, email: email?.trim() || null })
      .select().single()
    if (error) { show('Nu am putut adăuga invitatul: ' + error.message, 'err'); return }
    setInvitati(x => [...x, data])
  }
  const stergeInvitat = async (id) => {
    await supabase.from('sedinte_invitati').delete().eq('id', id)
    setInvitati(x => x.filter(i => i.id !== id))
  }

  // ── Trimiterea invitației, oricând ÎNAINTE de ședință (nu doar la încheiere) ──
  const [trimitInvit, setTrimitInvit] = useState(false)
  const trimiteInvitatia = async () => {
    setTrimitInvit(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sedinta-invite`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sedinta_id: sedintaId }),
      })
      const r = await resp.json()
      if (r?.ok) {
        show(`✉️ Invitații trimise la ${r.trimise}/${r.total}` + (r.externi ? ` (din care ${r.externi} parteneri)` : ''))
        setSed(x => ({ ...x, invite_trimisa_la: new Date().toISOString() }))
      } else show('Invitații: ' + (r?.error || 'eroare necunoscută'), 'err')
    } catch (e) { show('Invitații: ' + (e.message || e), 'err') }
    finally { setTrimitInvit(false) }
  }

  // ── Încheierea ședinței = momentul PDF-ului ──
  // Se generează procesul-verbal, se urcă în Storage și fiecare participant
  // primește notificare cu link — „raportul ajunge în contul fiecăruia".
  // Cere semnătură ÎNAINTE de generarea PDF-ului (cine încheie, semnează).
  const [inchidere, setInchidere] = useState(false)
  const [ceruSemnatura, setCeruSemnatura] = useState(false)
  const incheie = async (semnaturaFile) => {
    if (!semnaturaFile) { setCeruSemnatura(true); return }
    setInchidere(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // ANTI-BUG: textarea-urile salvează pe blur, iar blur-ul se declanșează în
      // același tick cu click-ul pe „Încheie" — starea din React e încă cea veche.
      // Recitim din BD ca observațiile scrise chiar înainte de click să intre în PV.
      const [sFresh, lFresh, iFresh] = await Promise.all([
        supabase.from('sedinte').select('*').eq('id', sedintaId).maybeSingle(),
        supabase.from('sedinte_linii').select('*').eq('sedinta_id', sedintaId).order('ordine').order('id'),
        supabase.from('sedinte_invitati').select('*').eq('sedinta_id', sedintaId).order('id'),
      ])
      const sedPdf = sFresh.data || sed
      const liniiPdf = lFresh.data || linii
      const invitatiPdf = iFresh.data || invitati
      setSed(sedPdf); setLinii(liniiPdf); setInvitati(invitatiPdf)

      const semnaturaPath = `${new Date(sed.data).getFullYear()}/${sedintaId}/semnatura_${Date.now()}.png`
      const { error: semErr } = await supabase.storage.from(BUCKET_PDF)
        .upload(semnaturaPath, semnaturaFile, { contentType: 'image/png', upsert: true })
      if (semErr) throw semErr

      const semnaturaDataUrl = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result)
        r.onerror = rej
        r.readAsDataURL(semnaturaFile)
      })

      const { blob, nume } = await genereazaSedintaPdf({
        sed: sedPdf, linii: liniiPdf,
        numeProiect: numeProiect(sedPdf.proiect_id),
        numeParticipanti: (sedPdf.participanti_ids || []).map(numeProfil).filter(n => n !== '—'),
        invitati: invitatiPdf,
        numeProfil, stare,
        semnatura: { dataUrl: semnaturaDataUrl, nume: numeProfil(user?.id), data: new Date().toISOString() },
      })
      const path = `${new Date(sed.data).getFullYear()}/${sedintaId}/${nume}`
      const { error: upErr } = await supabase.storage.from(BUCKET_PDF)
        .upload(path, blob, { contentType: 'application/pdf', upsert: true })
      if (upErr) throw upErr
      await salvSed({
        inchisa_la: new Date().toISOString(), pdf_path: path,
        semnat_de: user?.id || null, semnat_la: new Date().toISOString(), semnatura_path: semnaturaPath,
      })
      setCeruSemnatura(false)
      // notificare pentru fiecare participant (fără cel care încheie)
      const dest = (sed.participanti_ids || []).filter(p => p && p !== user?.id)
      if (dest.length) {
        await supabase.from('notifications').insert(dest.map(pid => ({
          profile_id: pid, type: 'info', modul: 'Ședințe',
          title: `PV ședință ${fmtData(sed.data)}${numeProiect(sed.proiect_id) ? ' — ' + numeProiect(sed.proiect_id) : ''}`,
          message: 'Procesul-verbal a fost generat. Îl găsești în modulul Ședințe.',
          link_to: '/sedinte',
        })))
      }
      show('✓ Ședință încheiată — PV generat și semnat' + (dest.length ? `, trimis la ${dest.length} participanți` : ''))

      // ── PV-ul pleacă automat pe mail: participanți + parteneri externi ──
      // Eroare aici nu blochează încheierea — ședința e deja salvată și PV-ul urcat.
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sedinta-pv`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sedinta_id: sedintaId }),
        })
        const r = await resp.json()
        if (r?.ok) {
          show(`📧 PV trimis pe mail la ${r.trimise}/${r.total}` + (r.externi ? ` (din care ${r.externi} parteneri)` : ''))
          setSed(x => ({ ...x, pv_trimis_la: new Date().toISOString() }))
        } else if (r?.error) show('PV pe mail: ' + r.error, 'err')
      } catch (e) { show('PV pe mail: ' + (e.message || e), 'err') }
    } catch (e) {
      show('Eroare la PDF: ' + (e.message || e), 'err')
    } finally { setInchidere(false) }
  }

  const descarcaPdf = async () => {
    const { data } = await supabase.storage.from(BUCKET_PDF).createSignedUrl(sed.pdf_path, 600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else show('Nu am putut deschide PDF-ul', 'err')
  }

  const adauga = async () => {
    const txt = nouText.trim()
    if (!txt) return
    const { data, error } = await supabase.from('sedinte_linii').insert({
      sedinta_id: sedintaId, ordine: linii.length, tip: nouTip, text: txt,
      responsabil_id: nouTip === 'actiune' ? (nouResp || null) : null,
      termen: nouTip === 'actiune' ? (nouTermen || null) : null,
    }).select('*').single()
    if (error) { show('Eroare: ' + error.message, 'err'); return }
    setLinii(l => [...l, data])
    setNouText(''); setNouTermen('')
    inputRef.current?.focus()
  }

  const salvLinie = async (id, patch) => {
    if (patch.status === 'rezolvat') patch.rezolvat_la = new Date().toISOString()
    setLinii(l => l.map(x => x.id === id ? { ...x, ...patch } : x))
    const { error } = await supabase.from('sedinte_linii').update(patch).eq('id', id)
    if (error) { show('Eroare: ' + error.message, 'err'); load() }
  }
  const stergeLinie = async (id) => {
    if (!window.confirm('Ștergi acest punct?')) return
    await supabase.from('sedinte_linii').delete().eq('id', id)
    setLinii(l => l.filter(x => x.id !== id))
  }

  // O acțiune poate deveni tichet — urmărirea și notificările există deja acolo
  const faTichet = async (linie) => {
    if (linie.tichet_id) { show('Are deja tichet asociat'); return }
    const { data: { user } } = await supabase.auth.getUser()
    const { data: ultim } = await supabase.from('tichete').select('numar_tichet').order('id', { ascending: false }).limit(1).maybeSingle()
    const nr = String((parseInt(String(ultim?.numar_tichet || '').replace(/\D/g, '')) % 10000 || 0) + 1).padStart(4, '0')
    const { data: t, error } = await supabase.from('tichete').insert({
      numar_tichet: `TKT-${new Date().getFullYear()}-${nr}`,
      departament: sed?.tip_sedinta === 'logistica' ? 'logistica' : 'comercial',
      subcategorie: 'altele',
      titlu: linie.text.slice(0, 90),
      descriere: `Acțiune stabilită în ședința din ${fmtData(sed?.data)}${numeProiect(sed?.proiect_id) ? ' — ' + numeProiect(sed.proiect_id) : ''}.\n\n${linie.text}${linie.termen ? `\n\nTermen agreat: ${fmtData(linie.termen)}` : ''}`,
      urgenta: 'normal',
      status: linie.responsabil_id ? 'atribuit' : 'deschis',
      deschis_de: user?.id || null,
      data_deschidere: new Date().toISOString(),
      persoana_responsabila: linie.responsabil_id || null,
      atribuit_de: linie.responsabil_id ? (user?.id || null) : null,
      data_atribuire: linie.responsabil_id ? new Date().toISOString() : null,
    }).select('id, numar_tichet').single()
    if (error) { show('Eroare tichet: ' + error.message, 'err'); return }
    if (linie.responsabil_id) await supabase.from('tichete_asignati').insert({ tichet_id: t.id, profile_id: linie.responsabil_id })
    await salvLinie(linie.id, { tichet_id: t.id })
    show(`✓ Tichet ${t.numar_tichet} creat`)
  }

  if (loading || !sed) return <div style={{ padding: 40, color: G.dim, textAlign: 'center' }}>Se încarcă…</div>

  const inchisa = !!sed.inchisa_la
  const actiuni = linii.filter(l => l.tip === 'actiune')
  const deschise = actiuni.filter(l => ['deschis', 'in_lucru'].includes(l.status))
  const t = tSed(sed.tip_sedinta)

  return (
    <div style={{ padding: '18px 20px 60px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={{ ...S.btn, background: G.surface, color: G.text, border: `1px solid ${G.border2}`, padding: '8px 12px' }}>←</button>
        <div style={{ flex: 1 }}>
          <input value={sed.titlu || ''} onChange={e => setSed(s => ({ ...s, titlu: e.target.value }))} onBlur={e => salvSed({ titlu: e.target.value.trim() || null })}
            placeholder={`Ședință ${t.label.split(' ')[1].toLowerCase()} — ${fmtData(sed.data)}`} disabled={inchisa}
            style={{ ...S.inp, fontSize: 18, fontWeight: 800, width: '100%', border: 'none', background: 'transparent', padding: '2px 0' }} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <span style={{ fontSize: 12, color: t.color }}>{t.label}</span>
            <input type="date" value={sed.data} onChange={e => salvSed({ data: e.target.value })} disabled={inchisa} style={{ ...S.inp, padding: '4px 8px', fontSize: 12 }} />
            <select value={sed.proiect_id || ''} onChange={e => salvSed({ proiect_id: e.target.value ? Number(e.target.value) : null })} disabled={inchisa} style={{ ...S.inp, padding: '4px 8px', fontSize: 12, maxWidth: 260 }}>
              <option value="">— fără proiect —</option>
              {proiecte.map(p => <option key={p.id} value={p.id}>{p.nume}</option>)}
            </select>
            {inchisa && <span style={{ fontSize: 11.5, color: G.green, fontWeight: 700 }}>✓ încheiată</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {sed.pdf_path && (
            <button onClick={descarcaPdf} style={{ ...S.btn, background: G.blue + '18', color: G.blue, border: `1px solid ${G.blue}44`, whiteSpace: 'nowrap' }}>
              📄 PV (PDF)
            </button>
          )}
          <button onClick={() => inchisa ? salvSed({ inchisa_la: null, semnat_de: null, semnat_la: null, semnatura_path: null }) : incheie()} disabled={inchidere}
            style={{ ...S.btn, background: inchisa ? G.surface : G.green + '22', color: inchisa ? G.muted : G.green, border: `1px solid ${inchisa ? G.border2 : G.green + '55'}`, whiteSpace: 'nowrap', opacity: inchidere ? .6 : 1 }}>
            {inchidere ? '⏳ Se generează PV…' : inchisa ? 'Redeschide' : '✓ Încheie ședința'}
          </button>
        </div>
      </div>

      {inchisa && sed.semnat_de && (
        <div style={{ fontSize: 12, color: G.green, marginBottom: 6, marginTop: -8 }}>
          🖊️ Semnat de {numeProfil(sed.semnat_de)} la {new Date(sed.semnat_la).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
      {sed.invite_trimisa_la && rsvp.length > 0 && (
        <div style={{ fontSize: 12, color: G.muted, marginBottom: 12 }}>
          ✉️ Invitații: <span style={{ color: G.green, fontWeight: 700 }}>✅ {rsvp.filter(r => r.status === 'acceptat').length} confirmate</span>
          {' · '}<span style={{ color: G.yellow, fontWeight: 700 }}>🤔 {rsvp.filter(r => r.status === 'poate').length} poate</span>
          {' · '}<span style={{ color: G.red, fontWeight: 700 }}>❌ {rsvp.filter(r => r.status === 'refuzat').length} refuzate</span>
          {' · '}<span>⏳ {rsvp.filter(r => r.status === 'in_asteptare').length} în așteptare</span>
        </div>
      )}

      {/* ── Participanți: cine primește PV-ul în cont la încheiere ── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: G.dim, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>
          Participanți ({(sed.participanti_ids || []).length}) — primesc PV-ul la încheiere
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {profiles.map(p => {
            const in_ = (sed.participanti_ids || []).includes(p.id)
            return (
              <button key={p.id} onClick={() => !inchisa && toggleParticipant(p.id)} disabled={inchisa}
                style={{ ...S.btn, padding: '4px 11px', fontSize: 12, background: in_ ? G.cyan + '22' : 'transparent',
                  color: in_ ? G.cyan : G.dim, border: `1px solid ${in_ ? G.cyan + '66' : G.border2}` }}>
                {in_ ? '✓ ' : ''}{p.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Invitați externi: parteneri (Apazol, Aranewconst…) — primesc invitația și PV-ul ── */}
      <InvitatiExterni
        invitati={invitati} agenda={agenda} inchisa={inchisa}
        onAdauga={adaugaInvitat} onSterge={stergeInvitat}
        vechiText={sed.participanti_alti}
        onMutaVechiText={() => salvSed({ participanti_alti: null })}
      />

      {/* ── Invitația pleacă înainte de ședință, nu la încheiere ── */}
      {!inchisa && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <button onClick={trimiteInvitatia} disabled={trimitInvit}
            style={{ ...S.btn, background: G.cyan + '18', color: G.cyan, border: `1px solid ${G.cyan}44`, opacity: trimitInvit ? .6 : 1 }}>
            {trimitInvit ? '⏳ Se trimite…' : sed.invite_trimisa_la ? '✉️ Retrimite invitația' : '✉️ Trimite invitația acum'}
          </button>
          <span style={{ fontSize: 11.5, color: G.dim }}>
            {sed.invite_trimisa_la
              ? `trimisă ${new Date(sed.invite_trimisa_la).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — retrimite după ce adaugi participanți`
              : 'participanții primesc mail cu .ics și butoane de confirmare — trimite-o din timp, nu la încheiere'}
          </span>
        </div>
      )}

      {/* ── Stare proiect: ședința nu începe cu datele goale ── */}
      {stare && (
        <div style={{ ...S.card, padding: '12px 15px', marginBottom: 14, borderLeft: `4px solid ${stare.risc === 'critic' ? G.red : stare.risc === 'atentie' ? G.orange : G.green}` }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'baseline' }}>
            {stare.termen && (
              <div>
                <div style={{ fontSize: 10.5, color: G.dim, textTransform: 'uppercase', letterSpacing: .4 }}>Termen finalizare ({stare.termenSursa})</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: stare.zileRamase < 0 ? G.red : stare.zileRamase < 30 ? G.orange : G.text }}>
                  {fmtData(stare.termen)}
                  <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 7, color: stare.zileRamase < 0 ? G.red : G.muted }}>
                    {stare.zileRamase < 0 ? `depășit cu ${-stare.zileRamase} zile` : `${stare.zileRamase} zile rămase`}
                  </span>
                </div>
              </div>
            )}
            {stare.pctTimp != null && (
              <div>
                <div style={{ fontSize: 10.5, color: G.dim, textTransform: 'uppercase', letterSpacing: .4 }}>Timp consumat</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>{stare.pctTimp.toFixed(0)}%</div>
              </div>
            )}
            {stare.stadiu && (
              <div>
                <div style={{ fontSize: 10.5, color: G.dim, textTransform: 'uppercase', letterSpacing: .4 }}>Stadiu fizic (din rapoarte)</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>{stare.stadiu.pct.toFixed(0)}%
                  <span style={{ fontSize: 11, fontWeight: 400, color: G.dim, marginLeft: 5 }}>({stare.stadiu.activitatiMasurate} activități măsurate)</span>
                </div>
              </div>
            )}
            {stare.risc && stare.risc !== 'ok' && (
              <div style={{ alignSelf: 'center', padding: '5px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 800,
                background: (stare.risc === 'critic' ? G.red : G.orange) + '22', color: stare.risc === 'critic' ? G.red : G.orange }}>
                {stare.risc === 'critic' ? '🚨' : '⚠️'} decalaj {stare.decalaj.toFixed(0)}% între timp și execuție
              </div>
            )}
            {stare.lipsuri.length > 0 && (
              <div style={{ alignSelf: 'center', fontSize: 12.5, color: G.yellow }}>
                📋 {stare.lipsuri.length} date de proiect lipsă
              </div>
            )}
          </div>
        </div>
      )}

      {actiuni.length > 0 && (
        <div style={{ fontSize: 12.5, color: G.muted, marginBottom: 12 }}>
          {actiuni.length} acțiuni · <strong style={{ color: deschise.length ? G.orange : G.green }}>{deschise.length} deschise</strong>
        </div>
      )}

      {/* ── Liniile ședinței ── */}
      <div style={{ display: 'grid', gap: 7, marginBottom: 16 }}>
        {linii.length === 0 && <div style={{ ...S.card, padding: 20, textAlign: 'center', color: G.dim, fontSize: 13 }}>Scrie mai jos ce se discută — problemă, acțiune, decizie.</div>}
        {linii.map(l => {
          const ti = tLinie(l.tip)
          const st = stInfo(l.status)
          const intarziat = l.tip === 'actiune' && l.termen && ['deschis', 'in_lucru'].includes(l.status) && new Date(l.termen) < new Date(azi())
          return (
            <div key={l.id} style={{ ...S.card, padding: '10px 13px', borderLeft: `3px solid ${ti.color}`, opacity: l.status === 'anulat' ? .5 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 11, color: ti.color, fontWeight: 700, whiteSpace: 'nowrap', paddingTop: 2 }}>{ti.label}</span>
                <textarea defaultValue={l.text} onBlur={e => e.target.value.trim() && e.target.value.trim() !== l.text && salvLinie(l.id, { text: e.target.value.trim() })}
                  disabled={inchisa} rows={1}
                  style={{ ...S.inp, flex: 1, minWidth: 0, border: 'none', background: 'transparent', padding: '2px 0', resize: 'vertical', fontSize: 13.5,
                    textDecoration: l.status === 'rezolvat' ? 'line-through' : 'none', color: l.status === 'rezolvat' ? G.muted : G.text }} />
                {l.provine_din_id && <span title="Preluată din ședința anterioară" style={{ fontSize: 11, color: G.yellow, whiteSpace: 'nowrap' }}>↩ restanță</span>}
                {l.auto_generata && (vechime[l.cheie_verificare] || 1) > 1 && ['deschis', 'in_lucru'].includes(l.status) && (
                  <span title="Aceeași lipsă a apărut și în ședințele anterioare" style={{ fontSize: 11, color: G.red, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    ⏳ de {vechime[l.cheie_verificare]} ședințe
                  </span>
                )}
                <button onClick={() => stergeLinie(l.id)} disabled={inchisa} style={{ background: 'transparent', border: 'none', color: G.dim, cursor: 'pointer', fontSize: 13 }}>🗑</button>
              </div>
              {l.tip === 'actiune' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, paddingLeft: 4 }}>
                  <select value={l.responsabil_id || ''} onChange={e => salvLinie(l.id, { responsabil_id: e.target.value || null })} disabled={inchisa}
                    style={{ ...S.inp, padding: '4px 8px', fontSize: 12, maxWidth: 190 }}>
                    <option value="">— cine? —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="date" value={l.termen || ''} onChange={e => salvLinie(l.id, { termen: e.target.value || null })} disabled={inchisa}
                    style={{ ...S.inp, padding: '4px 8px', fontSize: 12, borderColor: intarziat ? G.red : G.border2 }} />
                  {intarziat && <span style={{ fontSize: 11, color: G.red, fontWeight: 700 }}>termen depășit</span>}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {STATUSURI.map(s => (
                      <button key={s.k} onClick={() => salvLinie(l.id, { status: s.k })} disabled={inchisa}
                        style={{ ...S.btn, padding: '3px 9px', fontSize: 11, background: l.status === s.k ? s.color : 'transparent', color: l.status === s.k ? '#0D1117' : G.dim, border: `1px solid ${l.status === s.k ? s.color : G.border2}` }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {l.tichet_id
                    ? <span style={{ fontSize: 11, color: G.purple, whiteSpace: 'nowrap' }}>🎫 tichet #{l.tichet_id}</span>
                    : <button onClick={() => faTichet(l)} disabled={inchisa} style={{ ...S.btn, padding: '3px 9px', fontSize: 11, background: G.purple + '18', color: G.purple, border: `1px solid ${G.purple}44` }}>🎫 Fă tichet</button>}
                </div>
              )}
              {/* Notă/detaliu pe orice tip de linie — decizii și info aveau doar textul */}
              <NotaLinie l={l} inchisa={inchisa} onSalveaza={obs => salvLinie(l.id, { observatii: obs })} />
            </div>
          )
        })}
      </div>

      {/* ── Adăugare rapidă ── */}
      {!inchisa && (
        <div style={{ ...S.card, padding: 13 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 9, flexWrap: 'wrap' }}>
            {TIPURI_LINIE.map(t2 => (
              <button key={t2.k} onClick={() => setNouTip(t2.k)} title={t2.hint}
                style={{ ...S.btn, padding: '5px 11px', fontSize: 12, background: nouTip === t2.k ? t2.color + '26' : 'transparent', color: nouTip === t2.k ? t2.color : G.dim, border: `1px solid ${nouTip === t2.k ? t2.color + '66' : G.border2}` }}>
                {t2.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input ref={inputRef} value={nouText} onChange={e => setNouText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); adauga() } }}
              placeholder={nouTip === 'actiune' ? 'Ce ne propunem? (Enter ca să adaugi)' : tLinie(nouTip).hint + '… (Enter)'}
              style={{ ...S.inp, flex: 1, minWidth: 240, fontSize: 14 }} />
            {nouTip === 'actiune' && (
              <>
                <select value={nouResp} onChange={e => setNouResp(e.target.value)} style={{ ...S.inp, maxWidth: 175, fontSize: 12.5 }}>
                  <option value="">— cine? —</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="date" value={nouTermen} onChange={e => setNouTermen(e.target.value)} title="Termen" style={{ ...S.inp, fontSize: 12.5 }} />
              </>
            )}
            <button onClick={adauga} disabled={!nouText.trim()}
              style={{ ...S.btn, background: nouText.trim() ? G.green : G.surface2, color: nouText.trim() ? '#0D1117' : G.dim }}>＋ Adaugă</button>
          </div>
        </div>
      )}

      {/* ── Observații ── */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11.5, color: G.dim, marginBottom: 5 }}>Observații (opțional)</div>
        <textarea defaultValue={sed.observatii || ''} onBlur={e => salvSed({ observatii: e.target.value.trim() || null })} disabled={inchisa} rows={2}
          placeholder="Context, note libere…" style={{ ...S.inp, width: '100%', resize: 'vertical', boxSizing: 'border-box' }} />
      </div>

      {ceruSemnatura && (
        <ModalSemnaturaIncheiere
          onClose={() => setCeruSemnatura(false)}
          onConfirm={(file) => incheie(file)}
          saving={inchidere}
        />
      )}
    </div>
  )
}

// ── Notă pe o linie de ședință (orice tip: problemă, acțiune, decizie, info) ──
// Intră în PV sub punctul discutat, cursiv.
function NotaLinie({ l, inchisa, onSalveaza }) {
  const [deschis, setDeschis] = useState(!!l.observatii)
  if (!deschis) {
    if (inchisa) return null
    return (
      <button onClick={() => setDeschis(true)}
        style={{ background: 'transparent', border: 'none', color: G.dim, cursor: 'pointer', fontSize: 11, padding: '4px 0 0 4px' }}>
        ＋ notă
      </button>
    )
  }
  return (
    <textarea defaultValue={l.observatii || ''} disabled={inchisa} rows={2}
      onBlur={e => { const v = e.target.value.trim() || null; if (v !== (l.observatii || null)) onSalveaza(v) }}
      placeholder="detalii, context, ce s-a stabilit concret…"
      style={{ ...S.inp, marginTop: 7, marginLeft: 4, width: 'calc(100% - 4px)', boxSizing: 'border-box',
        fontSize: 12.5, resize: 'vertical', fontStyle: 'italic', color: G.muted, background: G.bg }} />
  )
}

// ── Invitați din afara platformei: parteneri, subcontractori, beneficiari ──
// Cu email ca să primească invitația și PV-ul, nu doar să apară scriși în PV.
function InvitatiExterni({ invitati, agenda, inchisa, onAdauga, onSterge, vechiText, onMutaVechiText }) {
  const [nume, setNume] = useState('')
  const [firma, setFirma] = useState('')
  const [email, setEmail] = useState('')
  const sugestii = useMemo(() => {
    const q = nume.trim().toLowerCase()
    if (q.length < 2) return []
    return (agenda || []).filter(a =>
      !invitati.some(i => i.nume.toLowerCase() === a.nume.toLowerCase()) &&
      ((a.nume || '').toLowerCase().includes(q) || (a.firma || '').toLowerCase().includes(q))
    ).slice(0, 5)
  }, [nume, agenda, invitati])

  const adauga = () => {
    if (!nume.trim()) return
    onAdauga({ nume, firma, email })
    setNume(''); setFirma(''); setEmail('')
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: G.dim, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 6 }}>
        Invitați externi ({invitati.length}) — parteneri, subcontractori, beneficiar
      </div>
      {invitati.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 7 }}>
          {invitati.map(i => (
            <span key={i.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 12,
              borderRadius: 8, background: G.orange + '18', color: G.orange, border: `1px solid ${G.orange}44` }}>
              {i.nume}{i.firma ? ` · ${i.firma}` : ''}
              {i.email ? <span title={i.email} style={{ fontSize: 10 }}>✉️</span>
                       : <span title="fără email — nu primește invitația și PV-ul" style={{ fontSize: 10, opacity: .7 }}>⚠️</span>}
              {!inchisa && <button onClick={() => onSterge(i.id)} style={{ background: 'transparent', border: 'none', color: G.orange, cursor: 'pointer', fontSize: 12, padding: 0 }}>×</button>}
            </span>
          ))}
        </div>
      )}
      {!inchisa && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={nume} onChange={e => setNume(e.target.value)} placeholder="nume persoană"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adauga() } }}
              style={{ ...S.inp, fontSize: 12.5, maxWidth: 190 }} />
            <input value={firma} onChange={e => setFirma(e.target.value)} placeholder="firmă (Apazol, Aranewconst…)"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adauga() } }}
              style={{ ...S.inp, fontSize: 12.5, maxWidth: 210 }} />
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email (ca să primească PV-ul)" type="email"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adauga() } }}
              style={{ ...S.inp, fontSize: 12.5, maxWidth: 240 }} />
            <button onClick={adauga} disabled={!nume.trim()}
              style={{ ...S.btn, padding: '6px 12px', fontSize: 12, background: nume.trim() ? G.orange + '22' : 'transparent',
                color: nume.trim() ? G.orange : G.dim, border: `1px solid ${nume.trim() ? G.orange + '55' : G.border2}` }}>＋ Adaugă</button>
          </div>
          {sugestii.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <span style={{ fontSize: 11, color: G.dim, alignSelf: 'center' }}>din ședințe anterioare:</span>
              {sugestii.map((a, i) => (
                <button key={i} onClick={() => { onAdauga(a); setNume(''); setFirma(''); setEmail('') }}
                  style={{ ...S.btn, padding: '3px 9px', fontSize: 11.5, background: 'transparent', color: G.muted, border: `1px solid ${G.border2}` }}>
                  {a.nume}{a.firma ? ` · ${a.firma}` : ''}
                </button>
              ))}
            </div>
          )}
          {vechiText && (
            <div style={{ marginTop: 7, fontSize: 11.5, color: G.yellow }}>
              Text vechi de invitați: „{vechiText}" — adaugă-i mai sus ca să primească PV-ul pe mail,{' '}
              <button onClick={onMutaVechiText} style={{ background: 'transparent', border: 'none', color: G.cyan, cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline', padding: 0 }}>apoi șterge textul</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Semnătura care încheie ședința: cere semnătură desenată înainte de PV ──
function ModalSemnaturaIncheiere({ onClose, onConfirm, saving }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const [drawing, setDrawing] = useState(false)
  const [hasContent, setHasContent] = useState(false)
  const height = 180

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, rect.width, height)
    ctxRef.current = ctx
  }, [])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const t = e.touches && e.touches[0]
    return { x: (t ? t.clientX : e.clientX) - rect.left, y: (t ? t.clientY : e.clientY) - rect.top }
  }
  const start = (e) => { e.preventDefault(); setDrawing(true); setHasContent(true); const { x, y } = getPos(e); ctxRef.current.beginPath(); ctxRef.current.moveTo(x, y) }
  const move = (e) => { if (!drawing) return; e.preventDefault(); const { x, y } = getPos(e); ctxRef.current.lineTo(x, y); ctxRef.current.stroke() }
  const end = () => setDrawing(false)
  const clear = () => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    ctxRef.current.fillStyle = '#fff'; ctxRef.current.fillRect(0, 0, rect.width, height)
    setHasContent(false)
  }
  const confirma = () => {
    if (!hasContent) return
    canvasRef.current.toBlob((blob) => {
      if (!blob) return
      onConfirm(new File([blob], 'semnatura.png', { type: 'image/png' }))
    }, 'image/png', 0.95)
  }

  return (
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...S.card, width: 520, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: G.text, marginBottom: 4 }}>🖊️ Semnează procesul-verbal</div>
        <div style={{ fontSize: 12, color: G.muted, marginBottom: 14 }}>Semnătura ta confirmă conținutul ședinței, apoi se generează PV-ul.</div>
        <div style={{ position: 'relative', background: '#fff', border: `2px dashed ${G.border2}`, borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
          <canvas ref={canvasRef}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
            style={{ display: 'block', width: '100%', height, cursor: 'crosshair', touchAction: 'none' }} />
          {!hasContent && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 13, fontStyle: 'italic', pointerEvents: 'none' }}>
              ✍️ Desenează cu mouse-ul sau cu degetul
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{ ...S.btn, background: G.surface, color: G.text, border: `1px solid ${G.border2}` }}>Anulează</button>
          <button onClick={clear} disabled={!hasContent || saving} style={{ ...S.btn, background: 'transparent', color: G.red, border: `1px solid ${G.red}55`, opacity: hasContent ? 1 : .5 }}>🗑 Șterge</button>
          <button onClick={confirma} disabled={!hasContent || saving}
            style={{ ...S.btn, background: hasContent ? G.green : G.surface2, color: hasContent ? '#0D1117' : G.dim, opacity: saving ? .6 : 1 }}>
            {saving ? '⏳ Se generează…' : '✓ Semnează și încheie'}
          </button>
        </div>
      </div>
    </div>
  )
}
