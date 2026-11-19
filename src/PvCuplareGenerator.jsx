// Execuție → proiect → Documente: „📄 PV predare conductă pentru cuplare” (cererea lui Eugen, aprobată de Răzvan 19.11.2026).
// Butonul deschide un formular cu antetul completat din proiect (executie_proiecte + employees); restul câmpurilor sunt opționale,
// iar „Descarcă Word” face .docx-ul în browser (pvCuplareDocx.js). Nimic nu se scrie în BD.
// Acces: butonul stă în ProiectContextView, care se randează doar după verdictul de acces al proiectului (useAccesProiectExecutie).
// Stări distincte (L18): se încarcă / eroare de citire (cu reîncercare) / formular; numele care nu s-au putut citi = avertisment vizibil.
// L24: răspunsurile se aplică doar dacă deschiderea e cea curentă și proiectul e același; la schimbarea proiectului formularul se închide.
import { useEffect, useRef, useState } from 'react'
import { construiestePvCuplare, dateInitialePv, numeFisierPv } from './pvCuplareDocx.js'
import { blobDocx } from './OfertareExport.js'

function descarcaBlob(blob, nume) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nume
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)   // revocarea imediată rupe descărcarea în unele browsere
}

const C = {
  bg: '#0D1117', card: '#1C2128', text: '#E6EDF3', muted: '#8B949E', border: '#30363D',
  blue: '#58A6FF', green: '#2EA043', greenBg: '#238636', yellow: '#D29922', red: '#F85149',
}
const S = {
  input: { width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 13, padding: '6px 8px' },
  eticheta: { display: 'block', fontSize: 11, color: C.muted, marginBottom: 3 },
  buton: { background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.blue, cursor: 'pointer', fontSize: 12, padding: '5px 10px' },
  sectiune: { fontSize: 12, fontWeight: 700, color: C.text, margin: '14px 0 6px' },
}

// Coloanele există în executie_proiecte (vezi salvarea proiectului din Executie.jsx). Fără localitate / județ / diametru în BD:
// acelea rămân câmpuri de completat.
export const COLOANE_PROIECT_PV = 'id, cod_intern, nume, beneficiar, nr_contract, data_contract, sef_santier_employee_id, rte_employee_id'

/**
 * Citește proiectul și oamenii. Eroarea pe proiect = aruncă; eroarea pe oameni = avertisment (antetul merge mai departe).
 * `curent()` fals între pași (formular închis / alt proiect) = se oprește și întoarce null, fără a doua cerere.
 */
export async function incarcaDatePv(supabase, proiectId, curent = () => true) {
  const { data: proiect, error } = await supabase.from('executie_proiecte').select(COLOANE_PROIECT_PV).eq('id', proiectId).maybeSingle()
  if (!curent()) return null
  if (error) throw new Error(error.message || String(error))
  if (!proiect) throw new Error('Proiectul nu a putut fi citit.')
  const ids = [proiect.sef_santier_employee_id, proiect.rte_employee_id].filter(v => v != null)
  const angajati = {}
  let avertisment = null
  if (ids.length) {
    const { data, error: e2 } = await supabase.from('employees').select('id, name').in('id', ids)
    if (e2) avertisment = 'Numele șefului de șantier / RTE nu s-au putut citi (' + (e2.message || String(e2)) + '). Completează-le de mână.'
    else (data || []).forEach(x => { angajati[x.id] = x })
  }
  return { proiect, form: dateInitialePv({ proiect, angajati }), avertisment }
}

function Camp({ eticheta, valoare, onChange, tip = 'text', placeholder, rows, nume }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={S.eticheta}>{eticheta}</span>
      {rows
        ? <textarea data-camp={nume} rows={rows} value={valoare} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={{ ...S.input, resize: 'vertical', fontFamily: 'inherit' }} />
        : <input data-camp={nume} type={tip} value={valoare} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={S.input} />}
    </label>
  )
}

