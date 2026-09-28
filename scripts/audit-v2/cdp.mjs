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
    this.dialogLogs = []; this.dialogExpectation = null; this.dialogError = null
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
    if (method === 'Page.javascriptDialogOpening') this.raspundeDialog(p)
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
  raspundeDialog(p) {
    this.dialog = { type: p.type, message: p.message }
    const expected = this.dialogExpectation
    const response = expected?.dialogs[expected.index]
    const matches = response?.type === p.type
    if (matches) expected.index++
    const row = { ...this.dialog, asteptat: !!matches, accept: matches ? response.accept : false }
    this.dialogLogs.push(row)
    if (!matches) this.dialogError = new Error(`Dialog neașteptat (${p.type}): ${p.message}`)
    // Abonarea este instalată în constructor; răspunsul NU așteaptă finalizarea clickului.
    const handling = this.send('Page.handleJavaScriptDialog', { accept: row.accept,
      ...(matches && p.type === 'prompt' ? { promptText: response.text } : {}) })
    handling.then(() => {
      row.raspuns = 'trimis'
      if (this.dialogError) this.refuzaDialog(this.dialogError)
      else if (++expected.answered === expected.dialogs.length) expected.resolve()
    }, () => {
      row.raspuns = 'eșuat'
      this.refuzaDialog(this.dialogError || new Error(`Răspuns CDP eșuat la dialog (${p.type}): ${p.message}`))
    })
  }
  refuzaDialog(error) {
    this.dialogError = error
    this.dialogExpectation?.reject(error)
    for (const [id, p] of this.pending) {
      if (p.method === 'Page.handleJavaScriptDialog') continue
      clearTimeout(p.timer); this.pending.delete(id); p.reject(error)
    }
  }
  finalize(id, timestamp, status) {
    const r = this.requests.get(id)
    if (r) { if (status != null) r.status = status; r.durata_ms = Math.round((timestamp - r.inceput) * 1000); this.requests.delete(id) }
  }
  send(method, params = {}) {
    if (this.dialogError && method !== 'Page.handleJavaScriptDialog') return Promise.reject(this.dialogError)
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout CDP: ${method}`)) }, 30000)
      this.pending.set(id, { resolve, reject, timer, method })
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
  async click(selector, dialog = null) {
    let timer
    const expected = dialog ? { dialogs: Array.isArray(dialog) ? dialog : [dialog], index: 0, answered: 0 } : null
    const answered = expected ? new Promise((resolve, reject) => Object.assign(expected, { resolve, reject })) : null
    answered?.catch(() => {}) // Poate fi respins înainte ca dispatchMouseEvent să răspundă.
    this.dialogExpectation = expected
    try {
      const p = await this.evalueaza(`(()=>{const e=(${gaseste})(${JSON.stringify(selector)}); if(e.disabled)throw Error(); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
      if (answered) {
        timer = setTimeout(() => expected.reject(new Error('Dialogul din rețetă nu a apărut')), 15000)
        await answered
      }
      if (this.dialogError) throw this.dialogError
    } finally { clearTimeout(timer); this.dialogExpectation = null }
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
  dialoguri() { return this.dialogLogs.map(r => ({ ...r })) }
  inchide() { this.socket.close() }
}

export function selecteazaTab(tabs, targetId = null, { appUrl = 'https://pontaj-pro-sooty.vercel.app', excludeTarget = null } = {}) {
  const origin = new URL(appUrl).origin
  const pages = tabs.filter(t => {
    if (t.type !== 'page' || t.id === excludeTarget) return false
    if (targetId != null) return t.id === targetId
    try { return new URL(t.url).origin === origin } catch { return false }
  })
  // Primul tab al aplicației; al doilea context exclude explicit primul target.
  if (!pages.length || targetId != null && pages.length !== 1) throw new Error('Niciun tab CDP distinct pentru aplicația configurată')
  return pages[0]
}
export async function conecteaza(port, targetId = null, options = {}) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Port CDP invalid')
  const response = await fetch(`http://127.0.0.1:${Number(port)}/json/list`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('Lista CDP indisponibilă')
  const tab = selecteazaTab(await response.json(), targetId, options)
  const endpoint = new URL(tab.webSocketDebuggerUrl)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('CDP acceptă numai loopback')
  const ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('Timeout conectare CDP')) }, 5000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP indisponibil')) }, { once: true })
  })
  const c = new CDP(ws, tab.id)
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
