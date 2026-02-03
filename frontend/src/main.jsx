import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Tutorial from './Tutorial.jsx'
import { BASE_PATH } from './lib/basePath'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={BASE_PATH}>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/tutorial" element={<Tutorial />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
