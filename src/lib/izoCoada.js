// E4: reducer pur + adaptoare IO. Cererea trimisă nu se modifică la retry.
const copie = x => structuredClone(x)
export const uuid = () => globalThis.crypto.randomUUID()
const finale = new Set(['acceptat', 'conflict', 'eroare', 'eroare_interna', 'conflict_op'])
const oprire = new Set(['alt_dispozitiv', 'front_expirat', 'fara_drept', 'limita'])
export const stareInitiala = device => ({ device, seq: 0, ops: [], arhiva: [], snapshots: {}, local: {}, pauza: null })

export function adaugaOperatii(stare, cereri, id = uuid, acum = () => new Date().toISOString()) {
  const s = copie(stare)
  for (const { tip_op, payload } of cereri) {
    if (!['sesiune_deschide', 'decl_salveaza', 'decl_sterge', 'sesiune_trimite'].includes(tip_op)) throw Error('tip_op invalid')
    if (!payload.proiect_id || !payload.tronson_id) throw Error('Lipsește proiectul / tronsonul')
    s.ops.push({ cerere: { op_id: id(), seq: ++s.seq, tip_op, payload: copie(payload), versiune_format: 1, ora_tableta: acum() }, stare: 'pe_tableta' })
    if (new TextEncoder().encode(JSON.stringify(s.ops.at(-1).cerere)).length > 220000) throw Error('Operația depășește limita lotului; nu a fost salvată')
  }
  return s
}

export function aplicaRaspuns(stare, lot, raspuns) {
  const s = copie(stare)
  // Un răspuns fără rezultate nu dovedește un ACK individual, nici la eroare de lot.
  for (const req of lot) {
    const op = s.ops.find(o => o.cerere.op_id === req.op_id)
    if (!op) continue
    const r = raspuns?.rezultate?.find(x => x.op_id === req.op_id)
    if (!r) {
      op.rezultat = { cod: raspuns?.cod === 'ok' ? 'reincearca' : raspuns?.cod || 'reincearca', motiv: raspuns?.motiv }
      if (oprire.has(op.rezultat.cod)) s.pauza = op.rezultat.cod
      if (finale.has(raspuns?.cod)) s.pauza = 'eroare_lot'
      continue
    }
    const ack = r.cod === 'duplicat' ? r.raspuns : r
    if (!ack || !finale.has(ack.cod)) {
      op.rezultat = copie(ack || { cod: 'reincearca' })
      if (oprire.has(ack?.cod)) s.pauza = ack.cod
      continue
    }
    s.arhiva.push({ ...op, stare: 'confirmata', rezultat: copie(ack), ack: copie(r), de_verificat: ack.cod !== 'acceptat' || ['conflict', 'blocata'].includes(ack.stare) })
    s.ops = s.ops.filter(x => x.cerere.op_id !== req.op_id)
  }
  return s
}

export function urmatorulLot(s) {
  const first = s.ops[0]?.cerere
  if (!first || s.pauza) return []
  const lot = []
  for (const o of s.ops) {
    const r = o.cerere
    if (r.payload.proiect_id !== first.payload.proiect_id || r.payload.tronson_id !== first.payload.tronson_id || lot.length === 50) break
    // Marjă pentru serializarea jsonb de pe server (256 KB).
    if (new TextEncoder().encode(JSON.stringify([...lot, r])).length > 220000) break
    lot.push(copie(r))
  }
  return lot
}

export function memorie(initial = null) {
  let value = initial && copie(initial)
  return { durabil: false, read: async () => value && copie(value), write: async s => { value = copie(s) } }
}

export async function stocareBrowser(nume) {
  try {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(nume, 1)
      r.onupgradeneeded = () => r.result.createObjectStore('stare')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
      r.onblocked = () => reject(Error('IndexedDB blocat'))
    })
    const tx = (mode, value) => new Promise((resolve, reject) => {
      const t = db.transaction('stare', mode)
      const r = mode === 'readonly' ? t.objectStore('stare').get('curenta') : t.objectStore('stare').put(value, 'curenta')
      t.oncomplete = () => resolve(r.result)
      t.onerror = t.onabort = () => reject(t.error || Error('Stocarea locală a eșuat'))
    })
    const store = { durabil: true, read: () => tx('readonly'), write: s => tx('readwrite', s) }
    await store.read()
    return store
  } catch { return memorie() }
}

export function creeazaCoada({ storage, rpc, refresh = async () => {}, id = uuid, lock = async f => f() }) {
  let serie = Promise.resolve()
  const exclusiv = f => {
    const p = serie.then(() => lock(async () => {
      const existing = await storage.read()
      const s = existing || stareInitiala(id())
      return f(s, Boolean(existing))
    }))
    serie = p.catch(() => {})
    return p
  }
  const salveaza = async s => { await storage.write(s); return copie(s) }
  const apel = async (name, args) => {
    const { data, error } = await rpc(name, args)
    if (error) throw Error(error.message || 'Eroare RPC')
    return data
  }
  return {
    durabil: storage.durabil,
    citeste: () => exclusiv((s, existing) => existing ? copie(s) : salveaza(s)),
    adauga: cereri => exclusiv(s => salveaza(adaugaOperatii(s, cereri, id))),
    local: (key, value) => exclusiv(s => { s.local[key] = copie(value); return salveaza(s) }),
    snapshot: (proiect, tronson, pregateste = false) => exclusiv(async s => {
      await refresh()
      const doc = await apel(pregateste ? 'fn_izo_teren_pregateste' : 'fn_izo_teren_instantaneu', {
        p_proiect: proiect, p_tronson: tronson, ...(pregateste ? { p_dispozitiv: s.device } : {}),
      })
      if (!doc?.snapshot_id || !doc.checksum || doc.proiect_id !== proiect || doc.tronson_id !== tronson) throw Error(doc?.cod || 'Instantaneu invalid')
      s.snapshots[tronson] = { ...doc, salvat_la: new Date().toISOString() }
      if (pregateste) s.pauza = null
      return salveaza(s)
    }),
    sync: () => exclusiv(async s => {
      const lot = urmatorulLot(s)
      if (!lot.length) return copie(s)
      await refresh()
      for (const o of s.ops) if (lot.some(r => r.op_id === o.cerere.op_id)) o.stare = 'trimisa'
      // Persistăm înainte de rețea; la crash / ACK pierdut repetăm exact cererea.
      await salveaza(s)
      const r = await apel('fn_izo_sync_push', { p_dispozitiv: s.device, p_ops: lot })
      return salveaza(aplicaRaspuns(s, lot, r))
    }),
    retrage: opId => exclusiv(s => {
      const o = s.ops.find(x => x.cerere.op_id === opId)
      if (!o || o.stare !== 'pe_tableta') throw Error('Operația a plecat deja; cere revizie')
      if (s.ops.some(x => x.cerere.payload.depinde_de_uid === o.cerere.payload.uid || x.cerere.payload.preverificare_uid === o.cerere.payload.uid)) throw Error('Operația are dependențe')
      s.ops = s.ops.filter(x => x !== o)
      return salveaza(s)
    }),
  }
}
