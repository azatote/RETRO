import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, DragEvent } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import backgroundImage from './assets/heart-of-the-team.png'
import cardBack from '../img_taccos_game/dos.png'
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
  inReport: boolean
}

type RemoteTicket = {
  id: number
  text: string
  author: string
  color: string
  x: number
  y: number
  is_private: boolean
  in_report?: boolean
}

type PresenceUser = { user: string; isAdmin: boolean }
type TicketVotes = Record<string, string[]>
type BoardEvent = { ticketId: number | string; author: string }
type RemoteVote = { id: number; ticket_id: number; author: string }
type Zone = { id: string; name: string; color: string }
type ActionDecision = { status: 'action' | 'none'; text: string }
type SessionConfig = { zones: Zone[]; isOpen: boolean; voteOpen: boolean; voteFinished: boolean; ticketZones: Record<string, string>; ticketActions: Record<string, ActionDecision>; maxVotes?: number; actionCount?: number }
type SessionStatus = 'idle' | 'checking' | 'valid' | 'invalid'
type IcebreakerDraw = { author: string; card: number }

const cardNumber = (path: string) => Number(path.match(/(\d+)\.png$/)?.[1] ?? 0)
const cardImages = Object.entries(import.meta.glob<string>('../img_taccos_game/img*.png', { eager: true, import: 'default' }))
  .sort(([left], [right]) => cardNumber(left) - cardNumber(right))
  .map(([, url]) => url)
const DECK_SIZE = 6
const shuffleDuration = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1800

