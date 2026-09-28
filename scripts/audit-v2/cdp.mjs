// Driver CDP nativ Node >=22. Nicio parolă și niciun corp HTTP în jurnal.
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export function urlSigur(raw) {
  try {
    const u = new URL(raw)
    u.username = ''; u.password = ''; u.hash = ''
    for (const key of [...u.searchParams.keys()]) {
      if (/token|key|authorization|password|secret|signature|email/i.test(key)) u.searchParams.set(key, '[MASCAT]')
    }
    return u.toString()
  } catch { return '[URL invalid]' }
}

// Rulează exclusiv în pagină; text= înseamnă text vizibil EXACT, css= selector existent.
function gaseste(selector, fisierAscuns = false) {
  const vizibil = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'
  const norm = s => String(s).replace(/\s+/g, ' ').trim()
  const text = selector.startsWith('text=') ? selector.slice(5) : null
  let els = text == null ? [...document.querySelectorAll(selector.replace(/^css=/, ''))]
    : [...document.querySelectorAll('body *')].filter(e => norm(e.innerText) === norm(text))
  els = els.filter(e => vizibil(e) || fisierAscuns && e.matches('input[type=file]'))
  if (text != null) els = els.filter(e => !els.some(child => child !== e && e.contains(child)))
  if (text != null) els = [...new Set(els.map(e => e.closest('button,a,[role="button"]') || e))]
  if (els.length !== 1) throw new Error(`Selector: ${els.length} rezultate vizibile (necesar exact unul)`)
  return els[0]
}

