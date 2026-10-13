// cameraInregistrare.js — unde înregistrează o cameră (13.10.2026, NVR Dahua 192.168.1.90 lângă QNAP Surveillance Station).
// Fără schemă nouă: iot_dispozitive.meta.inregistrare = [{ pe: 'nvr', nvr_extern_id: '192.168.1.90', canal: 1 }, { pe: 'qnap' }]
// (listă: în perioada de test camera merge pe ambele). Fără câmp: camerele `qnap_cam` înregistrează implicit pe QNAP.
export function inregistrareCamera(x) {
  const l = Array.isArray(x?.meta?.inregistrare) ? x.meta.inregistrare : null
  if (!l) return x?.sursa === 'qnap_cam' ? ['QNAP'] : []
  return l.map(i => i?.pe === 'nvr'
    ? `NVR${Number.isInteger(i.canal) ? ` canal ${i.canal}` : ''}`
    : i?.pe === 'qnap' ? 'QNAP' : null).filter(Boolean)
}

export const textInregistrare = (x) => {
  const l = inregistrareCamera(x)
  return l.length ? `înregistrează pe: ${l.join(' + ')}` : ''
}
