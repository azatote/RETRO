import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import backgroundImage from './assets/heart-of-the-team.png'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './App.css'

type Ticket = {
  id: number | string
  text: string
  author: string
  color: string
  x: number
  y: number
  private: boolean
}

type RemoteTicket = {
  id: number
  text: string
  author: string
  color: string
  x: number
  y: number
  is_private: boolean
}

type PresenceUser = { user: string; isAdmin: boolean }
type TicketVotes = Record<string, string[]>
type BoardEvent = { ticketId: number | string; author: string }

const colors = ['#ffd166', '#ff9f9a', '#9ee7d1', '#b7c9ff']
const starterTickets: Ticket[] = [
  { id: 1, text: 'On a bien avancé sur les sujets complexes', author: 'Maya', color: colors[0], x: 18, y: 24, private: false },
  { id: 2, text: 'Les décisions importantes étaient parfois floues', author: 'Noé', color: colors[1], x: 48, y: 31, private: true },
  { id: 3, text: 'Les échanges entre équipes nous ont aidés', author: 'Lina', color: colors[2], x: 70, y: 18, private: false },
]
const sessionId = 'demo'

const toTicket = (ticket: RemoteTicket): Ticket => ({
  id: ticket.id,
  text: ticket.text,
  author: ticket.author,
  color: ticket.color,
  x: ticket.x,
  y: ticket.y,
  private: ticket.is_private,
})

const getAuthorPlacement = (author: string, ticketNumber: number) => {
  const authorHash = [...author].reduce((total, character) => total + character.charCodeAt(0), 0)
  return {
    x: 10 + ((authorHash * 17 + ticketNumber * 23) % 76),
    y: 12 + ((authorHash * 11 + ticketNumber * 19) % 72),
  }
}