export class CDP {
  constructor(socket, target) {
    this.socket = socket; this.target = target; this.seq = 0
    this.pending = new Map(); this.requests = new Map(); this.logs = []; this.dialog = null
    socket.addEventListener('message', event => {
      const m = JSON.parse(event.data)
      if (m.id) {
        const p = this.pending.get(m.id)
        if (p) { clearTimeout(p.timer); this.pending.delete(m.id); m.error ? p.reject(new Error(`CDP ${m.error.code}`)) : p.resolve(m.result) }
      } else this.event(m.method, m.params)
    })
    socket.addEventListener('close', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Conexiune CDP închisă')) }
      this.pending.clear()
    })
  }
  event(method, p) {
    if (method === 'Page.javascriptDialogOpening') this.dialog = { type: p.type }
    if (method === 'Page.javascriptDialogClosed') this.dialog = null
    if (method === 'Network.requestWillBeSent' && ['Fetch', 'XHR'].includes(p.type)) {
      const u = new URL(p.request.url)
      if (!u.hostname.endsWith('.supabase.co')) return
      if (p.redirectResponse) this.finalize(p.requestId, p.timestamp, p.redirectResponse.status)
      const row = { metoda: p.request.method, url: urlSigur(p.request.url), status: null, durata_ms: null,
        Authorization: '[MASCAT]', inceput: p.timestamp }
      this.requests.set(p.requestId, row); this.logs.push(row)
    }
    if (method === 'Network.responseReceived' && this.requests.has(p.requestId)) this.requests.get(p.requestId).status = p.response.status
    if (method === 'Network.loadingFinished') this.finalize(p.requestId, p.timestamp)
    if (method === 'Network.loadingFailed') this.finalize(p.requestId, p.timestamp, 0)
  }
  finalize(id, timestamp, status) {
    const r = this.requests.get(id)
    if (r) { if (status != null) r.status = status; r.durata_ms = Math.round((timestamp - r.inceput) * 1000); this.requests.delete(id) }
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout CDP: ${method}`)) }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evalueaza(js) {
    const r = await this.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true, userGesture: true })
    // Textul excepției poate conține date din aplicație sau secrete; nu-l serializăm.
    if (r.exceptionDetails) throw new Error('Evaluarea în pagină a eșuat')
    return r.result?.value
  }
  async navigheaza(url) {
    if (!/^https?:\/\//.test(url)) throw new Error('URL aplicație invalid')
    const r = await this.send('Page.navigate', { url })
    if (r.errorText) throw new Error('Navigare eșuată')
    const end = Date.now() + 30000
    while (Date.now() < end) {
      if (await this.evalueaza(`location.href === ${JSON.stringify(url)} && document.readyState !== 'loading'`)) return
      await delay(100)
    }
    throw new Error('Timeout navigare')
  }
  async asteapta(selector, ms = 15000) {
    const end = Date.now() + ms
    do {
      if (await this.evalueaza(`(()=>{try{return !!(${gaseste})(${JSON.stringify(selector)})}catch{return false}})()`)) return
      await delay(100)
    } while (Date.now() < end)
    throw new Error('Timeout selector unic și vizibil')
  }
  async click(selector) {
    const p = await this.evalueaza(`(()=>{const e=(${gaseste})(${JSON.stringify(selector)}); if(e.disabled)throw Error(); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
  }
  async scrie(selector, text) {
    await this.evalueaza(`(()=>{const e=(${gaseste})(${JSON.stringify(selector)}); if(e.disabled||e.readOnly)throw Error(); e.focus();const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(text))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  }
  async incarca(selector, files) {
    const r = await this.send('Runtime.evaluate', { expression: `(${gaseste})(${JSON.stringify(selector)}, true)` })
    if (r.exceptionDetails || !r.result.objectId) throw new Error('Input fișier indisponibil')
    try { await this.send('DOM.setFileInputFiles', { objectId: r.result.objectId, files }) }
    finally { await this.send('Runtime.releaseObject', { objectId: r.result.objectId }) }
  }
  async confirma(accept, promptText) {
    if (!this.dialog) throw new Error('Niciun dialog de confirmare deschis')
    await this.send('Page.handleJavaScriptDialog', { accept, ...(promptText == null ? {} : { promptText }) })
  }
  async observa(selector) {
    return this.evalueaza(`(()=>{const e=(${gaseste})(${JSON.stringify(selector)});return {disabled:!!e.disabled,text:e.innerText,value:e.value??null}})()`)
  }
  async captura(path) {
    const { cssVisualViewport: v } = await this.send('Page.getLayoutMetrics')
    for (const scale of [1, 0.75, 0.5, 0.25]) {
      const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
        clip: { x: v.pageX, y: v.pageY, width: v.clientWidth, height: v.clientHeight, scale } })
      const bytes = Buffer.from(data, 'base64')
      if (bytes.length > 2 * 1024 * 1024) continue
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); return path
    }
    throw new Error('Captura depășește 2 MB chiar după reducere')
  }
  jurnal() { return this.logs.map(({ inceput, ...r }) => ({ ...r })) }
  inchide() { this.socket.close() }
}

// targetId este obligatoriu când sunt mai multe taburi. Nu alegem accidental o licitație reală.
export async function conecteaza(port, targetId = null) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Port CDP invalid')
  const response = await fetch(`http://127.0.0.1:${Number(port)}/json/list`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('Lista CDP indisponibilă')
  const tabs = (await response.json()).filter(t => t.type === 'page' && (!targetId || t.id === targetId))
  if (tabs.length !== 1) throw new Error('Selectează exact un tab prin cdp_target_id în fixture')
  const endpoint = new URL(tabs[0].webSocketDebuggerUrl)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('CDP acceptă numai loopback')
  const ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('Timeout conectare CDP')) }, 5000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP indisponibil')) }, { once: true })
  })
  const c = new CDP(ws, tabs[0].id)
  try { await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Network.enable') }
  catch (e) { c.inchide(); throw e }
  return c
}
let activ
export async function deschide(port, targetId) { activ = await conecteaza(port, targetId); return activ }
export const navigheaza = (...args) => activ.navigheaza(...args)
export const asteapta = (...args) => activ.asteapta(...args)
export const click = (...args) => activ.click(...args)
export const scrie = (...args) => activ.scrie(...args)
export const evalueaza = (...args) => activ.evalueaza(...args)
export const captura = (...args) => activ.captura(...args)
export const jurnal = () => activ.jurnal()
