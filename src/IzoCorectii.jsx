import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { activa, responsabil, propune, actiuni, pagini, mesajCorectie, lipsaCorectii, TIPURI_CORECTII, serieCautare, diferenteDocument } from './izoCorectiiLogica.js'
import { S, G, Camp, Modal, Comparatie, Verificare } from './izoCorectiiUI.jsx'
import IzoCorectieModal from './IzoCorectieModal.jsx'

export default function IzoCorectii() {
  const [ctx, setCtx] = useState(null), [err, setErr] = useState(''), [pid, setPid] = useState('')
  useEffect(() => { let activ = true; (async () => {
    try {
      const { data:{ user }, error } = await supabase.auth.getUser(); if (error) throw error
      if (!user) throw new Error('Nu ești autentificat.')
      const rr = await Promise.all([
        supabase.from('profiles').select('is_owner').eq('id', user.id).maybeSingle(),
        supabase.from('user_module_access').select('access_level').eq('profile_id', user.id).eq('module', 'magazie').maybeSingle(),
        pagini(() => supabase.from('izo_atribuiri').select('id, proiect_id, depozit_id, rol, activ, valabil_de, valabil_pana').eq('profile_id', user.id).eq('activ', true)),
        pagini(() => supabase.from('executie_proiecte').select('id, nume, site_id')),
        pagini(() => supabase.from('logistica_depozite').select('id, name, site_id, activ')),
      ])
      for (const r of rr.slice(0, 2)) if (r.error) throw r.error
      const eu = { id:user.id, owner:!!rr[0].data?.is_owner, nivelMagazie:rr[1].data?.access_level, atribuiri:rr[2].filter(a => activa(a)) }
      const proiecte = rr[3].filter(p => eu.owner || eu.atribuiri.some(a => String(a.proiect_id) === String(p.id)))
      if (activ) { setCtx({ eu, proiecte, depozite:rr[4] }); setPid(String(proiecte[0]?.id || '')) }
    } catch (e) { if (activ) setErr(mesajCorectie(e)) }
  })(); return () => { activ = false } }, [])
  if (err) return <div role="alert" style={S.card}>{err}</div>
  if (!ctx) return <div style={S.card}>Se încarcă…</div>
  return <div style={{ color:G.text }}><Camp nume="Proiect"><select style={{ ...S.input, maxWidth:450 }} value={pid} onChange={e => setPid(e.target.value)}>{ctx.proiecte.map(p => <option key={p.id} value={p.id}>{p.nume}</option>)}</select></Camp>{pid ? <Proiect key={pid} pid={Number(pid)} ctx={ctx} /> : <p>Niciun proiect accesibil.</p>}</div>
}