export default function PvCuplareGenerator({ supabase, proiectId, proiect }) {
  const [deschis, setDeschis] = useState(false)
  const [stare, setStare] = useState(null)   // { tip: 'incarcare' | 'eroare' | 'gata', text?, avertisment? }
  const [form, setForm] = useState(null)
  const [descarcare, setDescarcare] = useState(null)   // { tip: 'lucru' | 'ok' | 'eroare', text }
  const generatie = useRef(0)

  // proiect nou sau demontare: deschiderile vechi nu mai au voie să scrie în formular
  useEffect(() => {
    generatie.current++
    setDeschis(false); setStare(null); setForm(null); setDescarcare(null)
    return () => { generatie.current++ }
  }, [proiectId])

  const deschide = async () => {
    const g = ++generatie.current
    const pid = proiectId
    setDeschis(true); setForm(null); setDescarcare(null); setStare({ tip: 'incarcare' })
    try {
      const r = await incarcaDatePv(supabase, pid, () => g === generatie.current)
      if (!r || g !== generatie.current) return
      if (String(r.proiect.id) !== String(pid)) throw new Error('Răspunsul nu corespunde proiectului deschis.')
      setForm(r.form); setStare({ tip: 'gata', avertisment: r.avertisment })
    } catch (e) {
      if (g !== generatie.current) return
      setStare({ tip: 'eroare', text: 'Datele proiectului nu s-au putut citi: ' + (e?.message || String(e)) })
    }
  }
  const inchide = () => { generatie.current++; setDeschis(false); setStare(null); setForm(null); setDescarcare(null) }

  const set = (k, v) => setForm(f => (f ? { ...f, [k]: v } : f))
  const setParticipant = (i, k, v) => setForm(f => (f ? { ...f, participanti: f.participanti.map((p, j) => (j === i ? { ...p, [k]: v } : p)) } : f))
  const adaugaParticipant = () => setForm(f => (f ? { ...f, participanti: [...f.participanti, { calitate: '', nume: '' }] } : f))
  const stergeParticipant = i => setForm(f => (f ? { ...f, participanti: f.participanti.filter((_, j) => j !== i) } : f))

  const descarca = async () => {
    if (!form) return
    const g = generatie.current
    setDescarcare({ tip: 'lucru', text: 'Se pregătește documentul…' })
    try {
      const nume = numeFisierPv(form.cod_intern, form.data_cuplarii)
      const blob = await blobDocx(construiestePvCuplare(form))
      if (g !== generatie.current) return   // formularul s-a închis / alt proiect între timp: nu mai descarcă
      descarcaBlob(blob, nume)
      setDescarcare({ tip: 'ok', text: `✓ ${nume}` })
    } catch (e) {
      if (g !== generatie.current) return
      setDescarcare({ tip: 'eroare', text: 'Documentul nu s-a putut genera: ' + (e?.message || String(e)) })
    }
  }

  // butonul apare doar când proiectul încărcat în pagină e chiar proiectul curent
  if (!proiect || String(proiect.id) !== String(proiectId)) return null
  const lucreaza = descarcare?.tip === 'lucru'
  const culoare = { lucru: C.muted, ok: C.green, eroare: C.red }

  return (
    <div style={{ padding: '14px 28px 0' }}>
      <button data-pv-cuplare onClick={deschide} style={S.buton}
        title="Proces-verbal de predare-primire a conductei în vederea cuplării, în Word. Orele se scriu de mână pe șantier.">
        📄 PV predare conductă pentru cuplare
      </button>

      {deschis && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto' }}
          onClick={e => e.target === e.currentTarget && inchide()}>
          <div data-pv-cuplare-modal style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, width: '100%', maxWidth: 760, padding: '18px 22px', color: C.text }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>📄 PV predare-primire conductă pentru cuplare</div>
              <button onClick={inchide} style={{ ...S.buton, color: C.muted }}>✕ Închide</button>
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
              Antetul e completat din proiect. Câmpurile goale ies în document ca linii de completat de mână.
              Orele efective (predare, repredare, fiecare operațiune) nu se completează aici: se scriu pe loc, pe hârtie.
            </div>

            {stare?.tip === 'incarcare' && <div role="status" style={{ fontSize: 13, color: C.muted, padding: '12px 0' }}>Se încarcă datele proiectului…</div>}
            {stare?.tip === 'eroare' && (
              <div role="alert" style={{ fontSize: 13, color: C.red, padding: '12px 0' }}>
                {stare.text} <button onClick={deschide} style={{ ...S.buton, marginLeft: 8 }}>Reîncearcă</button>
              </div>
            )}

            {stare?.tip === 'gata' && form && (
              <div>
                {stare.avertisment && <div role="alert" data-pv-avertisment style={{ fontSize: 12, color: C.yellow, margin: '6px 0' }}>⚠️ {stare.avertisment}</div>}

                <div style={S.sectiune}>Antet</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Camp nume="nr_pv" eticheta="Nr. PV" valoare={form.nr_pv} onChange={v => set('nr_pv', v)} placeholder="gol = linie" />
                  <Camp nume="data_cuplarii" eticheta="Data cuplării" tip="date" valoare={form.data_cuplarii} onChange={v => set('data_cuplarii', v)} />
                </div>
                <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                  <Camp nume="obiectiv" eticheta="Obiectiv" valoare={form.obiectiv} onChange={v => set('obiectiv', v)} rows={2} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Camp nume="contract" eticheta="Contract" valoare={form.contract} onChange={v => set('contract', v)} placeholder="ex. nr. 21 din 12.01.2026" />
                    <Camp nume="beneficiar" eticheta="Beneficiar" valoare={form.beneficiar} onChange={v => set('beneficiar', v)} />
                  </div>
                  <Camp nume="executant" eticheta="Executant (la asociere: lider + asociat)" valoare={form.executant} onChange={v => set('executant', v)} />
                  <div>
                    <Camp nume="locul" eticheta="Locul (localitate, județ)" valoare={form.locul} onChange={v => set('locul', v)} />
                    {proiect.site_name && !form.locul && (
                      <button data-pv-preia-santier onClick={() => set('locul', String(proiect.site_name))} style={{ ...S.buton, fontSize: 11, marginTop: 4, padding: '2px 8px' }}>
                        Preia numele șantierului: {proiect.site_name}
                      </button>
                    )}
                  </div>
                </div>

                <div style={S.sectiune}>Programul comunicat de beneficiar</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <Camp nume="sursa_program" eticheta="Sursa programului" valoare={form.sursa_program} onChange={v => set('sursa_program', v)} placeholder="ex. e-mail Sucursala Mediaș din 19.11.2026" />
                  <Camp nume="intervale" eticheta="Intervale programate (unul pe rând)" valoare={form.intervale} onChange={v => set('intervale', v)} rows={3}
                    placeholder={'ex. punere în siguranță 08:00–09:30\nextragere obturatoare 16:00–17:00'} />
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                    <Camp nume="srm" eticheta="SRM / stația afectată" valoare={form.srm} onChange={v => set('srm', v)} placeholder="ex. SRM Domnești AG (SM1104D0)" />
                    <Camp nume="diametru" eticheta="Diametrul conductei" valoare={form.diametru} onChange={v => set('diametru', v)} placeholder="ex. 300 → Dn 300" />
                    <Camp nume="exemplare" eticheta="Nr. exemplare" tip="number" valoare={form.exemplare} onChange={v => set('exemplare', v)} placeholder="gol = linie" />
                  </div>
                </div>

                <div style={S.sectiune}>Participanți</div>
                {form.participanti.map((p, i) => (
                  <div key={i} data-pv-participant style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr auto', gap: 8, marginBottom: 6 }}>
                    <input aria-label="Calitatea" value={p.calitate} onChange={e => setParticipant(i, 'calitate', e.target.value)} style={S.input} />
                    <input aria-label="Numele și prenumele" value={p.nume} placeholder="gol = de completat de mână" onChange={e => setParticipant(i, 'nume', e.target.value)} style={S.input} />
                    <button data-pv-sterge-participant onClick={() => stergeParticipant(i)} title="Șterge rândul" style={{ ...S.buton, color: C.red }}>✕</button>
                  </div>
                ))}
                <button data-pv-adauga-participant onClick={adaugaParticipant} style={{ ...S.buton, fontSize: 11 }}>+ Adaugă participant</button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                  <button data-pv-descarca onClick={descarca} disabled={lucreaza}
                    style={{ background: C.greenBg, border: 'none', borderRadius: 6, color: '#fff', cursor: lucreaza ? 'wait' : 'pointer', fontSize: 13, fontWeight: 700, padding: '8px 16px' }}>
                    ⬇️ Descarcă Word
                  </button>
                  {descarcare && <span role={descarcare.tip === 'eroare' ? 'alert' : 'status'} style={{ fontSize: 12, color: culoare[descarcare.tip] }}>{descarcare.text}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
