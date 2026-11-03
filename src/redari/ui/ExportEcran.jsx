import React, { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx-js-style'
import { supabase } from '../../lib/supabase.js'
import { descarcaBlob } from '../docx.js'
import { randuriRegistru, foaieCentralizator, construiesteWorkbook, numeFisier } from '../exportXlsx.js'
import { S, msgEroare } from './comune.jsx'
import { COL_PLIC_AR, atasezaMentiuniAr } from '../arMentiune.js'

// Views without id use their unique composite key; no offset truncation at max-rows.
export async function paginiExport(fabrica, chei, curent) {
  const tot = [], vazute = new Set()
  let ultim
  while (curent()) {
    let q = fabrica()
    for (const k of chei) q = q.order(k)
    if (ultim) q = q.or(chei.map((k, i) => {
      const filtre = chei.slice(0, i).map(c => `${c}.eq.${JSON.stringify(ultim[c])}`)
      filtre.push(`${k}.gt.${JSON.stringify(ultim[k])}`)
      return filtre.length === 1 ? filtre[0] : `and(${filtre.join(',')})`
    }).join(','))
    const { data, error } = await q.range(0, 499)
    if (error) throw error
    if (!curent()) throw new Error('Export abandonat: proiectul s-a schimbat.')
    if (!Array.isArray(data)) throw new Error('Citire incompleta: lipseste lista.')
    if (!data.length) return tot
    for (const r of data) {
      const k = JSON.stringify(chei.map(c => r[c]))
      if (chei.some(c => r[c] == null) || vazute.has(k)) throw new Error('Paginarea nu a avansat sau contine duplicate.')
      vazute.add(k)
    }
    tot.push(...data); ultim = data.at(-1)
  }
  throw new Error('Export abandonat.')
}

async function inLoturi(fabrica, coloana, ids, chei, curent) {
  const lista = [...new Set(ids.filter(Boolean))], tot = []
  for (let i = 0; i < lista.length; i += 100) {
    if (!curent()) throw new Error('Export abandonat.')
    tot.push(...await paginiExport(() => fabrica().in(coloana, lista.slice(i, i + 100)), chei, curent))
  }
  return tot
}

export async function citesteDateExport(client, proiectId, tip, curent) {
  const uats = await paginiExport(() => client.from('red_uat').select('id,nume,afisare_pv_nr,responsabil_id').eq('proiect_id', proiectId), ['id'], curent)
  const agregate = await paginiExport(() => client.from('red_v_centralizator_uat').select('uat_id,stare,numar').eq('proiect_id', proiectId).not('stare', 'is', null), ['uat_id', 'stare'], curent)
  const centralizator = foaieCentralizator(agregate, uats)
  if (tip === 'centralizator') return { centralizator, numar: agregate.reduce((n, r) => n + Number(r.numar), 0) }
  const parcele = await paginiExport(() => client.from('red_v_parcele')
    .select('id,uat_id,id_parcela,tronson,sat,tarla,nr_cadastral,poz_hg,suprafata_temporara_mp,categoria_folosinta,observatii')
    .eq('proiect_id', proiectId).is('sters_la', null), ['id'], curent)
  const detinatori = await inLoturi(() => client.from('red_detinatori').select('id,parcela_id,nume,calitate,cota,sursa_date,versiune_lista_tgz').is('sters_la', null), 'parcela_id', parcele.map(p => p.id), ['id'], curent)
  const ids = detinatori.map(d => d.id)
  const contacte = await inLoturi(() => client.from('red_detinatori_contact').select(tip === 'TGZ' ? 'detinator_id,adresa_cunoscuta' : 'detinator_id,adresa_cunoscuta,telefon'), 'detinator_id', ids, ['detinator_id'], curent)
  const convocariBrute = await inLoturi(() => client.from('red_convocari').select('id,detinator_id,plic_id,nr_document,data_expediere,nr_tracking,data_confirmare_primire,retur,stare,sters_la,created_at').eq('stare','activ').is('sters_la', null), 'detinator_id', ids, ['id'], curent)
  // juridic#021: mențiunea „primit de altă persoană” de pe plic
  const plicuriAr = await inLoturi(() => client.from('red_plicuri').select(COL_PLIC_AR), 'id', convocariBrute.map(c => c.plic_id), ['id'], curent)
  const convocari = atasezaMentiuniAr(convocariBrute, plicuriAr)
  const raspunsuri = await inLoturi(() => client.from('red_raspunsuri').select('id,detinator_id,canal,data,optiune,zi_sesiune_aleasa,obiectii_text,created_at,seq'), 'detinator_id', ids, ['id'], curent)
  const pvs = await inLoturi(() => client.from('red_procese_verbale').select('id,tip,parcela_id,detinator_id,nr_pv,data_pv,obiectii_redare,termen_remediere,remediat_la,trimis_spre_semnare_data,semnat_primit_data,stare,sters_la,created_at').is('sters_la', null).neq('stare','anulat'), 'parcela_id', parcele.map(p => p.id), ['id'], curent)
  const stari = await inLoturi(() => client.from('red_v_stare_parcela').select('parcela_id,detinator_id,stare').eq('proiect_id', proiectId), 'parcela_id', parcele.map(p => p.id), ['parcela_id', 'detinator_id'], curent)
  const responsabili = await inLoturi(() => client.from('profiles').select('id,name'), 'id', uats.map(u => u.responsabil_id), ['id'], curent)
  const peId = randuri => new Map(randuri.map(r => [r.id, r]))
  const ps = peId(parcele), us = peId(uats), rs = peId(responsabili)
  const cs = new Map(contacte.map(c => [c.detinator_id, c]))
  const ss = new Map(stari.map(s => [`${s.parcela_id}/${s.detinator_id}`, s.stare]))
  const grupeaza = (randuri, cheie) => {
    const m = new Map()
    for (const r of randuri) { if (!m.has(r[cheie])) m.set(r[cheie], []); m.get(r[cheie]).push(r) }
    return m
  }
  const conv = grupeaza(convocari, 'detinator_id'), rasp = grupeaza(raspunsuri, 'detinator_id'), pv = grupeaza(pvs, 'parcela_id')
  const date = detinatori.map(detinator => {
    const parcela = ps.get(detinator.parcela_id), uat = us.get(parcela.uat_id)
    const stare = ss.get(`${parcela.id}/${detinator.id}`)
    if (!uat || !stare) throw new Error('Export incomplet: lipseste UAT sau starea unei perechi. Reincercati.')
    if (uat.responsabil_id && !rs.has(uat.responsabil_id)) throw new Error('Responsabilul UAT nu poate fi citit.')
    return { parcela, uat, detinator, contact: cs.get(detinator.id), convocari: conv.get(detinator.id), raspunsuri: rasp.get(detinator.id), pvs: pv.get(parcela.id), stare, responsabil: rs.get(uat.responsabil_id) }
  })
  const registru = randuriRegistru(date, { pentruTgz: tip === 'TGZ' })
  // Copilot f6 r1 P2-01: distributia (UAT, stare) a randurilor exportate trebuie sa fie identica cu centralizatorul citit,
  // altfel cele doua foi s-ar contrazice (o stare schimbata in timpul exportului) -> refuz, se reia.
  const distributie = m => [...m].sort().join('|')
  const dinRegistru = new Map(), dinVedere = new Map()
  for (const d of date) { const k = d.uat.id + '/' + d.stare; dinRegistru.set(k, (dinRegistru.get(k) || 0) + 1) }
  for (const r of agregate) { const k = r.uat_id + '/' + r.stare; dinVedere.set(k, (dinVedere.get(k) || 0) + Number(r.numar)) }
  if (registru.length !== date.length || distributie(dinRegistru) !== distributie(dinVedere)) throw new Error('Sursele s-au schimbat in timpul exportului sau exportul este incomplet. Reincercati.')
  return { registru, centralizator, numar: registru.length }
}

export default function ExportEcran({ proiect }) {
  const [nivel, setNivel] = useState(null), [lucru, setLucru] = useState(false), [mesaj, setMesaj] = useState('')
  const generatie = useRef(0), ocupat = useRef(false)
  useEffect(() => {
    const token = ++generatie.current, curent = () => generatie.current === token
    setNivel(null); setLucru(false); setMesaj(''); ocupat.current = false
    ;(async () => {
      const { data: auth, error } = await supabase.auth.getUser()
      if (error) throw error
      if (!curent() || !auth?.user) return
      const profil = await supabase.from('profiles').select('id,is_owner').eq('id', auth.user.id).maybeSingle()
      if (profil.error) throw profil.error
      if (!curent()) return
      const acces = await supabase.from('user_module_access').select('access_level').eq('profile_id', auth.user.id).eq('module', 'redari')
      if (acces.error) throw acces.error
      if (curent()) setNivel(profil.data?.is_owner ? 'admin' : acces.data?.[0]?.access_level ?? null)
    })().catch(e => { if (curent()) setMesaj(msgEroare(e)) })
    return () => { generatie.current++ }
  }, [proiect.id])
  const poateRegistru = nivel === 'admin' || nivel === 'editor'
  async function exporta(tip) {
    if (ocupat.current || !['admin','editor','viewer'].includes(nivel) || (tip !== 'centralizator' && !poateRegistru)) return
    ocupat.current = true; setLucru(true); setMesaj('')
    const token = generatie.current, id = proiect.id, curent = () => token === generatie.current
    try {
      const fisier = numeFisier({ proiectCod: proiect.cod, tip })
      const date = await citesteDateExport(supabase, id, tip, curent)
      if (!curent()) return
      const wb = construiesteWorkbook({ ...date, pentruTgz: tip === 'TGZ' })
      const continut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      if (!curent()) return
      descarcaBlob(new Blob([continut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fisier)
      setMesaj(`${date.numar} rânduri exportate.`)
    } catch (e) { if (curent()) setMesaj(msgEroare(e)) }
    finally { if (curent()) { ocupat.current = false; setLucru(false) } }
  }
  return <div style={{ marginTop: 16 }}>
    {poateRegistru && <>
      <button style={S.btnS} disabled={lucru} onClick={() => exporta('intern')}>📥 Registru intern (xlsx)</button>{' '}
      <button style={S.btnS} disabled={lucru} onClick={() => exporta('TGZ')}>📤 Registru pentru TGZ — fără telefoane (xlsx)</button>{' '}
    </>}
    <button style={S.btnS} disabled={lucru || !['admin','editor','viewer'].includes(nivel)} onClick={() => exporta('centralizator')}>📊 Centralizator (xlsx)</button>
    {lucru && <p role="status">Se pregătește exportul...</p>}
    {mesaj && <p role="status">{mesaj}</p>}
  </div>
}