function Proiect({ pid, ctx:{ eu, proiecte, depozite } }) {
  const [coada, setCoada] = useState([]), [stare, setStare] = useState('propusa'), [msg, flash] = useState(''), [err, setErr] = useState('')
  const [busy, setBusy] = useState(false), [cauta, setCauta] = useState(''), [bucati, setBucati] = useState([]), [b, setB] = useState(null), [tip, setTip] = useState(null)
  const [decizie, setDecizie] = useState(null), [motiv, setMotiv] = useState(''), [v, setV] = useState(null)
  const [eroareDecizie, setEroareDecizie] = useState('')
  const [piese, setPiese] = useState({}), [persoane, setPersoane] = useState({})
  const generatie = useRef(0), lock = useRef(false), cautare = useRef(0)
  const deps = depozite.filter(d => d.activ && d.site_id === proiecte.find(p => p.id === pid)?.site_id)
  const incarca = useCallback(async () => {
    const n = ++generatie.current; setErr(''); setBusy(true)
    try {
      const rows = await pagini(() => supabase.from('izo_corectii').select('*').eq('proiect_id', pid).eq('stare', stare))
      const ids = [...new Set(rows.map(c => c.bucata_id).filter(Boolean))], uids = [...new Set(rows.map(c => c.propus_de))]
      const pieseNoi = {}, persoaneNoi = {}
      for (let i = 0; i < ids.length; i += 100) {
        const r = await pagini(() => supabase.from('magazie_bucati').select('id, serie, sarja').eq('proiect_id', pid).in('id', ids.slice(i, i + 100)))
        for (const b of r) pieseNoi[b.id] = b
      }
      for (let i = 0; i < uids.length; i += 100) {
        const r = await pagini(() => supabase.from('profiles').select('id, name').in('id', uids.slice(i, i + 100)))
        for (const p of r) persoaneNoi[p.id] = p.name
      }
      if (n === generatie.current) { setCoada(rows.reverse()); setPiese(pieseNoi); setPersoane(persoaneNoi) }
    } catch (e) { if (n === generatie.current) { setCoada([]); setErr(lipsaCorectii(e) ? 'Modulul E3b este în pregătire. ' + mesajCorectie(e) : mesajCorectie(e)) } }
    finally { if (n === generatie.current) setBusy(false) }
  }, [pid, stare])
  useEffect(() => { incarca(); return () => { ++generatie.current; ++cautare.current } }, [incarca])
  async function cautaBucati() {
    const n = ++cautare.current; setB(null); setBucati([]); setErr('')
    try {
      if (!cauta.trim()) throw new Error('Introdu seria exactă.')
      const rows = await pagini(() => supabase.from('magazie_bucati').select('*').eq('proiect_id', pid).eq('provenienta', 'beneficiar').in('tip_cod', ['teava', 'curba']).eq('serie_canon', serieCautare(cauta)))
      if (n === cautare.current) { setBucati(rows); if (!rows.length) flash('Nicio bucată găsită pentru această serie.') }
    } catch (e) { if (n === cautare.current) setErr(mesajCorectie(e)) }
  }
  async function alegeBucata(x) {
    const n = ++cautare.current; setB(null)
    try {
      const doc = x.aviz_intrare_id ? await supabase.from('izo_documente_intrare').select('eveniment_pv_id').eq('id', x.aviz_intrare_id).single() : null
      if (doc?.error) throw doc.error
      const miscari = await pagini(() => supabase.from('magazie_bucati_miscari').select('*').eq('bucata_id', x.id))
      const ids = [...new Set(miscari.map(m => m.eveniment_id))], evenimente = {}
      for (let i = 0; i < ids.length; i += 100) {
        const rr = await pagini(() => supabase.from('magazie_bucati_evenimente').select('*').eq('proiect_id', pid).in('id', ids.slice(i, i + 100)))
        for (const ev of rr) evenimente[ev.id] = ev
      }
      const corectii = await pagini(() => supabase.from('izo_corectii').select('id, eveniment_id, ncr_ref').eq('proiect_id', pid).eq('bucata_id', x.id))
      const randuri = x.aviz_intrare_id ? await pagini(() => supabase.from('izo_documente_intrare_randuri').select('*').eq('document_id', x.aviz_intrare_id).eq('bucata_id', x.id)) : []
      if (n === cautare.current) setB({ ...x, faraPv:!!doc && !doc.data.eveniment_pv_id, miscari, evenimente, corectii, diferente:diferenteDocument(x, randuri[0]) })
    } catch (e) { if (n === cautare.current) setErr(mesajCorectie(e)) }
  }
  async function reincarca() { setB(null); setBucati([]); await incarca() }
  async function act(c, op, aplica = false) {
    if (lock.current) return
    lock.current = true; setBusy(true); setErr(''); setEroareDecizie('')
    try {
      if (!aplica) {
        setDecizie({ c, op }); setMotiv(''); setV(null)
        if (op === 'aproba') {
          const { data, error } = await supabase.rpc('fn_izo_cor_verifica', { p_corectie_id:c.id, p_tip:null, p_proiect:null, p_bucata_id:null, p_detalii:null })
          if (error) throw error
          setV(data)
        }
        return
      }
      if (op !== 'aproba' && (motiv.trim().length < 3 || motiv.trim().length > 1000)) throw new Error('Motiv obligatoriu: 3–1000 de caractere.')
      if (op === 'aproba' && (!v?.ok || v.blocante?.length || String(v.versiune) !== String(c.versiune))) throw new Error('Propunerea trebuie reverificată pe versiunea curentă.')
      const { data, error } = await supabase.rpc('fn_izo_cor_' + op, { p_corectie_id:c.id, p_versiune:c.versiune, ...(op === 'aproba' ? {} : { p_motiv:motiv.trim() }) })
      if (error) throw error
      flash(`Corecția #${data.corectie_id}: ${data.stare || data.stare_dupa || 'aplicată'}.`); setDecizie(null); await reincarca()
    } catch (e) { setEroareDecizie(mesajCorectie(e)); flash(mesajCorectie(e)); if (e.code === '40001') { setDecizie(null); await reincarca() } }
    finally { lock.current = false; setBusy(false) }
  }
  const poate = b && propune(eu, pid, b.tronson_id ? b.atribute?.depozit_origine_id : b.depozit_id)
  return <>
    <div style={S.card}><select aria-label="Stare corecții" style={{ ...S.input, width:180 }} disabled={busy} value={stare} onChange={e => { setStare(e.target.value); setDecizie(null) }}>{['propusa', 'aplicata', 'respinsa', 'retrasa'].map(x => <option key={x}>{x}</option>)}</select><button style={S.btn} disabled={busy} onClick={incarca}>Reîncarcă</button>{deps.some(d => propune(eu, pid, d.id)) && <button style={S.btn} disabled={busy} onClick={() => { setB(null); setTip('gasit_nou') }}>＋ Găsit nou</button>}</div>
    {msg && <div role="status" style={S.card}>{msg}</div>}{err && <div role="alert" style={{ ...S.card, color:G.red }}>{err}</div>}
    <div style={S.card}><h3>Propuneri / corecții {busy && '…'}</h3>{!coada.length && !busy && <p>Nicio corecție în această stare.</p>}{coada.map(c => { const a = actiuni(eu, pid, c); return <article key={c.id} style={S.card}><strong>#{c.id} · {TIPURI_CORECTII[c.tip] || c.tip} · {piese[c.bucata_id]?.serie || c.inainte?.serie || c.dupa?.serie || `Bucată #${c.bucata_id ?? 'nouă'}`} / {piese[c.bucata_id]?.sarja || c.inainte?.sarja || c.dupa?.sarja || '—'}</strong><p>Propus de {persoane[c.propus_de] || c.propus_de} · {c.propus_la && new Date(c.propus_la).toLocaleString('ro-RO')}</p><p>{c.motiv}{c.ncr_ref && ` · NCR ${c.ncr_ref}`}</p><Comparatie inainte={c.inainte} dupa={c.dupa} />{a.decide && <><button style={S.btn} disabled={busy} onClick={() => act(c, 'aproba')}>Aprobă</button><button style={S.btn} disabled={busy} onClick={() => act(c, 'respinge')}>Respinge</button></>}{a.retrage && <button style={S.btn} disabled={busy} onClick={() => act(c, 'retrage')}>Retrage</button>}{c.stare === 'propusa' && c.propus_de === eu.id && responsabil(eu, pid) && <small>Alt responsabil trebuie să decidă (patru ochi).</small>}</article> })}</div>
    <div style={S.card}><h3>Corecție pe bucată</h3><Camp nume="Seria exactă" value={cauta} onChange={x => { ++cautare.current; setCauta(x); setB(null); setBucati([]) }} /><button style={S.btn} onClick={cautaBucati}>Caută</button>{bucati.map(x => <button key={x.id} style={S.btn} onClick={() => alegeBucata(x)}>#{x.id} · {x.serie} / {x.sarja} · {x.stare}</button>)}
      {b && <div><h4>{b.serie} / {b.sarja} · {b.stare}</h4>{!!b.diferente.length && <p style={{ color:G.yellow }}>Diferă de documentul de intrare: {b.diferente.join(", ")}</p>}{b.faraPv && <p style={{ color:G.yellow }}>Pune întâi PV-ul. Operațiile de stare sunt oprite.</p>}{poate && <>{['carantina_intrare', 'carantina_iesire', 'pierdut', 'gasit_recuperare'].map(t => <button key={t} style={S.btn} disabled={b.faraPv || (t === 'carantina_intrare' ? !['sosit', 'receptionat'].includes(b.stare) || !!b.tronson_id : t === 'carantina_iesire' ? b.stare !== 'carantina' : t === 'gasit_recuperare' ? b.stare !== 'pierduta' : !['sosit', 'receptionat', 'carantina', 'pe_tronson'].includes(b.stare))} onClick={() => setTip(t)}>{TIPURI_CORECTII[t]}</button>)}<button style={S.btn} onClick={() => setTip('camp')}>Propune corecție identitate</button></>}{responsabil(eu, pid) && <button style={S.btn} onClick={() => setTip('direct')}>Corectează câmpuri</button>}<details><summary>Istoric mișcări</summary>{b.miscari.map(m => {
          const ev = b.evenimente[m.eveniment_id], cor = b.corectii.find(c => c.eveniment_id === m.eveniment_id)
          return <article key={m.id} style={S.card}>
            <strong>{ev?.tip || m.rol} · {ev?.ora_server && new Date(ev.ora_server).toLocaleString('ro-RO')}</strong>
            <p>Declarat: {ev?.declarat_de || '—'} · Aplicat: {ev?.aplicat_de || ev?.aplicat_rol || '—'}</p>
            <p>{ev?.motiv || 'Fără motiv în eveniment'}{cor?.ncr_ref && ' · NCR ' + cor.ncr_ref}</p>
            <p>{m.stare_inainte || '—'} → {m.stare_dupa || '—'}</p>
            <Comparatie inainte={m.inainte || m.din_loc} dupa={m.dupa || m.in_loc} />
          </article>
        })}</details></div>}
    </div>
    {tip && (tip === 'gasit_nou' || b) && <IzoCorectieModal key={tip + (b?.id || '')} tip={tip} bucata={tip === 'gasit_nou' ? null : b} proiectId={pid} depozite={tip === 'gasit_nou' ? deps.filter(d => propune(eu, pid, d.id)) : deps} inchide={() => setTip(null)} reincarca={reincarca} flash={flash} />}
    {decizie && <Modal titlu={decizie.op} busy={busy} inchide={() => setDecizie(null)}>
      <p>Corecția #{decizie.c.id} · {decizie.c.motiv}</p>
      {eroareDecizie && <p role="alert" style={{ color:G.red }}>{eroareDecizie}</p>}
      <Comparatie inainte={decizie.c.inainte} dupa={decizie.c.dupa} />
      {decizie.op === 'aproba' ? <Verificare v={v} /> : <Camp nume="Motiv obligatoriu" value={motiv} onChange={setMotiv} />}
      <button style={S.btn} disabled={busy || (decizie.op === 'aproba' ? !v?.ok || !!v.blocante?.length : motiv.trim().length < 3)} onClick={() => act(decizie.c, decizie.op, true)}>Confirmă {decizie.op}</button>
    </Modal>}
  </>
}
