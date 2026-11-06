import React from 'react'
import { ROLURI } from '../rol.js'
import { S } from './comune.jsx'

export default function FiltruRol({ valoare, onChange, disabled = false }) {
  return <select aria-label="Rol" value={valoare} onChange={e => onChange(e.target.value)} disabled={disabled} style={S.select}>
    {ROLURI.map(r => <option key={r.cod} value={r.cod}>{r.eticheta}</option>)}
  </select>
}
