// fals in-memory pentru supabase-js (doar ce folosesc edge-urile ofertare-seap-*)
export const db: Record<string, any[]> = { ofertare_licitatii: [], ofertare_documente_atribuire: [], ofertare_seap_manifest: [], notifications: [], profiles: [] }
export const storage = new Map<string, Uint8Array>()
export const jurnal: string[] = []
// E2: inserturi care eșuează pe tabel (mesajul erorii); gol = toate reușesc
export const esecInsert: Record<string, string> = {}
// Jakarinos r2: insert care cade daca lotul contine un anumit profil; citiri maybeSingle care cad (de n ori) pe tabel
export const esecInsertProfil: { id?: string } = {}
export const esecMaybe: Record<string, { mesaj: string, ori: number }> = {}
export const esecSelect: Record<string, { mesaj: string, ori: number }> = {}
let nextId = 10000
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const likeRe = (p: string, f = '') => new RegExp('^' + p.split('%').map(esc).join('.*') + '$', f)
const DUP = { code: '23505', message: 'duplicate key value violates unique constraint "ofertare_doc_seap_cod_unic"' }
class Q {
  t: string; op = 'select'; f: ((r: any) => boolean)[] = []; patch: any = null; rows: any[] | null = null; sel: string | null = null
  rng: [number, number] | null = null; lim: number | null = null; oc: string | null = null; modus = ''
  constructor(t: string) { this.t = t }
  select(c?: string) { this.sel = c ?? '*'; return this }
  eq(c: string, v: any) { this.f.push((r) => r[c] === v); return this }
  neq(c: string, v: any) { this.f.push((r) => r[c] !== v); return this }
  is(c: string, v: any) { this.f.push((r) => (r[c] ?? null) === v); return this }
  gte(c: string, v: any) { this.f.push((r) => r[c] >= v); return this }
  not(c: string, op: string, v: any) {
    if (op === 'is') this.f.push((r) => (r[c] ?? null) !== v)
    else if (op === 'like') this.f.push((r) => !likeRe(v).test(String(r[c] ?? '')))
    else if (op === 'ilike') this.f.push((r) => !likeRe(v, 'i').test(String(r[c] ?? '')))
    return this
  }
  like(c: string, p: string) { this.f.push((r) => likeRe(p).test(String(r[c] ?? ''))); return this }
  in(c: string, vs: any[]) { this.f.push((r) => vs.includes(r[c])); return this }
  or(expr: string) {
    const parts = expr.split(',')
    this.f.push((r) => parts.some((p) => { const [c, op, ...rest] = p.split('.'); const v = rest.join('.'); return op === 'is' ? (r[c] ?? null) === null : op === 'like' ? likeRe(v).test(String(r[c] ?? '')) : false }))
    return this
  }
  order() { return this }
  range(a: number, b: number) { this.rng = [a, b]; return this }
  limit(n: number) { this.lim = n; return this }
  update(p: any) { this.op = 'update'; this.patch = p; return this }
  insert(r: any) { this.op = 'insert'; this.rows = Array.isArray(r) ? r : [r]; return this }
  upsert(r: any, o?: any) { this.op = 'upsert'; this.rows = Array.isArray(r) ? r : [r]; this.oc = o?.onConflict ?? null; return this }
  delete() { this.op = 'delete'; return this }
  maybeSingle() { this.modus = 'maybe'; return this.exec() }
  single() { this.modus = 'single'; return this.exec() }
  then(res: any, rej: any) { return this.exec().then(res, rej) }
  ocupat(lic: any, cod: any, id: any) { return cod != null && (db[this.t] || []).some((x) => x.id !== id && x.licitatie_id === lic && x.seap_cod === cod) }
  async exec(): Promise<any> {
    const tab = db[this.t] ??= []
    const potr = () => tab.filter((r) => this.f.every((fn) => fn(r)))
    if (this.op === 'select') {
      if (this.modus !== 'maybe' && esecSelect[this.t]?.ori > 0) { esecSelect[this.t].ori--; return { data: null, error: { message: esecSelect[this.t].mesaj } } }
      let rows = potr()
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1)
      if (this.lim != null) rows = rows.slice(0, this.lim)
      rows = rows.map((r) => ({ ...r }))
      if (this.modus === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'not single' } }
      if (this.modus === 'maybe' && esecMaybe[this.t]?.ori > 0) { esecMaybe[this.t].ori--; return { data: null, error: { message: esecMaybe[this.t].mesaj } } }
      if (this.modus === 'maybe') return { data: rows[0] ?? null, error: null }
      return { data: rows, error: null }
    }
    if (this.op === 'update') {
      const rows = potr()
      if (this.t === 'ofertare_documente_atribuire' && 'seap_cod' in this.patch) for (const r of rows) if (this.ocupat(r.licitatie_id, this.patch.seap_cod, r.id)) return { data: null, error: DUP }
      for (const r of rows) Object.assign(r, structuredClone(this.patch))
      jurnal.push(`update ${this.t} ${rows.map((r) => r.id).join(',')} ${JSON.stringify(this.patch)}`)
      return { data: this.sel ? rows.map((r) => ({ id: r.id })) : null, error: null }
    }
    if (this.op === 'insert') {
      if (esecInsert[this.t]) return { data: null, error: { message: esecInsert[this.t] } }
      if (esecInsertProfil.id && this.rows!.some((r) => r.profile_id === esecInsertProfil.id)) return { data: null, error: { message: 'insert refuzat pentru ' + esecInsertProfil.id } }
      for (const r of this.rows!) if (this.t === 'ofertare_documente_atribuire' && this.ocupat(r.licitatie_id, r.seap_cod, null)) return { data: null, error: DUP }
      const noi = this.rows!.map((r) => ({ id: nextId++, ...structuredClone(r) }))
      tab.push(...noi)
      jurnal.push(`insert ${this.t} ${noi.map((r) => r.nume_original ?? r.cale ?? r.id).join(',')}`)
      const data = noi.map((r) => ({ id: r.id }))
      return this.modus ? { data: data[0], error: null } : { data, error: null }
    }
    if (this.op === 'upsert') {
      const k = (this.oc || 'id').split(',').map((s) => s.trim())
      for (const r of this.rows!) {
        const i = tab.findIndex((x) => k.every((c) => x[c] === r[c]))
        if (i >= 0) tab[i] = { ...tab[i], ...r }; else tab.push({ id: nextId++, ...r })
      }
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }
}
export function createClient(_u: string, _k: string) {
  return {
    from: (t: string) => new Q(t),
    rpc: async () => ({ data: false, error: null }),
    auth: { getUser: async () => ({ data: { user: null } }) },
    storage: {
      from: (_b: string) => ({
        upload: async (p: string, buf: Uint8Array, o?: any) => { if (storage.has(p) && !o?.upsert) return { error: { message: 'exists' } }; storage.set(p, buf); jurnal.push(`upload ${p}`); return { error: null } },
        download: async (p: string) => { jurnal.push(`download ${p}`); const b = storage.get(p); return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: 'not found' } } },
        remove: async (ps: string[]) => { for (const p of ps) storage.delete(p); jurnal.push(`remove ${ps.join(',')}`); return { error: null } },
        list: async () => ({ data: [], error: null }),
      }),
    },
  }
}
