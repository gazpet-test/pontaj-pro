// Punctul de intrare al prototipului B (separat de aplicație: vite.prototip.config.js, port 5199)
import React from 'react'
import { createRoot } from 'react-dom/client'
import PtNecesitaAtentia from './PtNecesitaAtentia.jsx'

createRoot(document.getElementById('root')).render(<PtNecesitaAtentia />)
