// ===========================================================================
// DropZone — zonă reutilizabilă drag & drop + click pentru upload fișiere
// 10.06.2026 — folosit pentru toate upload-urile (PDF, XLSX, imagini etc.)
// Props:
//   onFile(file)  — callback cu obiectul File selectat/tras
//   accept        — ex: "application/pdf" sau ".xlsx,.xls"
//   label         — text principal
//   hint          — text secundar (subtitlu)
//   icon          — emoji (default 📄)
//   color         — accent hex (default albastru)
//   disabled      — blochează interacțiunea
//   compact       — variantă mică (padding redus)
// ===========================================================================

import React, { useState, useRef } from 'react'

const C = {
  bg: '#0D1117', text: '#E6EDF3', muted: '#8B949E', border: '#30363D', blue: '#1F6FEB',
}

export default function DropZone({ onFile, accept, label, hint, icon, color, disabled, compact }) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)
  const accent = color || C.blue

  function pick(file) {
    if (!file || disabled) return
    onFile && onFile(file)
  }

  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation()
    setDrag(false)
    if (disabled) return
    const file = e.dataTransfer?.files?.[0]
    if (file) pick(file)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!disabled) setDrag(true) }}
      onDragEnter={e => { e.preventDefault(); e.stopPropagation(); if (!disabled) setDrag(true) }}
      onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDrag(false) }}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current && inputRef.current.click()}
      style={{
        border: `2px dashed ${drag ? accent : C.border}`,
        background: drag ? accent + '18' : C.bg,
        borderRadius: 10,
        padding: compact ? '16px 18px' : '30px 20px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'border-color .15s, background .15s',
      }}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={e => { const f = e.target.files && e.target.files[0]; if (f) pick(f); e.target.value = '' }}
        style={{ display: 'none' }}
      />
      <div style={{ fontSize: compact ? 24 : 32, marginBottom: 8, pointerEvents: 'none' }}>
        {icon || '📄'}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: drag ? accent : C.text, pointerEvents: 'none' }}>
        {drag ? '⬇ Eliberează fișierul aici' : (label || 'Trage fișierul aici sau click pentru a alege')}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4, pointerEvents: 'none' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
