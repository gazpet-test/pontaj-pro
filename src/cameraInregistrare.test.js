import { describe, it, expect } from 'vitest'
import { inregistrareCamera, textInregistrare } from './cameraInregistrare.js'

describe('unde înregistrează camera', () => {
  it('qnap_cam fără meta → QNAP implicit', () => {
    expect(inregistrareCamera({ sursa: 'qnap_cam', meta: { path: 'x.jpg' } })).toEqual(['QNAP'])
  })
  it('NVR + QNAP în paralel', () => {
    const x = { sursa: 'qnap_cam', meta: { inregistrare: [{ pe: 'nvr', nvr_extern_id: '192.168.1.90', canal: 1 }, { pe: 'qnap' }] } }
    expect(textInregistrare(x)).toBe('înregistrează pe: NVR canal 1 + QNAP')
  })
  it('doar NVR, canal necunoscut', () => {
    expect(inregistrareCamera({ sursa: 'retea', meta: { inregistrare: [{ pe: 'nvr' }] } })).toEqual(['NVR'])
  })
  it('cameră fără mapare (Tuya / Mi Home) → nimic', () => {
    expect(textInregistrare({ sursa: 'tuya', meta: { tip: 'camera' } })).toBe('')
  })
  it('valori necunoscute ignorate', () => {
    expect(inregistrareCamera({ meta: { inregistrare: [{ pe: 'cloud' }, null] } })).toEqual([])
  })
})