function App() {
  const [pseudo, setPseudo] = useState('')
  const [joined, setJoined] = useState(false)
  const [sessionName, setSessionName] = useState('La carte de notre sprint')
  const [tickets, setTickets] = useState<Ticket[]>(starterTickets)
  const [draft, setDraft] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [selectedColor, setSelectedColor] = useState(colors[0])
  const [revealAll, setRevealAll] = useState(false)
  const [draggedId, setDraggedId] = useState<number | string | null>(null)
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])
  const [ticketError, setTicketError] = useState('')
  const [voteOpen, setVoteOpen] = useState(false)
  const [ticketVotes, setTicketVotes] = useState<TicketVotes>({})
  const [editingTicketId, setEditingTicketId] = useState<number | string | null>(null)
  const [editingText, setEditingText] = useState('')
  const channelRef = useRef<RealtimeChannel | null>(null)
  const normalizedPseudo = pseudo.trim()
  const isAdmin = normalizedPseudo.startsWith('@')
  const displayName = normalizedPseudo.replace(/^@/, '')
  const visibleOnlineUsers = isSupabaseConfigured ? onlineUsers : (displayName ? [displayName] : [])

  useEffect(() => {
    const client = supabase
    if (!joined || !displayName || !client) return
    let active = true

    const loadTickets = async () => {
      const { data } = await client.from('retro_tickets').select('*').eq('session_id', sessionId).order('created_at')
      if (active && data) setTickets(data.map(toTicket))
    }

    void loadTickets()
    const channel = client.channel(`retro-${sessionId}`, { config: { presence: { key: displayName } } })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceUser>()
        const names = Object.values(state).flatMap((entries) => entries.map((entry) => entry.user)).filter(Boolean)
        if (active) setOnlineUsers([...new Set(names)])
      })
      .on('broadcast', { event: 'visibility-changed' }, ({ payload }) => {
        setRevealAll(Boolean((payload as { revealAll: boolean }).revealAll))
      })
      .on('broadcast', { event: 'tickets-locked' }, ({ payload }) => {
        setVoteOpen(Boolean((payload as { locked: boolean }).locked))
      })
      .on('broadcast', { event: 'ticket-voted' }, ({ payload }) => {
        const { ticketId, author, active } = payload as BoardEvent & { active: boolean }
        setTicketVotes((current) => {
          const key = String(ticketId)
          const voters = current[key] ?? []
          const nextVoters = active ? [...new Set([...voters, author])] : voters.filter((voter) => voter !== author)
          return { ...current, [key]: nextVoters }
        })
      })
      .on('broadcast', { event: 'ticket-edited' }, ({ payload }) => {
        const { id, author, text } = payload as { id: number; author: string; text: string }
        setTickets((current) => current.map((item) => item.id === id && item.author === author ? { ...item, text } : item))
      })
      .on('broadcast', { event: 'ticket-moved' }, ({ payload }) => {
        const { id, author, x, y } = payload as { id: number; author: string; x: number; y: number }
        setTickets((current) => current.map((item) => item.id === id && item.author === author ? { ...item, x, y } : item))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'retro_tickets', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const ticket = toTicket(payload.new as RemoteTicket)
        setTickets((current) => current.some((item) => item.id === ticket.id) ? current : [...current, ticket])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'retro_tickets', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const ticket = toTicket(payload.new as RemoteTicket)
        setTickets((current) => current.map((item) => item.id === ticket.id ? ticket : item))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'retro_tickets', filter: `session_id=eq.${sessionId}` }, (payload) => {
        setTickets((current) => current.filter((item) => item.id !== payload.old.id))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          channelRef.current = channel
          await channel.track({ user: displayName, isAdmin })
        }
      })

    return () => {
      active = false
      channelRef.current = null
      void client.removeChannel(channel)
    }
  }, [joined, displayName, isAdmin])

  const joinSession = () => {
    const value = pseudo.trim()
    if (!/^@?[a-zA-Z0-9À-ÿ][a-zA-Z0-9À-ÿ _-]{1,23}$/.test(value)) return
    setPseudo(value)
    setJoined(true)
  }

  const addTicket = async () => {
    if (voteOpen) return
    const text = draft.trim()
    if (!text || !displayName) return
    const authorTicketCount = tickets.filter((ticket) => ticket.author === displayName).length
    const placement = getAuthorPlacement(displayName, authorTicketCount)
    const ticket = { text, author: displayName, color: selectedColor, ...placement, private: isPrivate }
    const temporaryId = `pending-${Date.now()}`
    setTicketError('')
    setTickets((current) => [...current, { id: temporaryId, ...ticket }])
    setDraft('')

    if (supabase) {
      const { data, error } = await supabase.from('retro_tickets').insert({ session_id: sessionId, ...ticket, is_private: ticket.private }).select().single()
      if (error || !data) {
        setTickets((current) => current.filter((item) => item.id !== temporaryId))
        setTicketError(error?.message ?? 'Le ticket n’a pas pu être enregistré.')
        return
      }
      setTickets((current) => current.map((item) => item.id === temporaryId ? toTicket(data as RemoteTicket) : item))
    } else {
      setTickets((current) => current.map((item) => item.id === temporaryId ? { id: Date.now(), ...ticket } : item))
    }
  }

  const moveTicket = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (draggedId === null || voteOpen) return
    const draggedTicket = tickets.find((ticket) => ticket.id === draggedId)
    if (!draggedTicket || draggedTicket.author !== displayName) return
    const board = event.currentTarget.getBoundingClientRect()
    const x = Math.max(4, Math.min(84, ((event.clientX - board.left) / board.width) * 100 - 8))
    const y = Math.max(4, Math.min(82, ((event.clientY - board.top) / board.height) * 100 - 7))
    setTickets((current) => current.map((ticket) => ticket.id === draggedId ? { ...ticket, x, y } : ticket))
    if (supabase && typeof draggedId === 'number') {
      void channelRef.current?.send({ type: 'broadcast', event: 'ticket-moved', payload: { id: draggedId, author: displayName, x, y } })
      void supabase.from('retro_tickets').update({ x, y }).eq('id', draggedId)
    }
  }

  const toggleVote = () => {
    if (!isAdmin) return
    const nextValue = !voteOpen
    setVoteOpen(nextValue)
    void channelRef.current?.send({ type: 'broadcast', event: 'tickets-locked', payload: { locked: nextValue } })
  }

  const voteCountFor = (ticketId: number | string) => ticketVotes[String(ticketId)] ?? []
  const voteTotalFor = (author: string) => Object.values(ticketVotes).filter((voters) => voters.includes(author)).length

  const voteForTicket = (ticketId: number | string) => {
    if (!voteOpen || !displayName) return
    const voters = voteCountFor(ticketId)
    const key = String(ticketId)
    const hasVoted = voters.includes(displayName)
    if (!hasVoted && voteTotalFor(displayName) >= 3) return
    const nextVoters = hasVoted ? voters.filter((voter) => voter !== displayName) : [...voters, displayName]
    setTicketVotes((current) => ({ ...current, [key]: nextVoters }))
    void channelRef.current?.send({ type: 'broadcast', event: 'ticket-voted', payload: { ticketId, author: displayName, active: !hasVoted } })
  }

  const beginEdit = (ticket: Ticket) => {
    if (voteOpen || ticket.author !== displayName || !ticket.private || revealAll) return
    setEditingTicketId(ticket.id)
    setEditingText(ticket.text)
  }

  const saveEdit = async (ticket: Ticket) => {
    const text = editingText.trim()
    if (!text || voteOpen || ticket.author !== displayName || !ticket.private || revealAll) return
    setTickets((current) => current.map((item) => item.id === ticket.id ? { ...item, text } : item))
    setEditingTicketId(null)
    if (supabase && typeof ticket.id === 'number') {
      void channelRef.current?.send({ type: 'broadcast', event: 'ticket-edited', payload: { id: ticket.id, author: displayName, text } })
      const { error } = await supabase.from('retro_tickets').update({ text }).eq('id', ticket.id).eq('author', displayName)
      if (error) setTicketError(error.message)
    }
  }

  const toggleRevealAll = () => {
    const nextValue = !revealAll
    setRevealAll(nextValue)
    void channelRef.current?.send({ type: 'broadcast', event: 'visibility-changed', payload: { revealAll: nextValue } })
  }

  const downloadMarkdown = () => {
    const lines = [
      `# ${sessionName}`,
      '',
      `Session: ${sessionId}`,
      `Exportée le : ${new Date().toLocaleString('fr-FR')}`,
      '',
      '## Tickets',
      ...tickets.map((ticket) => `- **${ticket.text}** — ${ticket.author}${ticket.private ? ' (privé)' : ''}`),
      '',
      '## Votes',
      ...tickets.map((ticket) => `- ${ticket.text} : ${voteCountFor(ticket.id).length} vote(s)`),
      '',
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${sessionName.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  const resetSession = async () => {
    if (!isAdmin || !window.confirm('Réinitialiser les tickets de cette rétro pour tout le monde ?')) return
    setRevealAll(false)
    setVoteOpen(false)
    setTicketVotes({})
    if (supabase) {
      const { error } = await supabase.from('retro_tickets').delete().eq('session_id', sessionId)
      if (error) {
        window.alert('La réinitialisation est bloquée par les droits Supabase. Exécutez la policy DELETE du fichier supabase-schema.sql.')
        return
      }
    }
    setTickets([])
  }

  if (!joined) {
    return <main className="login-page"><div className="login-card"><div className="logo-mark">R</div><p className="eyebrow">Rétro visuelle collaborative</p><h1>Construisons la carte de votre équipe.</h1><p className="login-copy">Choisissez un pseudo pour rejoindre l’espace de travail. Vos tickets peuvent rester secrets jusqu’au moment de les partager.</p><label htmlFor="pseudo">Votre pseudo</label><input id="pseudo" autoFocus value={pseudo} onChange={(event) => setPseudo(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && joinSession()} placeholder="Ex. Camille · @animateur" maxLength={24} /><p className="pseudo-hint">Préfixez votre pseudo avec <strong>@</strong> pour devenir l’animateur de la réunion.</p><button className="primary-button full" onClick={joinSession} disabled={!/^@?[a-zA-Z0-9À-ÿ][a-zA-Z0-9À-ÿ _-]{1,23}$/.test(pseudo.trim())}>Entrer dans la rétro <span>→</span></button><span className="privacy-note">🔒 {isSupabaseConfigured ? 'Session temps réel activée' : 'Mode local · ajoutez Supabase pour le temps réel'}</span></div></main>
  }

  return (
    <main className="workspace">
      <header className="workspace-header"><a className="brand" href="#workspace"><span className="logo-mark small">R</span><span>Retro Planner</span></a><div className="session-title"><span className="live-dot" /> Session en cours <strong>{sessionName}</strong></div><div className="user-chip"><span>{displayName.slice(0, 1).toUpperCase()}</span><div><strong>{displayName}</strong><small>{isAdmin ? 'Animateur · admin' : 'Participant'}</small></div><button className="logout-button" onClick={() => setJoined(false)}>Changer</button></div></header>
      <div className="workspace-layout">
        <aside className="sidebar">
          <div className="side-heading"><div><p className="eyebrow">Espace de travail</p><h2>Vos tickets</h2></div><span className="ticket-count">{tickets.length}</span></div>
          <div className="online-panel"><div className="online-heading"><span><i className="live-dot" /> Dans la rétro</span><strong>{visibleOnlineUsers.length}</strong></div><div className="online-list">{visibleOnlineUsers.map((user) => <span className={user === displayName ? 'online-user current' : 'online-user'} key={user}><i />{user}{user === displayName && <small>vous</small>}</span>)}</div></div>
          <p className="side-help">Écrivez ce que vous voulez déposer sur la carte. Les tickets privés ne sont visibles que par vous.</p>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Une idée, un ressenti, un fait..." rows={4} maxLength={160} disabled={voteOpen} />
          <div className="compose-row"><div className="swatches">{colors.map((color) => <button aria-label={`Couleur ${color}`} className={selectedColor === color ? 'swatch selected' : 'swatch'} key={color} style={{ background: color }} onClick={() => setSelectedColor(color)} disabled={voteOpen} />)}</div><span className="char-count">{draft.length}/160</span></div>
          <label className="private-toggle"><input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} disabled={voteOpen} /><span className="fake-check">{isPrivate ? '✓' : ''}</span><span><strong>Ticket privé</strong><small>Révélez-le quand vous êtes prêt</small></span></label>
          <button className="primary-button full" onClick={addTicket} disabled={!draft.trim() || voteOpen}>+ Créer le ticket</button>{ticketError && <p className="ticket-error">Impossible d’enregistrer le ticket : {ticketError}</p>}
          <div className="vote-panel"><strong>{voteOpen ? 'Phase 2 · Vote' : 'Phase 1 · Collecte'}</strong><small>{voteOpen ? 'Votez une fois par ticket, avec 3 votes au total.' : 'L’animateur lance le vote quand les tickets sont prêts.'}</small><span className="vote-total">Mes votes : {voteTotalFor(displayName)}/3</span></div>
          <div className="side-divider" />
          <div className="legend"><span><i className="legend-dot private" /> Privé</span><span><i className="legend-dot public" /> Révélé</span></div>
          {isAdmin ? <><button className="reveal-button" onClick={toggleRevealAll}>{revealAll ? 'Masquer les tickets' : 'Révéler tous les tickets'} <span>{revealAll ? '◉' : '◎'}</span></button><button className={voteOpen ? 'vote-launch-button active' : 'vote-launch-button'} onClick={toggleVote}>{voteOpen ? 'Arrêter le vote' : 'Lancer le vote'} <span>{voteOpen ? '✓' : '→'}</span></button><button className="reset-button" onClick={resetSession}>Réinitialiser la rétro <span>↺</span></button><button className="export-button" onClick={downloadMarkdown}>Télécharger le Markdown <span>↓</span></button></> : <p className="admin-note">🔒 Seul l’animateur peut révéler, lancer ou arrêter le vote, ou réinitialiser la rétro.</p>}
        </aside>
        <section className="board-area">
          <div className="board-toolbar"><div><p className="eyebrow">La rétrospective</p><input className="title-input" value={sessionName} onChange={(event) => setSessionName(event.target.value)} /></div><div className="toolbar-actions"><button className="icon-button" aria-label="Partager la session">⌁</button></div></div>
          <div className="image-board custom-image" style={{ backgroundImage: `url(${backgroundImage})` }} onDragOver={(event) => event.preventDefault()} onDrop={moveTicket}>
            <div className="board-caption"><span>{voteOpen ? 'VOTEZ SUR LES TICKETS' : 'GLISSEZ VOS TICKETS SUR L’IMAGE'}</span><small>{voteOpen ? 'Chaque participant dispose de 3 votes.' : 'Chaque ticket reste déplaçable par son auteur uniquement'}</small></div>
            {tickets.map((ticket) => {
              const hidden = ticket.private && ticket.author !== displayName && !revealAll
              const canMove = ticket.author === displayName
              const canEdit = canMove && ticket.private && !revealAll && !voteOpen
              const isEditing = editingTicketId === ticket.id
              const voters = voteCountFor(ticket.id)
              const hasVoted = voters.includes(displayName)
              return <div className={`ticket ${hidden ? 'is-hidden' : ''} ${canMove ? 'is-owned' : 'is-locked'} ${voteOpen ? 'vote-phase' : ''}`} draggable={canMove && !isEditing && !voteOpen} onDragStart={() => canMove && !isEditing && !voteOpen && setDraggedId(ticket.id)} onDragEnd={() => setDraggedId(null)} key={ticket.id} style={{ left: `${ticket.x}%`, top: `${ticket.y}%`, background: ticket.color }}>
                <div className="ticket-pin" />
                {hidden ? <><span className="lock">🔒</span><span className="hidden-label">Ticket secret</span></> : isEditing ? <div className="ticket-editor"><textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} maxLength={160} autoFocus /><div><button type="button" onClick={() => saveEdit(ticket)}>Enregistrer</button><button type="button" onClick={() => setEditingTicketId(null)}>Annuler</button></div></div> : <><p>{ticket.text}</p><small>{ticket.author} {canMove ? '· vous' : '· lecture seule'}</small>{canEdit && <button type="button" className="edit-ticket" onClick={() => beginEdit(ticket)}>Modifier</button>}{voteOpen && !hidden && <button type="button" className={hasVoted ? 'ticket-vote voted' : 'ticket-vote'} disabled={!hasVoted && voteTotalFor(displayName) >= 3} onClick={() => voteForTicket(ticket.id)}>{hasVoted ? 'RETIRER LE VOTE' : 'VOTE'} <span>{voters.length}</span></button>}</>}
              </div>
            })}
          </div>
          <div className="board-footer"><span><b>{tickets.filter((ticket) => !ticket.private || revealAll).length}</b> tickets visibles sur la carte</span><span>{voteOpen ? 'Votez sur les tickets' : 'Déplacez uniquement vos tickets'}</span></div>
        </section>
      </div>
    </main>
  )
}

export default App