const colors = ['#ffd166', '#ff9f9a', '#9ee7d1', '#b7c9ff']
const colorIcons: Record<string, string> = { '#ffd166': '🟨', '#ff9f9a': '🟥', '#9ee7d1': '🟩', '#b7c9ff': '🟦' }
const zoneIcons = ['🟢', '🟡', '🔵', '🔴', '🟣']
const medals = ['🥇', '🥈', '🥉']
const MAX_SETTING = 10
const clampSetting = (value: number) => Math.min(MAX_SETTING, Math.max(1, Math.round(value) || 1))
const BACKGROUND_BUCKET = 'retro-backgrounds'
const BACKGROUND_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const BACKGROUND_MAX_BYTES = 5 * 1024 * 1024
const toBackgroundUrl = (value: unknown) => typeof value === 'string' && value.startsWith('https://') ? value : null
type Theme = 'light' | 'dark'
const THEME_KEY = 'geretro-theme'
const getInitialTheme = (): Theme => {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
const LIBRARY_FOLDER = 'library'
type LibraryImage = { path: string; url: string; name: string }
const fetchLibrary = async (): Promise<LibraryImage[]> => {
  const client = supabase
  if (!client) return []
  const { data } = await client.storage.from(BACKGROUND_BUCKET).list(LIBRARY_FOLDER, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
  return (data ?? []).filter((file) => file.id && !file.name.startsWith('.')).map((file) => {
    const path = `${LIBRARY_FOLDER}/${file.name}`
    return { path, name: file.name.replace(/^\d+-/, '').replace(/\.[^.]+$/, ''), url: client.storage.from(BACKGROUND_BUCKET).getPublicUrl(path).data.publicUrl }
  })
}
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
  inReport: ticket.in_report ?? true,
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
  const [maxVotes, setMaxVotes] = useState(3)
  const [actionCount, setActionCount] = useState(3)
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  const [boardRatio, setBoardRatio] = useState(1672 / 941)
  const [backgroundUploading, setBackgroundUploading] = useState(false)
  const [libraryImages, setLibraryImages] = useState<LibraryImage[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [linkCopied, setLinkCopied] = useState(false)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [icebreakerOpen, setIcebreakerOpen] = useState(false)
  const [draws, setDraws] = useState<IcebreakerDraw[]>([])
  const [drawing, setDrawing] = useState(false)
  const [icebreakerError, setIcebreakerError] = useState('')
  const drawsRef = useRef<IcebreakerDraw[]>([])
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
  const boardImage = backgroundUrl ?? backgroundImage

  useEffect(() => {
    drawsRef.current = draws
  }, [draws])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const themeToggle = (floating: boolean) => <button type="button" className={floating ? 'theme-toggle floating' : 'theme-toggle'} aria-label={theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre'} title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀️' : '🌙'}</button>

  useEffect(() => {
    let active = true
    const image = new Image()
    image.onload = () => {
      if (active && image.naturalWidth && image.naturalHeight) setBoardRatio(image.naturalWidth / image.naturalHeight)
    }
    image.src = boardImage
    return () => { active = false }
  }, [boardImage])

  useEffect(() => {
    if (!isAdmin || !joined || retroOpen) return
    let active = true
    void fetchLibrary().then((images) => { if (active) setLibraryImages(images) })
    return () => { active = false }
  }, [isAdmin, joined, retroOpen])

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
      .on('broadcast', { event: 'background-changed' }, ({ payload }) => {
        setBackgroundUrl(toBackgroundUrl((payload as { url: unknown }).url))
      })
      .on('broadcast', { event: 'icebreaker-changed' }, ({ payload }) => {
        setIcebreakerOpen(Boolean((payload as { open: boolean }).open))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'retro_icebreaker_draws', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const draw = payload.new as IcebreakerDraw
        setDraws((current) => current.some((item) => item.author === draw.author) ? current : [...current, { author: draw.author, card: draw.card }])
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'retro_icebreaker_draws', filter: `session_id=eq.${sessionId}` }, (payload) => {
        setDraws((current) => current.filter((item) => item.author !== (payload.old as IcebreakerDraw).author))
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
        if (config.maxVotes) setMaxVotes(config.maxVotes)
        if (config.actionCount) setActionCount(config.actionCount)
      })
      .on('broadcast', { event: 'session-ended' }, ({ payload }) => {
        setJoined(false)
        setBackgroundUrl(null)
        setIcebreakerOpen(false)
        setDraws([])
        setSessionStatus('invalid')
        setSessionError((payload as { purged?: boolean })?.purged ? 'La rétro est terminée : toutes ses données ont été effacées.' : 'Cette séance est terminée. Scannez le nouveau QR code affiché par l’animateur.')
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
        const row = payload.new as { zones: Zone[]; is_open: boolean; vote_open: boolean; vote_finished: boolean; ticket_zones: Record<string, string>; ticket_actions: Record<string, ActionDecision>; max_votes?: number; action_count?: number; background_url?: string | null; icebreaker_open?: boolean }
        setZones(row.zones)
        setRetroOpen(row.is_open)
        setVoteOpen(row.vote_open)
        setVoteFinished(row.vote_finished)
        setTicketZones(row.ticket_zones)
        setTicketActions(row.ticket_actions ?? {})
        setMaxVotes(row.max_votes ?? 3)
        setActionCount(row.action_count ?? 3)
        setBackgroundUrl(toBackgroundUrl(row.background_url))
        setIcebreakerOpen(Boolean(row.icebreaker_open))
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
            setMaxVotes(Number(data.max_votes ?? 3))
            setBackgroundUrl(toBackgroundUrl(data.background_url))
            setIcebreakerOpen(Boolean(data.icebreaker_open))
            const { data: drawRows } = await client.from('retro_icebreaker_draws').select('author, card').eq('session_id', sessionId)
            setDraws((drawRows ?? []) as IcebreakerDraw[])
            setActionCount(Number(data.action_count ?? 3))
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
    const ticket = { text, author: displayName, color: selectedColor, ...placement, private: isPrivate, inReport: true }
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
    if (draggedId === null || (!isAdmin && (voteOpen || voteFinished))) return
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
    const payload = { ...config, maxVotes, actionCount }
    void channelRef.current?.send({ type: 'broadcast', event: 'session-configured', payload })
    if (supabase) {
      await supabase.from('retro_sessions').upsert({ id: sessionId, zones: config.zones, is_open: config.isOpen, vote_open: config.voteOpen, vote_finished: config.voteFinished, ticket_zones: config.ticketZones, ticket_actions: config.ticketActions, max_votes: maxVotes, action_count: actionCount })
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

  const toggleTicketReport = async (ticket: Ticket) => {
    if (!voteFinished) return
    const inReport = !ticket.inReport
    setTickets((current) => current.map((item) => item.id === ticket.id ? { ...item, inReport } : item))
    if (!supabase || typeof ticket.id !== 'number') return
    const { error } = await supabase.from('retro_tickets').update({ in_report: inReport }).eq('id', ticket.id)
    if (error) {
      setTickets((current) => current.map((item) => item.id === ticket.id ? { ...item, inReport: !inReport } : item))
      setTicketError(error.message)
    }
  }

  const updateZoneName = (zoneId: string, name: string) => {
    setZones((current) => current.map((zone) => zone.id === zoneId ? { ...zone, name } : zone))
  }

  const openRetro = () => {
    if (!isAdmin || zones.some((zone) => !zone.name.trim())) return
    void saveSessionConfig({ zones, isOpen: true, voteOpen: false, voteFinished: false, ticketZones: {}, ticketActions: {} })
    if (icebreakerOpen) void setIcebreaker(false)
  }

  const setIcebreaker = async (open: boolean) => {
    if (!isAdmin || !supabase) return
    setIcebreakerOpen(open)
    setIcebreakerError('')
    void channelRef.current?.send({ type: 'broadcast', event: 'icebreaker-changed', payload: { open } })
    const { error } = await supabase.from('retro_sessions').update({ icebreaker_open: open }).eq('id', sessionId)
    if (error) setIcebreakerError(`L’ice breaker n’a pas pu être enregistré : ${error.message}`)
  }

  const drawCard = async () => {
    if (drawing || !displayName || draws.some((draw) => draw.author === displayName) || !cardImages.length) return
    setDrawing(true)
    setIcebreakerError('')
    await new Promise((resolve) => window.setTimeout(resolve, shuffleDuration()))
    const allCards = cardImages.map((_, index) => index + 1)
    // Read the latest draws: others may have drawn during the shuffle.
    const taken = new Set(drawsRef.current.map((draw) => draw.card))
    const freeCards = allCards.filter((card) => !taken.has(card))
    const pool = freeCards.length ? freeCards : allCards
    const card = pool[Math.floor(Math.random() * pool.length)]
    setDraws((current) => [...current, { author: displayName, card }])
    if (supabase) {
      const { error } = await supabase.from('retro_icebreaker_draws').insert({ session_id: sessionId, author: displayName, card })
      if (error) {
        setDraws((current) => current.filter((draw) => draw.author !== displayName))
        setIcebreakerError(`Le tirage n’a pas pu être enregistré : ${error.message}`)
      }
    }
    setDrawing(false)
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
    setBackgroundUrl(null)
    setIcebreakerOpen(false)
    setDraws([])
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
  }).slice(0, actionCount)
  const topVotedIds = new Set(topVotedTickets.map((ticket) => String(ticket.id)))
  const votesLabel = `${maxVotes} vote${maxVotes > 1 ? 's' : ''}`

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
    if (!hasVoted && voteTotalFor(displayName) >= maxVotes) return
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
    const reportTickets = tickets.filter((ticket) => ticket.inReport)
    const participantNames = [...new Set([
      ...Object.values(ticketVotes).flat(),
      ...tickets.map((ticket) => ticket.author),
    ])].sort((left, right) => left.localeCompare(right, 'fr'))
    const zoneLabel = (ticketId: number | string) => {
      const index = zones.findIndex((zone) => zone.id === ticketZones[String(ticketId)])
      return index >= 0 ? `${zoneIcons[index % zoneIcons.length]} ${zones[index].name}` : '⚪ Non attribuée'
    }
    const rankLabel = (rank: number) => medals[rank - 1] ?? `#${rank}`
    const quote = (text: string) => `> ${text.replace(/\n/g, '\n> ')}`
    const topTickets = topVotedTickets.filter((ticket) => ticket.inReport).map((ticket, index) => ({
      ticket, rank: index + 1, voters: voteCountFor(ticket.id), zoneName: zoneLabel(ticket.id), decision: ticketActions[String(ticket.id)],
    }))
    const lines = [
      '# 🧭 Compte rendu de la rétrospective',
      '',
      `> 🔑 Session **${sessionId}** · 📅 ${new Date().toLocaleString('fr-FR')} · ${voteFinished ? '✅ Vote terminé' : voteOpen ? '🗳️ Vote en cours' : '✍️ Collecte des tickets'}`,
      `> 📝 Tickets retenus : **${reportTickets.length}/${tickets.length}**`,
      '',
      '## ⚙️ 1. Configuration',
      '',
      '### 🗂️ Zones',
      '',
      ...zones.map((zone, index) => `- ${zoneIcons[index % zoneIcons.length]} **${zone.name}**`),
      '',
      '### 🎛️ Règles',
      '',
      `- 🗳️ Votes par participant : **${maxVotes}**`,
      `- 🎯 Tickets avec action possible : **${actionCount}**`,
      '',
      '### 👥 Participants',
      '',
      ...(participantNames.length ? participantNames.map((name) => `- 👤 ${name}`) : ['_Aucun participant identifié._']),
      '',
      '## 📝 2. Tickets retenus',
      '',
      ...(reportTickets.length ? reportTickets.flatMap((ticket, index) => {
        const voters = voteCountFor(ticket.id)
        const decision = ticketActions[String(ticket.id)]
        const actionText = decision?.status === 'action' ? `🚀 ${decision.text || 'Action à préciser'}` : '⏸️ Pas d’action définie'
        return [
          `### ${colorIcons[ticket.color] ?? '🗒️'} Ticket ${index + 1} — ${ticket.author}`,
          '',
          quote(ticket.text),
          '',
          `- ${ticket.private ? '🔒 Privé' : '🌐 Public'} à la création`,
          `- 🗳️ Votes : ${voters.length}${voters.length ? ` (${voters.join(', ')})` : ''}`,
          `- 📍 Zone : ${zoneLabel(ticket.id)}`,
          `- 🎯 Décision : ${actionText}`,
          '',
        ]
      }) : ['_Aucun ticket retenu._', '']),
      '## 🗳️ 3. Résultats du vote',
      '',
      `- 📊 Tickets votés : ${reportTickets.filter((ticket) => voteCountFor(ticket.id).length > 0).length}`,
      `- ✋ Votes exprimés : ${reportTickets.reduce((total, ticket) => total + voteCountFor(ticket.id).length, 0)}`,
      `- 📏 Règle : 1 vote maximum par ticket, ${votesLabel} par participant`,
      '',
      '### 🏆 Classement final',
      '',
      ...(topTickets.length ? topTickets.map(({ ticket, rank, voters, zoneName }) => `- ${rankLabel(rank)} **${ticket.text}** — ${voters.length} vote(s) — ${zoneName}`) : ['_Aucun classement disponible._']),
      '',
      '## ✅ 4. Plan d’action',
      '',
      ...(topTickets.length ? topTickets.flatMap(({ ticket, rank, voters, zoneName, decision }) => [
        `### ${rankLabel(rank)} ${ticket.text}`,
        '',
        `- 🗳️ Votes : ${voters.length}`,
        `- 📍 Zone : ${zoneName}`,
        `- 🎯 Décision : ${decision?.status === 'action' ? `🚀 ${decision.text || 'Action à préciser'}` : '⏸️ Pas d’action'}`,
        '',
      ]) : ['_Aucune action finale définie._', '']),
      '---',
      '',
      '_✨ Document généré par GERetro._',
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

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      window.prompt('Copiez le lien participant :', shareUrl)
    }
  }

  const applyBackground = async (url: string | null) => {
    if (!supabase) return 'Le service temps réel est indisponible.'
    const { error } = await supabase.from('retro_sessions').update({ background_url: url }).eq('id', sessionId)
    if (error) return error.message
    setBackgroundUrl(url)
    void channelRef.current?.send({ type: 'broadcast', event: 'background-changed', payload: { url } })
    return null
  }

  const uploadBackground = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!isAdmin || !supabase || !file) return
    if (!BACKGROUND_TYPES.includes(file.type) || file.size > BACKGROUND_MAX_BYTES) {
      window.alert('Choisissez une image PNG, JPEG ou WebP de 5 Mo maximum.')
      return
    }
    setBackgroundUploading(true)
    const baseName = file.name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image'
    const path = `${LIBRARY_FOLDER}/${Date.now()}-${baseName}.${file.type.split('/')[1]}`
    const upload = await supabase.storage.from(BACKGROUND_BUCKET).upload(path, file, { contentType: file.type })
    const error = upload.error?.message ?? await applyBackground(supabase.storage.from(BACKGROUND_BUCKET).getPublicUrl(path).data.publicUrl)
    if (error) window.alert(`L’image n’a pas pu être enregistrée : ${error}`)
    setLibraryImages(await fetchLibrary())
    setBackgroundUploading(false)
  }

  const selectBackground = async (url: string | null) => {
    if (!isAdmin || url === backgroundUrl) return
    const error = await applyBackground(url)
    if (error) window.alert(`L’image n’a pas pu être appliquée : ${error}`)
  }

  const deleteLibraryImage = async (image: LibraryImage) => {
    if (!isAdmin || !supabase || !window.confirm(`Supprimer définitivement « ${image.name} » de la bibliothèque ?`)) return
    const { error } = await supabase.storage.from(BACKGROUND_BUCKET).remove([image.path])
    if (error) {
      window.alert(`L’image n’a pas pu être supprimée : ${error.message}`)
      return
    }
    if (backgroundUrl === image.url) await applyBackground(null)
    setLibraryImages((current) => current.filter((item) => item.path !== image.path))
  }

  const resetBackground = async () => {
    if (!isAdmin) return
    const error = await applyBackground(null)
    if (error) window.alert(`L’image par défaut n’a pas pu être rétablie : ${error}`)
  }

  const purgeSession = async () => {
    if (!isAdmin || !supabase) return
    if (!window.confirm('Terminer la rétro et effacer définitivement toutes ses données (tickets, votes, zones, actions) ?\n\nLes images de la bibliothèque sont conservées. Téléchargez le Markdown avant : cette action est irréversible.')) return
    const votes = await supabase.from('retro_votes').delete().eq('session_id', sessionId)
    const ticketsResult = await supabase.from('retro_tickets').delete().eq('session_id', sessionId)
    const session = await supabase.from('retro_sessions').delete().eq('id', sessionId)
    const error = votes.error ?? ticketsResult.error ?? session.error
    if (error) {
      window.alert(`Les données n’ont pas pu être entièrement effacées : ${error.message}`)
      return
    }
    await channelRef.current?.send({ type: 'broadcast', event: 'session-ended', payload: { purged: true } })
    setJoined(false)
    setBackgroundUrl(null)
    setIcebreakerOpen(false)
    setDraws([])
    setSessionId('')
    setSessionStatus('idle')
    setSessionError('')
    setQrCodeUrl('')
    setTickets([])
    setTicketVotes({})
    setTicketZones({})
    setTicketActions({})
    setZones(defaultZones)
    setVoteOpen(false)
    setVoteFinished(false)
    setRetroOpen(false)
    setRevealAll(false)
  }

  if (isParticipantAccess && sessionStatus === 'checking') {
    return <main className="waiting-page">{themeToggle(true)}<section className="waiting-card"><span className="live-dot" /><p className="eyebrow">Vérification du QR code</p><h1>Connexion à la <span className="accent">séance.</span></h1><p>La clé de l’animateur est en cours de validation.</p></section></main>
  }

  if (isParticipantAccess && sessionStatus === 'invalid') {
    return <main className="login-page">{themeToggle(true)}<div className="login-card"><div className="logo-mark">O</div><p className="eyebrow">Accès impossible</p><h1>Ce QR code n’est plus <span className="accent">actif.</span></h1><p className="login-copy">{sessionError}</p><span className="privacy-note">Demandez à l’animateur d’afficher le QR code de la séance en cours.</span></div></main>
  }

  if (!joined) {
    return <main className="login-page">{themeToggle(true)}<div className="login-card"><div className="logo-mark">O</div><p className="eyebrow">{isAdmin ? 'Démarrage animateur' : `Séance ${sessionId}`}</p><h1>{isAdmin ? <>Créez la séance avant d’accueillir <span className="accent">l’équipe.</span></> : <>Rejoignez la <span className="accent">rétro.</span></>}</h1><p className="login-copy">{isAdmin ? 'Votre connexion crée immédiatement une séance unique et son QR code. Les participants ne pourront entrer qu’en le scannant.' : 'Ce QR code a été validé. Choisissez votre pseudo pour rejoindre la séance de l’animateur.'}</p><label htmlFor="pseudo">Votre pseudo</label><input id="pseudo" autoFocus value={pseudo} onChange={(event) => setPseudo(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void joinSession()} placeholder={isAdmin ? 'Ex. Camille' : 'Ex. Morgan'} maxLength={24} />{sessionError && <p className="ticket-error">{sessionError}</p>}<button className="primary-button full" onClick={() => void joinSession()} disabled={!/^@?[a-zA-Z0-9À-ÿ][a-zA-Z0-9À-ÿ _-]{1,23}$/.test(pseudo.trim()) || (isParticipantAccess && sessionStatus !== 'valid')}>{isAdmin ? 'Créer la séance et générer le QR' : 'Rejoindre la rétro'} <span>→</span></button><span className="privacy-note">🔒 {isSupabaseConfigured ? 'Accès sécurisé par la clé du QR code' : 'Supabase requis pour créer et valider les séances'}</span></div></main>
  }

  if (!retroOpen) {
    if (icebreakerOpen) {
      const myDraw = draws.find((draw) => draw.author === displayName)
      const waitingUsers = visibleOnlineUsers.filter((user) => !draws.some((draw) => draw.author === user))
      return <main className="setup-page">{themeToggle(true)}<section className="setup-card icebreaker-card"><p className="eyebrow">🌮 Ice breaker · Taccos</p><h1>Tirez votre <span className="accent">carte.</span></h1><p className="setup-copy">Chacun tire une carte au hasard et explique en quoi elle lui ressemble aujourd’hui.</p>{myDraw ? <div className="card-flip"><img className="card-face card-back" src={cardBack} alt="" /><img className="card-face card-front" src={cardImages[myDraw.card - 1]} alt={`Votre carte Taccos n°${myDraw.card}`} /></div> : <><div className={drawing ? 'deck shuffling' : 'deck'} aria-hidden="true">{Array.from({ length: DECK_SIZE }, (_, index) => <img key={index} src={cardBack} alt="" style={{ '--i': index } as CSSProperties} />)}</div><button type="button" className="primary-button full draw-button" onClick={() => void drawCard()} disabled={drawing}>{drawing ? 'Mélange des cartes…' : 'Tirer ma carte'} <span>→</span></button></>}{icebreakerError && <p className="ticket-error">{icebreakerError}</p>}{draws.some((draw) => draw.author !== displayName) && <div className="draw-grid">{draws.filter((draw) => draw.author !== displayName).map((draw) => <figure key={draw.author}><img src={cardImages[draw.card - 1]} alt={`Carte Taccos de ${draw.author}`} loading="lazy" /><figcaption>{draw.author}</figcaption></figure>)}</div>}{waitingUsers.length > 0 && <p className="draw-waiting">En attente de tirage : {waitingUsers.join(', ')}</p>}{isAdmin ? <button type="button" className="primary-button full" onClick={openRetro} disabled={zones.some((zone) => !zone.name.trim())}>Passer à la rétro <span>→</span></button> : <p className="draw-waiting">L’animateur lancera la rétro juste après.</p>}</section></main>
    }
    if (isAdmin) {
      return <main className="setup-page">{themeToggle(true)}<section className="setup-card"><p className="eyebrow">Séance créée · partage immédiat</p><h1>Faites scanner le <span className="accent">QR code.</span></h1><p className="setup-copy">C’est l’unique accès participant à cette séance. Vous pouvez ensuite ajuster les zones et ouvrir la rétro.</p><div className="session-share"><div><span className="share-label">Clé de séance</span><strong>{sessionId}</strong><small>Accès participant exclusivement par ce QR code</small></div>{qrCodeUrl && <img src={qrCodeUrl} alt={`QR code de la séance ${sessionId}`} />}</div><div className="setup-settings"><label>Votes par participant<input type="number" min={1} max={MAX_SETTING} value={maxVotes} onChange={(event) => setMaxVotes(clampSetting(Number(event.target.value)))} /></label><label>Tickets avec action possible<input type="number" min={1} max={MAX_SETTING} value={actionCount} onChange={(event) => setActionCount(clampSetting(Number(event.target.value)))} /></label></div><div className="background-library"><span className="share-label">Image de fond</span><div className="library-grid"><div className={!backgroundUrl ? 'library-item selected' : 'library-item'}><button type="button" onClick={() => void selectBackground(null)}><img src={backgroundImage} alt="" /><span>Image par défaut</span></button></div>{libraryImages.map((image) => <div className={backgroundUrl === image.url ? 'library-item selected' : 'library-item'} key={image.path}><button type="button" onClick={() => void selectBackground(image.url)}><img src={image.url} alt="" loading="lazy" /><span>{image.name}</span></button><button type="button" className="library-delete" aria-label={`Supprimer ${image.name}`} onClick={() => void deleteLibraryImage(image)}>×</button></div>)}<label className="library-item library-upload">{backgroundUploading ? 'Envoi…' : '+ Ajouter une image'}<input type="file" accept={BACKGROUND_TYPES.join(',')} disabled={backgroundUploading} onChange={(event) => void uploadBackground(event)} /></label></div></div><div className="zone-config-list">{zones.map((zone, index) => <label className="zone-config" key={zone.id}><span className="zone-swatch" style={{ background: zone.color }} />Zone {index + 1}<input value={zone.name} onChange={(event) => updateZoneName(zone.id, event.target.value)} maxLength={32} /></label>)}</div><button type="button" className="icebreaker-launch" onClick={() => void setIcebreaker(true)}>🌮 Lancer l’ice breaker Taccos</button><button type="button" className="primary-button full" onClick={openRetro} disabled={zones.some((zone) => !zone.name.trim())}>Ouvrir la rétro aux participants <span>→</span></button><button type="button" className="new-session-button" onClick={() => void createNewSession()}>Créer une nouvelle séance</button>{sessionError && <p className="ticket-error">{sessionError}</p>}<small className="share-url">{shareUrl}</small></section></main>
    }
    return <main className="waiting-page">{themeToggle(true)}<section className="waiting-card"><span className="live-dot" /><p className="eyebrow">Rétro en préparation</p><h1>L’animateur prépare les <span className="accent">zones.</span></h1><p>Cette page s’ouvrira automatiquement dès que la rétro sera lancée.</p></section></main>
  }

  return (
    <main className="workspace">
      <header className="workspace-header"><div className="header-left"><button type="button" className="burger-button" aria-label={sidebarOpen ? 'Masquer le menu' : 'Afficher le menu'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}><span /><span /><span /></button><a className="brand" href="#workspace"><span className="logo-mark small">O</span><span>GERetro</span></a></div><div className="session-title"><span className="live-dot" /> Session en cours <strong>{sessionId}</strong></div><div className="user-chip">{themeToggle(false)}<span>{displayName.slice(0, 1).toUpperCase()}</span><div><strong>{displayName}</strong><small>{isAdmin ? 'Animateur · admin' : 'Participant'}</small></div><button className="logout-button" onClick={() => setJoined(false)}>Changer</button></div></header>
      <div className={sidebarOpen ? 'workspace-layout' : 'workspace-layout sidebar-hidden'}>
        {sidebarOpen && <aside className="sidebar">
          <div className="side-heading"><div><p className="eyebrow">Espace de travail</p>{isAdmin && <button type="button" className="copy-link-button" onClick={() => void copyShareUrl()}>{linkCopied ? 'Lien copié ✓' : 'Copier le lien'}</button>}<h2>Vos tickets</h2></div><span className="ticket-count">{tickets.length}</span></div>
          <div className="online-panel"><div className="online-heading"><span><i className="live-dot" /> Dans la rétro</span><strong>{visibleOnlineUsers.length}</strong></div><div className="online-list">{visibleOnlineUsers.map((user) => <span className={user === displayName ? 'online-user current' : 'online-user'} key={user}><i />{user}{user === displayName && <small>vous</small>}</span>)}</div></div>
          <p className="side-help">Écrivez ce que vous voulez déposer sur la carte. Les tickets privés ne sont visibles que par vous.</p>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Une idée, un ressenti, un fait..." rows={4} maxLength={160} disabled={voteOpen} />
          <div className="compose-row"><div className="swatches">{colors.map((color) => <button aria-label={`Couleur ${color}`} className={selectedColor === color ? 'swatch selected' : 'swatch'} key={color} style={{ background: color }} onClick={() => setSelectedColor(color)} disabled={voteOpen} />)}</div><span className="char-count">{draft.length}/160</span></div>
          <label className="private-toggle"><input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} disabled={voteOpen} /><span className="fake-check">{isPrivate ? '✓' : ''}</span><span><strong>Ticket privé</strong><small>Caché aux autres jusqu’à ce que l’animateur révèle les tickets</small></span></label>
          <button className="primary-button full" onClick={addTicket} disabled={!draft.trim() || voteOpen}>+ Créer le ticket</button>{ticketError && <p className="ticket-error">Impossible d’enregistrer le ticket : {ticketError}</p>}
          <div className="vote-panel"><strong>{voteOpen ? 'Phase 2 · Vote' : 'Phase 1 · Collecte'}</strong><small>{voteOpen ? `Votez une fois par ticket, avec ${votesLabel} au total.` : 'L’animateur lance le vote quand les tickets sont prêts.'}</small><span className="vote-total">Mes votes : {voteTotalFor(displayName)}/{maxVotes}</span></div>
          <div className="side-divider" />
          <div className="legend"><span><i className="legend-dot private" /> Privé</span><span><i className="legend-dot public" /> Révélé</span></div>
          {isAdmin ? <><label className="background-button">{backgroundUploading ? 'Envoi de l’image…' : 'Changer l’image de fond'} <span>🖼</span><input type="file" accept={BACKGROUND_TYPES.join(',')} disabled={backgroundUploading} onChange={(event) => void uploadBackground(event)} /></label>{backgroundUrl && <button className="background-reset" onClick={() => void resetBackground()}>Rétablir l’image par défaut</button>}<button className="reveal-button" onClick={toggleRevealAll}>{revealAll ? 'Masquer les tickets' : 'Révéler tous les tickets'} <span>{revealAll ? '◉' : '◎'}</span></button>{!voteFinished && <button className={voteOpen ? 'vote-launch-button active' : 'vote-launch-button'} onClick={toggleVote}>{voteOpen ? 'Mettre le vote en pause' : 'Lancer le vote'} <span>{voteOpen ? 'Ⅱ' : '→'}</span></button>}{voteOpen && <button className="finish-vote-button" onClick={finishVote}>Fin du vote <span>✓</span></button>}{voteFinished && <p className="vote-finished-note">Vote terminé. Attribuez chaque ticket à une zone.</p>}<button className="reset-button" onClick={resetSession}>Réinitialiser la rétro <span>↺</span></button><button className="export-button" onClick={downloadMarkdown}>Télécharger le Markdown <span>↓</span></button><button className="purge-button" onClick={() => void purgeSession()}>Terminer et tout effacer <span>✕</span></button></> : <p className="admin-note">🔒 Seul l’animateur peut révéler, lancer ou terminer le vote, ou réinitialiser la rétro.</p>}
        </aside>}
        <section className="board-area">
          <div className="board-stage"><div className="image-board custom-image" style={{ backgroundImage: `url("${boardImage}")`, '--board-ratio': boardRatio } as CSSProperties} onDragOver={(event) => event.preventDefault()} onDrop={moveTicket}>
            <div className="board-caption"><span>{voteOpen ? 'VOTEZ SUR LES TICKETS' : voteFinished ? 'CLASSEZ LES TICKETS PAR ZONE' : 'ORGANISEZ LES TICKETS SUR L’IMAGE'}</span><small>{isAdmin ? voteOpen ? `Chaque participant dispose de ${votesLabel}. Vous pouvez toujours réorganiser les tickets.` : 'Vous pouvez réorganiser tous les tickets.' : voteOpen ? `Chaque participant dispose de ${votesLabel}.` : voteFinished ? 'Seul l’animateur peut encore déplacer les tickets.' : 'Vous pouvez déplacer uniquement vos tickets.'}</small></div>
            {tickets.map((ticket) => {
              const hidden = ticket.private && ticket.author !== displayName && !revealAll
              const isOwner = ticket.author === displayName
              const canMove = isAdmin || (isOwner && !voteOpen && !voteFinished)
              const canEdit = isOwner && ticket.private && !revealAll && !voteOpen && !voteFinished
              const isEditing = editingTicketId === ticket.id
              const voters = voteCountFor(ticket.id)
              const hasVoted = voters.includes(displayName)
              const assignedZone = ticketZones[String(ticket.id)]
              const isTopVoted = topVotedIds.has(String(ticket.id))
              const topRank = topVotedTickets.findIndex((item) => item.id === ticket.id) + 1
              const decision = ticketActions[String(ticket.id)] ?? { status: 'none' as const, text: '' }
              return <div className={`ticket ${hidden ? 'is-hidden' : ''} ${canMove ? 'is-owned' : 'is-locked'} ${voteOpen ? 'vote-phase' : ''} ${voteFinished && !ticket.inReport ? 'is-excluded' : ''}`} draggable={canMove && !isEditing} onDragStart={() => canMove && !isEditing && setDraggedId(ticket.id)} onDragEnd={() => setDraggedId(null)} key={ticket.id} style={{ left: `${ticket.x}%`, top: `${ticket.y}%`, background: ticket.color }}>
                <div className="ticket-pin" />
                {hidden ? <><span className="lock">🔒</span><span className="hidden-label">Ticket secret</span></> : isEditing ? <div className="ticket-editor"><textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} maxLength={160} autoFocus /><div><button type="button" onClick={() => saveEdit(ticket)}>Enregistrer</button><button type="button" onClick={() => setEditingTicketId(null)}>Annuler</button></div></div> : <><p>{ticket.text}</p><small>{ticket.author} {isOwner ? '· vous' : canMove ? '· déplaçable' : '· lecture seule'}</small>{canEdit && <button type="button" className="edit-ticket" onClick={() => beginEdit(ticket)}>Modifier</button>}{voteOpen && !hidden && <button type="button" className={hasVoted ? 'ticket-vote voted' : 'ticket-vote'} disabled={!hasVoted && voteTotalFor(displayName) >= maxVotes} onClick={() => voteForTicket(ticket.id)}>{hasVoted ? 'RETIRER LE VOTE' : 'VOTE'} <span>{voters.length}</span></button>}{voteFinished && <small className="vote-result">{voters.length} vote{voters.length > 1 ? 's' : ''} · {voters.length ? voters.join(', ') : 'Aucun vote'}</small>}{voteFinished && isTopVoted && <div className="action-decision"><strong>Priorité #{topRank}</strong>{isAdmin ? <><div className="action-choice"><button type="button" className={decision.status === 'action' ? 'selected' : ''} onClick={() => updateTicketAction(ticket.id, { ...decision, status: 'action' })}>Action</button><button type="button" className={decision.status === 'none' ? 'selected' : ''} onClick={() => updateTicketAction(ticket.id, { ...decision, status: 'none', text: '' })}>Pas d’action</button></div>{decision.status === 'action' && <textarea value={decision.text} onChange={(event) => updateTicketAction(ticket.id, { ...decision, text: event.target.value })} placeholder="Décrire l’action à réaliser..." maxLength={240} />}</> : <small>{decision.status === 'action' ? `Action : ${decision.text || 'À préciser'}` : 'Pas d’action'}</small>}</div>}{voteFinished && isAdmin && <div className="zone-assignment"><span>Zone du ticket</span>{zones.map((zone) => <label key={zone.id}><input type="radio" name={`zone-${ticket.id}`} checked={assignedZone === zone.id} onChange={() => assignTicketZone(ticket.id, zone.id)} />{zone.name}</label>)}</div>}{voteFinished && assignedZone && <small className="assigned-zone">Zone : {zones.find((zone) => zone.id === assignedZone)?.name}</small>}{voteFinished && <label className="report-toggle"><input type="checkbox" checked={ticket.inReport} onChange={() => void toggleTicketReport(ticket)} />Dans le compte rendu</label>}</>}
              </div>
            })}
          </div></div>
          <div className="board-footer"><span><b>{tickets.filter((ticket) => !ticket.private || revealAll).length}</b> tickets visibles sur la carte</span><span>{voteOpen ? 'Votez sur les tickets' : voteFinished ? 'Attribuez les tickets aux zones' : isAdmin ? 'Réorganisez tous les tickets' : 'Déplacez uniquement vos tickets'}</span></div>
        </section>
      </div>
    </main>
  )
}

export default App
