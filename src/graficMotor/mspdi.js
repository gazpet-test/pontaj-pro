// ════════════════════════════════════════════════════════════════
// graficMotor/mspdi.js — export MS Project XML (MSPDI) din rezultatul calculeazaGrafic (spec §6.4.2).
// Corectează exportMSPDI din GraficPoarta.jsx (care rămâne neschimbat, C4):
//   • calendar luni–vineri cu EXCEPȚII (sărbători legale, opriri, zile lucrate suplimentar), nu „7 zile”;
//   • legături FS/SS/FF/SF (tipurile MSPDI 1/3/0/2) cu decalaj în zile lucrătoare;
//   • executantul ca resursă + câmpurile text Subcontractant / Executant / Articol deviz / Sursă durată;
//   • rezumatele marcate Summary=1 după structură (au copii), nu după euristică.
// PUR: întoarce textul XML; descărcarea (Blob) e treaba UI-ului, scrierea pe disc a workerului.
// Elementele sunt în ordinea schemei MSPDI (MS Project 2010, SaveVersion 14); excepțiile de calendar în
// formatul 2007+ (<Exceptions>), ca MPXJ.
// ════════════════════════════════════════════════════════════════

import { adaugaZile, ziSaptamana, creeazaCalendar } from './calendar.js'

const LEGATURA_MSPDI = { FF: 0, FS: 1, SF: 2, SS: 3 }
// ID-urile câmpurilor de sarcină Text1…Text4 din MS Project
export const CAMPURI_TEXT = [
  { id: 188743731, nume: 'Text1', alias: 'Subcontractant' },
  { id: 188743734, nume: 'Text2', alias: 'Executant' },
  { id: 188743737, nume: 'Text3', alias: 'Articol deviz' },
  { id: 188743740, nume: 'Text4', alias: 'Sursă durată' },
]
const ZECI_MIN_PE_ZI = 8 * 60 * 10 // LinkLag e în zecimi de minut; ziua lucrătoare = 8 h

// eslint-disable-next-line no-control-regex
const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ore = (z) => `PT${z * 8}H0M0S`
const PROGRAM = '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>'

// Excepțiile față de săptămâna luni–vineri, pe intervalul [de, pana]: zilele consecutive cu același motiv se unesc.
export function exceptiiCalendar(calendar, de, pana) {
  const lista = []
  for (let d = de; d <= pana; d = adaugaZile(d, 1)) {
    const zs = ziSaptamana(d), implicitLucr = zs !== 0 && zs !== 6
    const lucr = calendar.esteLucratoare(d)
    if (lucr === implicitLucr) continue
    const nume = lucr ? 'Zi lucrată suplimentar' : calendar.motivLiber(d)
    const ult = lista[lista.length - 1]
    if (ult && ult.lucratoare === lucr && ult.nume === nume && adaugaZile(ult.pana, 1) === d) ult.pana = d
    else lista.push({ de: d, pana: d, lucratoare: lucr, nume })
  }
  return lista
}

