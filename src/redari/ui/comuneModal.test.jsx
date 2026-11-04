// Audit D9: un click pe fundal nu mai pierde un formular completat (cere confirmare după orice modificare); fără modificări se închide ca înainte.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => ({}) } }))

import { Modal, inchidePeFundal, MESAJ_INCHIDE_MODAL } from './comune.jsx'

describe('Modal — închiderea pe fundal', () => {
  it('neatins: se închide fără întrebare', () => {
    const onClose = vi.fn(), confirma = vi.fn(() => false)
    expect(inchidePeFundal({ atins: false, confirma, onClose })).toBe(true)
    expect(confirma).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('atins: cere confirmare; „Anulează” păstrează fereastra, „OK” o închide', () => {
    const onClose = vi.fn()
    expect(inchidePeFundal({ atins: true, confirma: () => false, onClose })).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    const confirma = vi.fn(() => true)
    expect(inchidePeFundal({ atins: true, confirma, onClose })).toBe(true)
    expect(confirma).toHaveBeenCalledWith(MESAJ_INCHIDE_MODAL); expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('se randează cu titlul, conținutul și butonul ✕', () => {
    const html = renderToString(<Modal titlu="Titlu test" onClose={() => {}}><input defaultValue="x" /></Modal>)
    expect(html).toContain('Titlu test'); expect(html).toContain('✕'); expect(html).toContain('value="x"')
  })
})
