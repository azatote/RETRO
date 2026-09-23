import { useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import backgroundImage from './assets/heart-of-the-team.png'
import './App.css'

type Ticket = { id: number; text: string; author: string; color: string; x: number; y: number; private: boolean }

const colors = ['#ffd166', '#ff9f9a', '#9ee7d1', '#b7c9ff']
const starterTickets: Ticket[] = [
  { id: 1, text: 'On a bien avancé sur les sujets complexes', author: 'Maya', color: colors[0], x: 18, y: 24, private: false },
  { id: 2, text: 'Les décisions importantes étaient parfois floues', author: 'Noé', color: colors[1], x: 48, y: 31, private: true },
  { id: 3, text: 'Les échanges entre équipes nous ont aidés', author: 'Lina', color: colors[2], x: 70, y: 18, private: false },
]

function App() {
  const [pseudo, setPseudo] = useState('')
  const [joined, setJoined] = useState(false)
  const [sessionName, setSessionName] = useState('La carte de notre sprint')
  const [tickets, setTickets] = useState<Ticket[]>(starterTickets)
  const [draft, setDraft] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [selectedColor, setSelectedColor] = useState(colors[0])
  const [background, setBackground] = useState(backgroundImage)
  const [revealAll, setRevealAll] = useState(false)
  const [draggedId, setDraggedId] = useState<number | null>(null)

  const addTicket = () => {
    const text = draft.trim()
    if (!text || !pseudo.trim()) return
    setTickets((current) => [...current, { id: Date.now(), text, author: pseudo.trim(), color: selectedColor, x: 42, y: 44, private: isPrivate }])
    setDraft('')
  }

  const moveTicket = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (draggedId === null) return
    const board = event.currentTarget.getBoundingClientRect()
    const x = Math.max(4, Math.min(84, ((event.clientX - board.left) / board.width) * 100 - 8))
    const y = Math.max(4, Math.min(82, ((event.clientY - board.top) / board.height) * 100 - 7))
    setTickets((current) => current.map((ticket) => ticket.id === draggedId ? { ...ticket, x, y } : ticket))
  }

  const handleImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const imageUrl = URL.createObjectURL(file)
    setBackground(imageUrl)
  }

  if (!joined) {
    return <main className="login-page"><div className="login-card"><div className="logo-mark">R</div><p className="eyebrow">Rétro visuelle collaborative</p><h1>Construisons la carte de votre équipe.</h1><p className="login-copy">Choisissez un pseudo pour rejoindre l’espace de travail. Vos tickets peuvent rester secrets jusqu’au moment de les partager.</p><label htmlFor="pseudo">Votre pseudo</label><input id="pseudo" autoFocus value={pseudo} onChange={(event) => setPseudo(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && setJoined(Boolean(pseudo.trim()))} placeholder="Ex. Camille" maxLength={24} /><button className="primary-button full" onClick={() => setJoined(Boolean(pseudo.trim()))} disabled={!pseudo.trim()}>Entrer dans la rétro <span>→</span></button><span className="privacy-note">🔒 Aucun compte nécessaire · prototype local</span></div></main>
  }

  return <main className="workspace">
    <header className="workspace-header"><a className="brand" href="#workspace"><span className="logo-mark small">R</span><span>Retro Planner</span></a><div className="session-title"><span className="live-dot" /> Session en cours <strong>{sessionName}</strong></div><div className="user-chip"><span>{pseudo.trim().slice(0, 1).toUpperCase()}</span>{pseudo}</div></header>
    <div className="workspace-layout">
      <aside className="sidebar">
        <div className="side-heading"><div><p className="eyebrow">Espace de travail</p><h2>Vos tickets</h2></div><span className="ticket-count">{tickets.length}</span></div>
        <p className="side-help">Écrivez ce que vous voulez déposer sur la carte. Les tickets privés ne sont visibles que par vous.</p>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Une idée, un ressenti, un fait..." rows={4} maxLength={160} />
        <div className="compose-row"><div className="swatches">{colors.map((color) => <button aria-label={`Couleur ${color}`} className={selectedColor === color ? 'swatch selected' : 'swatch'} key={color} style={{ background: color }} onClick={() => setSelectedColor(color)} />)}</div><span className="char-count">{draft.length}/160</span></div>
        <label className="private-toggle"><input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} /><span className="fake-check">{isPrivate ? '✓' : ''}</span><span><strong>Ticket privé</strong><small>Révélez-le quand vous êtes prêt</small></span></label>
        <button className="primary-button full" onClick={addTicket} disabled={!draft.trim()}>+ Créer le ticket</button>
        <div className="side-divider" />
        <div className="legend"><span><i className="legend-dot private" /> Privé</span><span><i className="legend-dot public" /> Révélé</span></div>
        <button className="reveal-button" onClick={() => setRevealAll((value) => !value)}>{revealAll ? 'Masquer les tickets' : 'Révéler tous les tickets'} <span>{revealAll ? '◉' : '◎'}</span></button>
      </aside>
      <section className="board-area"><div className="board-toolbar"><div><p className="eyebrow">La rétrospective</p><input className="title-input" value={sessionName} onChange={(event) => setSessionName(event.target.value)} /></div><div className="toolbar-actions"><label className="image-button">▧ Changer l’image<input type="file" accept="image/*" onChange={handleImage} /></label><button className="icon-button" aria-label="Partager la session">⌁</button></div></div><div className="image-board custom-image" style={{ backgroundImage: `url(${background})` }} onDragOver={(event) => event.preventDefault()} onDrop={moveTicket}><div className="board-caption"><span>GLISSEZ LES TICKETS SUR L’IMAGE</span><small>Tout le monde voit la même carte</small></div>{tickets.map((ticket) => { const hidden = ticket.private && ticket.author !== pseudo.trim() && !revealAll; return <div className={`ticket ${hidden ? 'is-hidden' : ''}`} draggable onDragStart={() => setDraggedId(ticket.id)} onDragEnd={() => setDraggedId(null)} key={ticket.id} style={{ left: `${ticket.x}%`, top: `${ticket.y}%`, background: ticket.color }}><div className="ticket-pin" />{hidden ? <><span className="lock">🔒</span><span className="hidden-label">Ticket secret</span></> : <><p>{ticket.text}</p><small>{ticket.author} {ticket.author === pseudo.trim() ? '· vous' : ''}</small></>}</div> })}</div><div className="board-footer"><span><b>{tickets.filter((ticket) => !ticket.private || revealAll).length}</b> tickets visibles sur la carte</span><span>Déplacez les tickets par glisser-déposer</span></div></section>
    </div>
  </main>
}

export default App