export function genereazaMSPDI(rez, { titlu = 'Grafic de execuție', fisier = 'grafic', parametri = {}, autor = 'Gazpet Instal — PontajPRO' } = {}) {
  if (!rez?.calculat) throw new Error('graficul nu e calculat (are erori de structură) — nu se exportă')
  // același calendar cu care s-a calculat (rez.calendar.parametri), ca datele din fișier să coincidă cu cele calculate
  const calendar = creeazaCalendar(rez.calendar?.parametri || {})
  // implicit din rezultatul calculat (aceiași parametri ca la calcul); `parametri` explicit doar suprascrie
  const propriu = String(parametri.executant_propriu || rez.export?.executant_propriu || 'Gazpet').trim()
  const subcontractanti = new Set((parametri.subcontractanti || rez.export?.subcontractanti || []).map(s => String(s).trim()))

  // ordinea de schiță (outline): părinte, apoi copiii lui, în ordinea din grafic
  const copii = new Map()
  for (const p of rez.pozitii) { const k = p.parinte || ''; if (!copii.has(k)) copii.set(k, []); copii.get(k).push(p) }
  const ordine = []
  const parcurge = (k, prefix) => (copii.get(k) || []).forEach((p, i) => { const nr = prefix ? `${prefix}.${i + 1}` : `${i + 1}`; ordine.push({ p, nr }); parcurge(p.cod, nr) })
  parcurge('', '')
  const uid = new Map(ordine.map((o, i) => [o.p.cod, i + 1]))

  // resursele = executanții, în ordinea primei apariții; MaxUnits = câte activități are în paralel (fără supraalocări false)
  const resurse = []
  const frunze = rez.pozitii.filter(p => !p.rezumat && p.durata > 0 && String(p.executant ?? '').trim())
  for (const p of frunze) { const ex = String(p.executant).trim(); if (!resurse.find(r => r.nume === ex)) resurse.push({ nume: ex }) }
  resurse.forEach((r, i) => {
    r.uid = i + 1; r.calendar = 100 + i + 1
    const zile = new Map()
    for (const p of frunze) if (String(p.executant).trim() === r.nume) for (let k = p.es; k < p.ef; k++) zile.set(k, (zile.get(k) || 0) + 1)
    r.max = Math.max(1, ...zile.values())
  })
  const resUid = new Map(resurse.map(r => [r.nume, r.uid]))

  const tasks = ordine.map(({ p, nr }) => {
    const u = uid.get(p.cod)
    const jalon = !p.rezumat && (p.jalon || p.durata === 0)
    const start = p.start_moment, final = p.final_moment // calculate în calculeazaGrafic (convenția MS Project)
    const ex = String(p.executant ?? '').trim()
    const text = [
      p.rezumat ? '' : (subcontractanti.has(ex) ? ex : ''),
      p.rezumat ? '' : ex,
      (p.articole_deviz || []).join(', '),
      p.rezumat ? '' : String(p.sursa_durata ?? ''),
    ]
    const linkuri = (p.predecesori || []).map(q => `<PredecessorLink><PredecessorUID>${uid.get(q.de)}</PredecessorUID><Type>${LEGATURA_MSPDI[q.tip]}</Type><CrossProject>0</CrossProject><LinkLag>${q.lag * ZECI_MIN_PE_ZI}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join('')
    const atribute = text.map((v, i) => (v ? `<ExtendedAttribute><FieldID>${CAMPURI_TEXT[i].id}</FieldID><Value>${esc(v)}</Value></ExtendedAttribute>` : '')).join('')
    return `<Task><UID>${u}</UID><ID>${u}</ID><Name>${esc(p.denumire || p.cod)}</Name><Type>1</Type><IsNull>0</IsNull><WBS>${esc(p.cod)}</WBS>` +
      `<OutlineNumber>${nr}</OutlineNumber><OutlineLevel>${p.nivel + 1}</OutlineLevel><Start>${start}</Start><Finish>${final}</Finish>` +
      `<Duration>${ore(p.durata)}</Duration><DurationFormat>7</DurationFormat><Milestone>${jalon ? 1 : 0}</Milestone><Summary>${p.rezumat ? 1 : 0}</Summary>` +
            `<Critical>${p.critic ? 1 : 0}</Critical><TotalSlack>${p.marja * ZECI_MIN_PE_ZI}</TotalSlack>` +
      // neînceput: 0% realizat, toată durata rămasă (MS Project le scrie mereu; planificatoarele le cer)
      `<PercentComplete>0</PercentComplete><ActualDuration>PT0H0M0S</ActualDuration><RemainingDuration>${ore(p.durata)}</RemainingDuration>` +
      // 0 = cât mai devreme; 4 = începe nu mai devreme de data de start (doar unde decalajul negativ ar fi tras activitatea înainte)
      (p.limitat_la_start ? `<ConstraintType>4</ConstraintType><ConstraintDate>${rez.prima_zi_lucratoare}T08:00:00</ConstraintDate>` : '<ConstraintType>0</ConstraintType>') +
      `${linkuri}${atribute}<Active>1</Active><Manual>0</Manual></Task>`
  })

  // excepțiile acoperă și anul de după final (editări ulterioare în MS Project), dar nu ies din 1900–2099 (r1 Jak P2)
  const anStart = Number(rez.data_start.slice(0, 4)), anFinal = Math.min(2099, Number(rez.data_final.slice(0, 4)) + 1)
  const exceptii = exceptiiCalendar(calendar, `${anStart}-01-01`, `${anFinal}-12-31`)
  const xmlExceptii = exceptii.map(e => `<Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod><FromDate>${e.de}T00:00:00</FromDate><ToDate>${e.pana}T23:59:00</ToDate></TimePeriod>` +
    `<Occurrences>1</Occurrences><Name>${esc(e.nume)}</Name><Type>1</Type><DayWorking>${e.lucratoare ? 1 : 0}</DayWorking>${e.lucratoare ? PROGRAM : ''}</Exception>`).join('')
  const zile = [1, 2, 3, 4, 5, 6, 7].map(d => (d === 1 || d === 7)
    ? `<WeekDay><DayType>${d}</DayType><DayWorking>0</DayWorking></WeekDay>`
    : `<WeekDay><DayType>${d}</DayType><DayWorking>1</DayWorking>${PROGRAM}</WeekDay>`).join('')
  const numeCal = calendar.faraSarbatori ? 'Luni–vineri FĂRĂ sărbători (diagnoză)' : 'Zile lucrătoare RO (luni–vineri, sărbători legale)'
  const calendare = `<Calendar><UID>1</UID><Name>${esc(numeCal)}</Name><IsBaseCalendar>1</IsBaseCalendar><IsBaselineCalendar>0</IsBaselineCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${zile}</WeekDays><Exceptions>${xmlExceptii}</Exceptions></Calendar>` +
    resurse.map(r => `<Calendar><UID>${r.calendar}</UID><Name>${esc(r.nume)}</Name><IsBaseCalendar>0</IsBaseCalendar><IsBaselineCalendar>0</IsBaselineCalendar><BaseCalendarUID>1</BaseCalendarUID></Calendar>`).join('')

  const xmlResurse = resurse.map(r => `<Resource><UID>${r.uid}</UID><ID>${r.uid}</ID><Name>${esc(r.nume)}</Name><Type>1</Type><IsNull>0</IsNull>` +
    `<Group>${r.nume === propriu ? esc(propriu) : (subcontractanti.has(r.nume) ? 'Subcontractant' : 'Terț')}</Group><MaxUnits>${r.max.toFixed(2)}</MaxUnits><CalendarUID>${r.calendar}</CalendarUID></Resource>`).join('')
  let nAs = 0
  const asignari = frunze.map(p => `<Assignment><UID>${++nAs}</UID><TaskUID>${uid.get(p.cod)}</TaskUID><ResourceUID>${resUid.get(String(p.executant).trim())}</ResourceUID><ActualWork>PT0H0M0S</ActualWork><RemainingWork>${ore(p.durata)}</RemainingWork><Units>1</Units><Work>${ore(p.durata)}</Work></Assignment>`).join('')
  const atributeDef = CAMPURI_TEXT.map(c => `<ExtendedAttribute><FieldID>${c.id}</FieldID><FieldName>${c.nume}</FieldName><Alias>${esc(c.alias)}</Alias></ExtendedAttribute>`).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
<SaveVersion>14</SaveVersion><Name>${esc(fisier)}.xml</Name><Title>${esc(titlu)}</Title><Author>${esc(autor)}</Author>
<ScheduleFromStart>1</ScheduleFromStart><StartDate>${rez.prima_zi_lucratoare}T08:00:00</StartDate><FinishDate>${rez.data_final}T17:00:00</FinishDate><CalendarUID>1</CalendarUID>
<DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime><MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth>
<DefaultTaskType>1</DefaultTaskType><DurationFormat>7</DurationFormat>
<ExtendedAttributes>${atributeDef}</ExtendedAttributes>
<Calendars>${calendare}</Calendars>
<Tasks>
${tasks.join('\n')}
</Tasks>
<Resources>${xmlResurse}</Resources>
<Assignments>${asignari}</Assignments>
</Project>
`
}
