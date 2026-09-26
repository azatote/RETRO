import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import QRCode from 'qrcode'
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
type RemoteVote = { id: number; ticket_id: number; author: string }
type Zone = { id: string; name: string; color: string }
type ActionDecision = { status: 'action' | 'none'; text: string }
type SessionConfig = { zones: Zone[]; isOpen: boolean; voteOpen: boolean; voteFinished: boolean; ticketZones: Record<string, string>; ticketActions: Record<string, ActionDecision> }
type SessionStatus = 'idle' | 'checking' | 'valid' | 'invalid'

const colors = ['#ffd166', '#ff9f9a', '#9ee7d1', '#b7c9ff']
const createSessionKey = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()
const requestedSessionKey = new URLSearchParams(window.location.search).get('session')?.trim().toUpperCase() ?? ''
const isParticipantAccess = Boolean(requestedSessionKey)
const hasValidSessionKeyFormat = /^[A-Z0-9]{10}$/.test(requestedSessionKey)
const defaultZones: Zone[] = [
  { id: 'keep', name: 'À conserver', color: '#9ee7d1' },
  { id: 'improve', name: 'À améliorer', color: '#ffd166' },
  { id: 'try', name: 'À essayer', color: '#b7c9ff' },
  { id: 'stop', name: 'À arrêter', color: '#ff9f9a' },
  { id: 'celebrate', name: 'À célébrer', color: '#d7c1f5' },
]

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
  const [sessionId, setSessionId] = useState(requestedSessionKey)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(isParticipantAccess ? isSupabaseConfigured && hasValidSessionKeyFormat ? 'checking' : 'invalid' : 'idle')
  const [sessionError, setSessionError] = useState(isParticipantAccess && !hasValidSessionKeyFormat ? 'Ce QR code ne contient pas une clé de séance valide.' : isParticipantAccess && !isSupabaseConfigured ? 'Le service temps réel est indisponible. Impossible de valider ce QR code.' : '')
  const sessionName = 'Rétrospective'
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [draft, setDraft] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [selectedColor, setSelectedColor] = useState(colors[0])
  const [revealAll, setRevealAll] = useState(false)
  const [draggedId, setDraggedId] = useState<number | string | null>(null)
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])
  const [ticketError, setTicketError] = useState('')
  const [voteOpen, setVoteOpen] = useState(false)
  const [zones, setZones] = useState<Zone[]>(defaultZones)
  const [retroOpen, setRetroOpen] = useState(false)
  const [voteFinished, setVoteFinished] = useState(false)
  const [ticketZones, setTicketZones] = useState<Record<string, string>>({})
  const [ticketActions, setTicketActions] = useState<Record<string, ActionDecision>>({})
  const [ticketVotes, setTicketVotes] = useState<TicketVotes>({})
  const [editingTicketId, setEditingTicketId] = useState<number | string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const channelRef = useRef<RealtimeChannel | null>(null)
  const normalizedPseudo = pseudo.trim()
  const isAdmin = !isParticipantAccess
  const displayName = normalizedPseudo.replace(/^@/, '')
  const visibleOnlineUsers = isSupabaseConfigured ? onlineUsers : (displayName ? [displayName] : [])
  const shareUrl = sessionId ? `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}` : ''

  useEffect(() => {
    if (!shareUrl) return
    let active = true
    void QRCode.toDataURL(shareUrl, { width: 220, margin: 2, color: { dark: '#17262a', light: '#fffdf8' } }).then((url) => {
      if (active) setQrCodeUrl(url)
    })
    return () => { active = false }
  }, [shareUrl])

  useEffect(() => {
    if (!isParticipantAccess || !hasValidSessionKeyFormat) return
    const client = supabase
    if (!client) return

    let active = true
    const validateSession = async () => {
      const { data, error } = await client.from('retro_sessions').select('id').eq('id', requestedSessionKey).maybeSingle()
      if (!active) return
      if (error || !data) {
        setSessionStatus('invalid')
        setSessionError('Cette séance est inconnue ou terminée. Scannez le nouveau QR code affiché par l’animateur.')
        return
      }
      setSessionStatus('valid')
      setSessionError('')
    }

    void validateSession()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!joined || !displayName || !client) return
    let active = true

    const loadTickets = async () => {
      const { data } = await client.from('retro_tickets').select('*').eq('session_id', sessionId).order('created_at')
      if (active && data) setTickets(data.map(toTicket))
    }

    void loadTickets()
    const loadVotes = async () => {
      const { data } = await client.from('retro_votes').select('id, ticket_id, author').eq('session_id', sessionId)
      if (!active || !data) return
      setTicketVotes(data.reduce<TicketVotes>((result, vote: RemoteVote) => {
        const key = String(vote.ticket_id)
        result[key] = [...(result[key] ?? []), vote.author]
        return result
      }, {}))
    }

    void loadVotes()
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
      .on('broadcast', { event: 'session-configured' }, ({ payload }) => {
        const config = payload as SessionConfig
        setZones(config.zones)
        setRetroOpen(config.isOpen)
        setVoteOpen(config.voteOpen)
        setVoteFinished(config.voteFinished)
        setTicketZones(config.ticketZones)
        setTicketActions(config.ticketActions ?? {})
      })
      .on('broadcast', { event: 'session-ended' }, () => {
        setJoined(false)
        setSessionStatus('invalid')
        setSessionError('Cette séance est terminée. Scannez le nouveau QR code affiché par l’animateur.')
        setTickets([])
        setTicketVotes({})
        setTicketZones({})
        setTicketActions({})
        setVoteOpen(false)
        setVoteFinished(false)
        setRetroOpen(false)
      })
      .on('broadcast', { event: 'ticket-zone-changed' }, ({ payload }) => {
        const { ticketId, zoneId } = payload as { ticketId: number | string; zoneId: string }
        setTicketZones((current) => ({ ...current, [String(ticketId)]: zoneId }))
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'retro_votes', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const vote = payload.new as RemoteVote
        setTicketVotes((current) => {
          const key = String(vote.ticket_id)
          const voters = current[key] ?? []
          return voters.includes(vote.author) ? current : { ...current, [key]: [...voters, vote.author] }
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'retro_votes', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const vote = payload.old as RemoteVote
        const key = String(vote.ticket_id)
        setTicketVotes((current) => ({ ...current, [key]: (current[key] ?? []).filter((author) => author !== vote.author) }))
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'retro_sessions', filter: `id=eq.${sessionId}` }, (payload) => {
        const row = payload.new as { zones: Zone[]; is_open: boolean; vote_open: boolean; vote_finished: boolean; ticket_zones: Record<string, string>; ticket_actions: Record<string, ActionDecision> }
        setZones(row.zones)
        setRetroOpen(row.is_open)
        setVoteOpen(row.vote_open)
        setVoteFinished(row.vote_finished)
        setTicketZones(row.ticket_zones)
        setTicketActions(row.ticket_actions ?? {})
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          channelRef.current = channel
          await channel.track({ user: displayName, isAdmin })
          const { data } = await client.from('retro_sessions').select('*').eq('id', sessionId).maybeSingle()
          if (data) {
            setZones(data.zones as Zone[])
            setRetroOpen(Boolean(data.is_open))
            setVoteOpen(Boolean(data.vote_open))
            setVoteFinished(Boolean(data.vote_finished))
            setTicketZones((data.ticket_zones ?? {}) as Record<string, string>)
            setTicketActions((data.ticket_actions ?? {}) as Record<string, ActionDecision>)
          }
        }
      })

    return () => {
      active = false
      channelRef.current = null
      void client.removeChannel(channel)
    }
  }, [joined, displayName, isAdmin, sessionId])

  const joinSession = async () => {
    const value = pseudo.trim()
    if (!/^@?[a-zA-Z0-9À-ÿ][a-zA-Z0-9À-ÿ _-]{1,23}$/.test(value)) return
    setSessionError('')

    if (isParticipantAccess) {
      if (sessionStatus !== 'valid') return
      setPseudo(value)
      setJoined(true)
      return
    }

    if (!supabase) {
      setSessionError('Configurez Supabase pour créer une séance accessible par QR code.')
      return
    }

    if (!sessionId) {
      const nextSessionId = createSessionKey()
      const { error } = await supabase.from('retro_sessions').insert({
        id: nextSessionId,
        zones: defaultZones,
        is_open: false,
        vote_open: false,
        vote_finished: false,
        ticket_zones: {},
        ticket_actions: {},
      })
      if (error) {
        setSessionError(`La séance n’a pas pu être créée : ${error.message}`)
        return
      }
      setSessionId(nextSessionId)
      setSessionStatus('valid')
    }
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
      const { data, error } = await supabase.from('retro_tickets').insert({
        session_id: sessionId,
        text: ticket.text,
        author: ticket.author,
        color: ticket.color,
        x: ticket.x,
        y: ticket.y,
        is_private: ticket.private,
      }).select().single()
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
    if (draggedId === null || voteOpen || voteFinished) return
    const draggedTicket = tickets.find((ticket) => ticket.id === draggedId)
    if (!draggedTicket || (!isAdmin && draggedTicket.author !== displayName)) return
    const board = event.currentTarget.getBoundingClientRect()
    const x = Math.max(4, Math.min(84, ((event.clientX - board.left) / board.width) * 100 - 8))
    const y = Math.max(4, Math.min(82, ((event.clientY - board.top) / board.height) * 100 - 7))
    setTickets((current) => current.map((ticket) => ticket.id === draggedId ? { ...ticket, x, y } : ticket))
    if (supabase && typeof draggedId === 'number') {
      void channelRef.current?.send({ type: 'broadcast', event: 'ticket-moved', payload: { id: draggedId, author: draggedTicket.author, x, y } })
      void supabase.from('retro_tickets').update({ x, y }).eq('id', draggedId)
    }
  }

  const toggleVote = () => {
    if (!isAdmin) return
    const nextValue = !voteOpen
    setVoteOpen(nextValue)
    void channelRef.current?.send({ type: 'broadcast', event: 'tickets-locked', payload: { locked: nextValue } })
    void saveSessionConfig({ zones, isOpen: retroOpen, voteOpen: nextValue, voteFinished: false, ticketZones, ticketActions })
  }

  const saveSessionConfig = async (config: SessionConfig) => {
    setZones(config.zones)
    setRetroOpen(config.isOpen)
    setVoteOpen(config.voteOpen)
    setVoteFinished(config.voteFinished)
    setTicketZones(config.ticketZones)
    setTicketActions(config.ticketActions)
    void channelRef.current?.send({ type: 'broadcast', event: 'session-configured', payload: config })
    if (supabase) {
      await supabase.from('retro_sessions').upsert({ id: sessionId, zones: config.zones, is_open: config.isOpen, vote_open: config.voteOpen, vote_finished: config.voteFinished, ticket_zones: config.ticketZones, ticket_actions: config.ticketActions })
    }
  }

  const finishVote = () => {
    if (!isAdmin || !voteOpen) return
    setVoteOpen(false)
    void channelRef.current?.send({ type: 'broadcast', event: 'tickets-locked', payload: { locked: false } })
    void saveSessionConfig({ zones, isOpen: retroOpen, voteOpen: false, voteFinished: true, ticketZones, ticketActions })
  }

  const assignTicketZone = (ticketId: number | string, zoneId: string) => {
    if (!isAdmin || !voteFinished) return
    const nextZones = { ...ticketZones, [String(ticketId)]: zoneId }
    void saveSessionConfig({ zones, isOpen: retroOpen, voteOpen, voteFinished, ticketZones: nextZones, ticketActions })
    void channelRef.current?.send({ type: 'broadcast', event: 'ticket-zone-changed', payload: { ticketId, zoneId } })
  }

  const updateZoneName = (zoneId: string, name: string) => {
    setZones((current) => current.map((zone) => zone.id === zoneId ? { ...zone, name } : zone))
  }

  const openRetro = () => {
    if (!isAdmin || zones.some((zone) => !zone.name.trim())) return
    void saveSessionConfig({ zones, isOpen: true, voteOpen: false, voteFinished: false, ticketZones: {}, ticketActions: {} })
  }

  const createNewSession = async () => {
    if (!isAdmin) return
    if (!supabase) {
      setSessionError('Le service temps réel est indisponible. La nouvelle séance ne peut pas être créée.')
      return
    }
    const nextSessionId = createSessionKey()
    const { error } = await supabase.from('retro_sessions').insert({
      id: nextSessionId,
      zones: defaultZones,
      is_open: false,
      vote_open: false,
      vote_finished: false,
      ticket_zones: {},
      ticket_actions: {},
    })
    if (error) {
      setSessionError(`La nouvelle séance n’a pas pu être créée : ${error.message}`)
      return
    }
    await channelRef.current?.send({ type: 'broadcast', event: 'session-ended', payload: {} })
    await supabase.from('retro_tickets').delete().eq('session_id', sessionId)
    await supabase.from('retro_votes').delete().eq('session_id', sessionId)
    await supabase.from('retro_sessions').delete().eq('id', sessionId)
    setSessionId(nextSessionId)
    setSessionStatus('valid')
    setSessionError('')
    setTickets([])
    setTicketVotes({})
    setTicketZones({})
    setTicketActions({})
    setVoteOpen(false)
    setVoteFinished(false)
    setRetroOpen(false)
    setRevealAll(false)
  }

  const voteCountFor = (ticketId: number | string) => ticketVotes[String(ticketId)] ?? []
  const voteTotalFor = (author: string) => Object.values(ticketVotes).filter((voters) => voters.includes(author)).length
  const topVotedTickets = [...tickets].sort((left, right) => {
    const voteDifference = voteCountFor(right.id).length - voteCountFor(left.id).length
    return voteDifference || tickets.indexOf(left) - tickets.indexOf(right)
  }).slice(0, 3)
  const topVotedIds = new Set(topVotedTickets.map((ticket) => String(ticket.id)))

  const updateTicketAction = (ticketId: number | string, nextDecision: ActionDecision) => {
    if (!isAdmin || !voteFinished || !topVotedIds.has(String(ticketId))) return
    const nextActions = { ...ticketActions, [String(ticketId)]: nextDecision }
    void saveSessionConfig({ zones, isOpen: retroOpen, voteOpen, voteFinished, ticketZones, ticketActions: nextActions })
  }

  const voteForTicket = (ticketId: number | string) => {
    if (!voteOpen || !displayName) return
    const voters = voteCountFor(ticketId)
    const key = String(ticketId)
    const hasVoted = voters.includes(displayName)
    if (!hasVoted && voteTotalFor(displayName) >= 3) return
    const nextVoters = hasVoted ? voters.filter((voter) => voter !== displayName) : [...voters, displayName]
    setTicketVotes((current) => ({ ...current, [key]: nextVoters }))
    void channelRef.current?.send({ type: 'broadcast', event: 'ticket-voted', payload: { ticketId, author: displayName, active: !hasVoted } })
    if (supabase && typeof ticketId === 'number') {
      if (hasVoted) {
        void supabase.from('retro_votes').delete().eq('session_id', sessionId).eq('ticket_id', ticketId).eq('author', displayName)
      } else {
        void supabase.from('retro_votes').insert({ session_id: sessionId, ticket_id: ticketId, author: displayName })
      }
    }
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
    const visibleTicketCount = tickets.filter((ticket) => !ticket.private || revealAll).length
    const participantNames = [...new Set([
      ...Object.values(ticketVotes).flat(),
      ...tickets.map((ticket) => ticket.author),
    ])].sort((left, right) => left.localeCompare(right, 'fr'))
    const topTickets = topVotedTickets.map((ticket, index) => {
      const voters = voteCountFor(ticket.id)
      const zoneId = ticketZones[String(ticket.id)]
      const zoneName = zones.find((zone) => zone.id === zoneId)?.name ?? 'Non attribuée'
      return { ticket, rank: index + 1, voters, zoneName, decision: ticketActions[String(ticket.id)] }
    })
    const lines = [
      `# Compte rendu de la rétrospective — ${sessionName}`,
      '',
      `- Session : ${sessionId}`,
      `- Exportée le : ${new Date().toLocaleString('fr-FR')}`,
      `- État : ${voteFinished ? 'Vote terminé et actions définies' : voteOpen ? 'Vote en cours' : 'Collecte des tickets'}`,
      `- Tickets visibles au moment de l’export : ${visibleTicketCount}/${tickets.length}`,
      '',
      '## 1. Configuration de la rétro',
      '',
      '### Zones configurées',
      ...zones.map((zone, index) => `${index + 1}. **${zone.name}**`),
      '',
      '### Participants identifiés',
      ...(participantNames.length ? participantNames.map((name) => `- ${name}`) : ['- Aucun participant identifié']),
      '',
      '## 2. Tickets déposés',
      '',
      ...tickets.flatMap((ticket, index) => {
        const voters = voteCountFor(ticket.id)
        const zoneId = ticketZones[String(ticket.id)]
        const zoneName = zones.find((zone) => zone.id === zoneId)?.name ?? 'Non attribuée'
        const decision = ticketActions[String(ticket.id)]
        const actionText = decision?.status === 'action' ? decision.text || 'Action à préciser' : 'Pas d’action définie'
        return [
          `### Ticket ${index + 1} — ${ticket.author}`,
          '',
          `- Texte : ${ticket.text}`,
          `- Confidentialité initiale : ${ticket.private ? 'Privé' : 'Public'}`,
          `- Couleur : ${ticket.color}`,
          `- Votes : ${voters.length}${voters.length ? ` (${voters.join(', ')})` : ''}`,
          `- Zone attribuée : ${zoneName}`,
          `- Décision : ${actionText}`,
          '',
        ]
      }),
      '',
      '## 3. Résultats du vote',
      '',
      `- Nombre de tickets votés : ${tickets.filter((ticket) => voteCountFor(ticket.id).length > 0).length}`,
      `- Nombre total de votes exprimés : ${tickets.reduce((total, ticket) => total + voteCountFor(ticket.id).length, 0)}`,
      '- Règle appliquée : 1 vote maximum par ticket et 3 votes maximum par participant',
      '',
      '### Classement final',
      ...(topTickets.length ? topTickets.map(({ ticket, rank, voters, zoneName }) => `${rank}. **${ticket.text}** — ${voters.length} vote(s) — Zone : ${zoneName}`) : ['- Aucun classement disponible']),
      '',
      '## 4. Actions finales',
      '',
      ...(topTickets.length ? topTickets.map(({ ticket, rank, voters, zoneName, decision }) => {
        const action = decision?.status === 'action' ? decision.text || 'Action à préciser' : 'Pas d’action'
        return `### Action ${rank} — ${ticket.text}\n- Priorité : ${rank}\n- Votes : ${voters.length}\n- Zone : ${zoneName}\n- Décision : ${action}`
      }) : ['Aucune action finale définie.']),
      '',
      '---',
      'Document généré par GERetro.',
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
    if (!isAdmin || !window.confirm('Créer une nouvelle séance et réinitialiser tous les acteurs, tickets, votes et actions ?')) return
    await createNewSession()
  }

  if (isParticipantAccess && sessionStatus === 'checking') {
    return <main className="waiting-page"><section className="waiting-card"><span className="live-dot" /><p className="eyebrow">Vérification du QR code</p><h1>Connexion à la séance.</h1><p>La clé de l’animateur est en cours de validation.</p></section></main>
  }

  if (isParticipantAccess && sessionStatus === 'invalid') {
    return <main className="login-page"><div className="login-card"><div className="logo-mark">O</div><p className="eyebrow">Accès impossible</p><h1>Ce QR code n’est plus actif.</h1><p className="login-copy">{sessionError}</p><span className="privacy-note">Demandez à l’animateur d’afficher le QR code de la séance en cours.</span></div></main>
  }

  if (!joined) {
    return <main className="login-page"><div className="login-card"><div className="logo-mark">O</div><p className="eyebrow">{isAdmin ? 'Démarrage animateur' : `Séance ${sessionId}`}</p><h1>{isAdmin ? 'Créez la séance avant d’accueillir l’équipe.' : 'Rejoignez la rétro.'}</h1><p className="login-copy">{isAdmin ? 'Votre connexion crée immédiatement une séance unique et son QR code. Les participants ne pourront entrer qu’en le scannant.' : 'Ce QR code a été validé. Choisissez votre pseudo pour rejoindre la séance de l’animateur.'}</p><label htmlFor="pseudo">Votre pseudo</label><input id="pseudo" autoFocus value={pseudo} onChange={(event) => setPseudo(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void joinSession()} placeholder={isAdmin ? 'Ex. Camille' : 'Ex. Morgan'} maxLength={24} />{sessionError && <p className="ticket-error">{sessionError}</p>}<button className="primary-button full" onClick={() => void joinSession()} disabled={!/^@?[a-zA-Z0-9À-ÿ][a-zA-Z0-9À-ÿ _-]{1,23}$/.test(pseudo.trim()) || (isParticipantAccess && sessionStatus !== 'valid')}>{isAdmin ? 'Créer la séance et générer le QR' : 'Rejoindre la rétro'} <span>→</span></button><span className="privacy-note">🔒 {isSupabaseConfigured ? 'Accès sécurisé par la clé du QR code' : 'Supabase requis pour créer et valider les séances'}</span></div></main>
  }

  if (!retroOpen) {
    if (isAdmin) {
      return <main className="setup-page"><section className="setup-card"><p className="eyebrow">Séance créée · partage immédiat</p><h1>Faites scanner le QR code.</h1><p className="setup-copy">C’est l’unique accès participant à cette séance. Vous pouvez ensuite ajuster les zones et ouvrir la rétro.</p><div className="session-share"><div><span className="share-label">Clé de séance</span><strong>{sessionId}</strong><small>Accès participant exclusivement par ce QR code</small></div>{qrCodeUrl && <img src={qrCodeUrl} alt={`QR code de la séance ${sessionId}`} />}</div><div className="zone-config-list">{zones.map((zone, index) => <label className="zone-config" key={zone.id}><span className="zone-swatch" style={{ background: zone.color }} />Zone {index + 1}<input value={zone.name} onChange={(event) => updateZoneName(zone.id, event.target.value)} maxLength={32} /></label>)}</div><button type="button" className="primary-button full" onClick={openRetro} disabled={zones.some((zone) => !zone.name.trim())}>Ouvrir la rétro aux participants <span>→</span></button><button type="button" className="new-session-button" onClick={() => void createNewSession()}>Créer une nouvelle séance</button>{sessionError && <p className="ticket-error">{sessionError}</p>}<small className="share-url">{shareUrl}</small></section></main>
    }
    return <main className="waiting-page"><section className="waiting-card"><span className="live-dot" /><p className="eyebrow">Rétro en préparation</p><h1>L’animateur prépare les zones.</h1><p>Cette page s’ouvrira automatiquement dès que la rétro sera lancée.</p></section></main>
  }

  return (
    <main className="workspace">
      <header className="workspace-header"><a className="brand" href="#workspace"><span className="logo-mark small">O</span><span>GERetro</span></a><div className="session-title"><span className="live-dot" /> Session en cours <strong>{sessionId}</strong></div><div className="user-chip"><span>{displayName.slice(0, 1).toUpperCase()}</span><div><strong>{displayName}</strong><small>{isAdmin ? 'Animateur · admin' : 'Participant'}</small></div><button className="logout-button" onClick={() => setJoined(false)}>Changer</button></div></header>
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
          {isAdmin ? <><button className="reveal-button" onClick={toggleRevealAll}>{revealAll ? 'Masquer les tickets' : 'Révéler tous les tickets'} <span>{revealAll ? '◉' : '◎'}</span></button>{!voteFinished && <button className={voteOpen ? 'vote-launch-button active' : 'vote-launch-button'} onClick={toggleVote}>{voteOpen ? 'Mettre le vote en pause' : 'Lancer le vote'} <span>{voteOpen ? 'Ⅱ' : '→'}</span></button>}{voteOpen && <button className="finish-vote-button" onClick={finishVote}>Fin du vote <span>✓</span></button>}{voteFinished && <p className="vote-finished-note">Vote terminé. Attribuez chaque ticket à une zone.</p>}<button className="reset-button" onClick={resetSession}>Réinitialiser la rétro <span>↺</span></button><button className="export-button" onClick={downloadMarkdown}>Télécharger le Markdown <span>↓</span></button></> : <p className="admin-note">🔒 Seul l’animateur peut révéler, lancer ou terminer le vote, ou réinitialiser la rétro.</p>}
        </aside>
        <section className="board-area">
          {isAdmin && <div className="dashboard-share"><div><span className="share-label">Lien participant</span><strong>Invitez l’équipe à rejoindre la séance</strong></div><a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a></div>}
          <div className="image-board custom-image" style={{ backgroundImage: `url(${backgroundImage})` }} onDragOver={(event) => event.preventDefault()} onDrop={moveTicket}>
            <div className="board-caption"><span>{voteOpen ? 'VOTEZ SUR LES TICKETS' : voteFinished ? 'CLASSEZ LES TICKETS PAR ZONE' : 'ORGANISEZ LES TICKETS SUR L’IMAGE'}</span><small>{voteOpen ? 'Chaque participant dispose de 3 votes.' : voteFinished ? 'Les positions sont verrouillées après le vote.' : isAdmin ? 'Vous pouvez réorganiser tous les tickets avant le vote.' : 'Vous pouvez déplacer uniquement vos tickets.'}</small></div>
            {tickets.map((ticket) => {
              const hidden = ticket.private && ticket.author !== displayName && !revealAll
              const isOwner = ticket.author === displayName
              const canMove = !voteOpen && !voteFinished && (isAdmin || isOwner)
              const canEdit = isOwner && ticket.private && !revealAll && !voteOpen && !voteFinished
              const isEditing = editingTicketId === ticket.id
              const voters = voteCountFor(ticket.id)
              const hasVoted = voters.includes(displayName)
              const assignedZone = ticketZones[String(ticket.id)]
              const isTopVoted = topVotedIds.has(String(ticket.id))
              const topRank = topVotedTickets.findIndex((item) => item.id === ticket.id) + 1
              const decision = ticketActions[String(ticket.id)] ?? { status: 'none' as const, text: '' }
              return <div className={`ticket ${hidden ? 'is-hidden' : ''} ${canMove ? 'is-owned' : 'is-locked'} ${voteOpen ? 'vote-phase' : ''}`} draggable={canMove && !isEditing} onDragStart={() => canMove && !isEditing && setDraggedId(ticket.id)} onDragEnd={() => setDraggedId(null)} key={ticket.id} style={{ left: `${ticket.x}%`, top: `${ticket.y}%`, background: ticket.color }}>
                <div className="ticket-pin" />
                {hidden ? <><span className="lock">🔒</span><span className="hidden-label">Ticket secret</span></> : isEditing ? <div className="ticket-editor"><textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} maxLength={160} autoFocus /><div><button type="button" onClick={() => saveEdit(ticket)}>Enregistrer</button><button type="button" onClick={() => setEditingTicketId(null)}>Annuler</button></div></div> : <><p>{ticket.text}</p><small>{ticket.author} {isOwner ? '· vous' : canMove ? '· déplaçable' : '· lecture seule'}</small>{canEdit && <button type="button" className="edit-ticket" onClick={() => beginEdit(ticket)}>Modifier</button>}{voteOpen && !hidden && <button type="button" className={hasVoted ? 'ticket-vote voted' : 'ticket-vote'} disabled={!hasVoted && voteTotalFor(displayName) >= 3} onClick={() => voteForTicket(ticket.id)}>{hasVoted ? 'RETIRER LE VOTE' : 'VOTE'} <span>{voters.length}</span></button>}{voteFinished && <small className="vote-result">{voters.length} vote{voters.length > 1 ? 's' : ''} · {voters.length ? voters.join(', ') : 'Aucun vote'}</small>}{voteFinished && isTopVoted && <div className="action-decision"><strong>Priorité #{topRank}</strong>{isAdmin ? <><div className="action-choice"><button type="button" className={decision.status === 'action' ? 'selected' : ''} onClick={() => updateTicketAction(ticket.id, { ...decision, status: 'action' })}>Action</button><button type="button" className={decision.status === 'none' ? 'selected' : ''} onClick={() => updateTicketAction(ticket.id, { ...decision, status: 'none', text: '' })}>Pas d’action</button></div>{decision.status === 'action' && <textarea value={decision.text} onChange={(event) => updateTicketAction(ticket.id, { ...decision, text: event.target.value })} placeholder="Décrire l’action à réaliser..." maxLength={240} />}</> : <small>{decision.status === 'action' ? `Action : ${decision.text || 'À préciser'}` : 'Pas d’action'}</small>}</div>}{voteFinished && isAdmin && <div className="zone-assignment"><span>Zone du ticket</span>{zones.map((zone) => <label key={zone.id}><input type="radio" name={`zone-${ticket.id}`} checked={assignedZone === zone.id} onChange={() => assignTicketZone(ticket.id, zone.id)} />{zone.name}</label>)}</div>}{voteFinished && assignedZone && <small className="assigned-zone">Zone : {zones.find((zone) => zone.id === assignedZone)?.name}</small>}</>}
              </div>
            })}
          </div>
          <div className="board-footer"><span><b>{tickets.filter((ticket) => !ticket.private || revealAll).length}</b> tickets visibles sur la carte</span><span>{voteOpen ? 'Votez sur les tickets' : voteFinished ? 'Attribuez les tickets aux zones' : isAdmin ? 'Réorganisez tous les tickets' : 'Déplacez uniquement vos tickets'}</span></div>
        </section>
      </div>
    </main>
  )
}

export default App
