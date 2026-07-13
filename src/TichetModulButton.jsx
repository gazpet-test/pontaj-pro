// ===========================================================================
// TICHET MODUL BUTTON 🎫 — buton flotant contextual (dreapta-jos, lângă Nenicu)
// 13.07.2026 v1 — Deschide tichet pentru MODULUL curent din care ești.
//   Detectează pagina din rută → preselectează departamentul responsabil +
//   taguiește tichetul cu modulul (metadata.modul). Navighează la
//   /tichete?action=new&modul=<key>&dep=<dep> — reutilizează formularul existent
//   (subcategorii, responsabili, AI, poze, notificări). Departamentul e doar
//   default, se poate schimba în formular. Ascuns pe pagini fără modul
//   (acasă, tichete, admin, salarii, login).
// ===========================================================================

import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const G = {
  surface:'#161B22', text:'#E6EDF3', border:'#30363D', purple:'#BC8CFF',
}

// Rută → { modul, label, emoji, dep }. dep ∈ {logistica,hr,administrativ,it,comercial,financiar}
// dep = departamentul care REZOLVĂ tichetele modulului (default, schimbabil în formular).
const MODUL_MAP = {
  '/panou':         { modul:'pontaj',        label:'Pontaj / Panou',  emoji:'📊', dep:'it' },
  '/pontaj':        { modul:'pontaj',        label:'Pontaj',          emoji:'👥', dep:'it' },
  '/rapoarte':      { modul:'rapoarte',      label:'Rapoarte',        emoji:'📈', dep:'it' },
  '/logistica':     { modul:'logistica',     label:'Logistică',       emoji:'🚛', dep:'logistica' },
  '/hr':            { modul:'hr',            label:'HR',              emoji:'👥', dep:'hr' },
  '/administrativ': { modul:'administrativ', label:'Administrativ',   emoji:'🏢', dep:'administrativ' },
  '/executie':      { modul:'executie',      label:'Execuție',        emoji:'🏗️', dep:'comercial' },
  '/financiar':     { modul:'financiar',     label:'Financiar',       emoji:'💰', dep:'financiar' },
  '/comercial':     { modul:'comercial',     label:'Comercial',       emoji:'🛒', dep:'comercial' },
  '/achizitii':     { modul:'achizitii',     label:'Achiziții',       emoji:'🛍️', dep:'comercial' },
  '/ofertare':      { modul:'ofertare',      label:'Ofertare',        emoji:'📄', dep:'comercial' },
  '/ctc':           { modul:'ctc',           label:'CTC',             emoji:'✅', dep:'administrativ' },
  '/magazie':       { modul:'magazie',       label:'Magazie',         emoji:'📦', dep:'logistica' },
  '/salarii':       { modul:'salarii',       label:'Salarii',         emoji:'💵', dep:'hr' },
}

export default function TichetModulButton({ profile }) {
  const loc = useLocation()
  const nav = useNavigate()
  const [hover, setHover] = useState(false)

  if (!profile) return null
  const ctx = MODUL_MAP[loc.pathname]
  if (!ctx) return null   // pagini fără modul (acasă, /tichete, /admin, /m, login...)

  const open = () => {
    const p = new URLSearchParams({ action:'new', modul: ctx.modul, dep: ctx.dep })
    nav(`/tichete?${p.toString()}`)
  }

  return (
    <button
      onClick={open}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`Deschide un tichet pentru modulul ${ctx.label}`}
      style={{
        position:'fixed', bottom:24, right:88, zIndex:9996,
        display:'flex', alignItems:'center', gap:8,
        height:52, padding:'0 18px', borderRadius:26,
        background:G.surface, color:G.purple, border:`2px solid ${G.purple}`,
        boxShadow:'0 6px 20px rgba(0,0,0,.45)', cursor:'pointer',
        fontSize:14, fontWeight:800, fontFamily:'inherit', whiteSpace:'nowrap',
        transition:'all .15s',
      }}
    >
      <span style={{ fontSize:20 }}>🎫</span>
      <span style={{ fontSize:12, fontWeight:700, opacity:.85 }}>
        Tichet {hover ? ctx.label : ctx.emoji}
      </span>
    </button>
  )
}
