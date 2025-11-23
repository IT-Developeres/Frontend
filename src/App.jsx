import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const SHARE_SERVER = (() => {
  if (import.meta.env.VITE_SHARE_SERVER) {
    return import.meta.env.VITE_SHARE_SERVER
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    const port = import.meta.env.VITE_SHARE_SERVER_PORT ?? '4000'
    return `${protocol}//${hostname}:${port}`
  }

  return 'http://localhost:4000'
})()
const LOCAL_ROOM = 'LOCAL-NET'
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const STATUS_TEXT = {
  idle: 'Waiting',
  waiting: 'Waiting for code',
  connecting: 'Connecting...',
  connected: 'Live',
  disconnected: 'Disconnected',
  error: 'Connection issue',
}

function App() {
  const [mode, setMode] = useState('local')
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState([])
  const [sessionCode, setSessionCode] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [status, setStatus] = useState('idle')
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [theme, setTheme] = useState('light')
  const [infoTab, setInfoTab] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const socketRef = useRef(null)
  const copyTimerRef = useRef(null)
  const saveTimerRef = useRef(null)
  const fileInputRef = useRef(null)

  const isLocalMode = mode === 'local'
  const roomCode = isLocalMode ? LOCAL_ROOM : sessionCode
  const localAccessHint = (() => {
    if (typeof window === 'undefined') {
      return 'http://<your-ip>:5173'
    }
    const { protocol, hostname, port } = window.location
    const displayHost = hostname === 'localhost' ? '<your-computer-ip>' : hostname
    const portSegment = port ? `:${port}` : ''
    return `${protocol}//${displayHost}${portSegment}`
  })()

  const syncPayload = (nextTextValue, nextAttachmentsValue) => {
    const payload = JSON.stringify({
      text: nextTextValue,
      attachments: nextAttachmentsValue,
    })
    socketRef.current?.emit('update-data', payload)
  }

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current)
      }
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.theme = theme
    }
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }
    const handleResize = () => {
      if (window.innerWidth >= 900) {
        setIsSidebarOpen(false)
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isSidebarOpen || typeof window === 'undefined') {
      return undefined
    }
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        setIsSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isSidebarOpen])

  useEffect(() => {
    if (!roomCode) {
      setStatus('waiting')
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      return
    }

    setStatus('connecting')
    const socket = io(SHARE_SERVER, {
      transports: ['websocket'],
      query: { roomCode },
    })
    socketRef.current = socket

    socket.on('connect', () => setStatus('connected'))
    socket.on('disconnect', () => setStatus('disconnected'))
    socket.on('connect_error', () => setStatus('error'))
    socket.on('sync-data', (payload) => {
      if (typeof payload !== 'string') {
        setText('')
        setAttachments([])
        setHasUnsavedChanges(false)
        return
      }
      try {
        const parsed = JSON.parse(payload)
        setText(typeof parsed.text === 'string' ? parsed.text : '')
        setAttachments(Array.isArray(parsed.attachments) ? parsed.attachments : [])
      } catch (_error) {
        setText(payload)
        setAttachments([])
      } finally {
        setHasUnsavedChanges(false)
      }
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [roomCode])

  const handleTextChange = (event) => {
    const value = event.target.value
    setText(value)
    setHasUnsavedChanges(true)
  }

  const openSidebar = () => setIsSidebarOpen(true)
  const closeSidebar = () => setIsSidebarOpen(false)

  const openRemoteShortcut = () => {
    setInfoTab('remote')
    if (typeof window !== 'undefined' && window.innerWidth < 900) {
      setIsSidebarOpen(true)
    }
  }

  const handleMobileRemoteCode = async () => {
    openRemoteShortcut()
    if (!sessionCode) {
      await createRemoteSession()
    }
  }

  const startRemoteSession = (code = '') => {
    const normalized = (code ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6)
    if (!normalized) {
      return
    }
    setMode('remote')
    setSessionCode(normalized)
    setManualCode(normalized)
    setInfoTab('remote')
  }

  const createRemoteSession = async () => {
    try {
      setIsGenerating(true)
      const resp = await fetch(`${SHARE_SERVER}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!resp.ok) {
        throw new Error('Failed to create session')
      }
      const data = await resp.json()
      startRemoteSession(data.code)
    } catch (error) {
      console.error(error)
      alert('Unable to create a share code. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  const joinWithCode = () => {
    if (!manualCode.trim()) {
      return
    }
    startRemoteSession(manualCode)
  }

  const handleCodeChange = (event) => {
    const value = event.target.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6)
    setManualCode(value)
  }

  const resetRemoteSession = () => {
    setMode('local')
    setSessionCode('')
    setManualCode('')
    setText('')
    setAttachments([])
    setStatus('idle')
    socketRef.current?.disconnect()
    socketRef.current = null
    setInfoTab('')
    setHasUnsavedChanges(false)
  }

  const toggleInfoTab = (tabKey) => {
    setInfoTab((current) => (current === tabKey ? '' : tabKey))
  }

  const handleCopyCode = async () => {
    if (!sessionCode) return
    try {
      await navigator.clipboard.writeText(sessionCode)
      setCopied(true)
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current)
      }
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error(error)
    }
  }

  const handleAttachFileClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelected = (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      alert('File is too large. Please pick something under 5MB.')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    setIsUploading(true)
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        setIsUploading(false)
        event.target.value = ''
        return
      }

      const snippet = (() => {
        if (file.type.startsWith('image/')) {
          return `![${file.name}](${result})`
        }
        if (file.type.startsWith('video/')) {
          return `<video controls src="${result}"></video>`
        }
        return `[${file.name}](${result})`
      })()

      const attachment = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        name: file.name,
        type: file.type,
        dataUrl: result,
      }

      const nextText = text ? `${text}\n\n${snippet}` : snippet
      setText(nextText)
      setAttachments((current) => [...current, attachment])
      setHasUnsavedChanges(true)
      setIsUploading(false)
      event.target.value = ''
    }

    reader.onerror = () => {
      alert('Unable to read that file. Please try another.')
      setIsUploading(false)
      event.target.value = ''
    }

    reader.readAsDataURL(file)
  }

  const handleSave = () => {
    if (!hasUnsavedChanges) {
      return
    }
    if (status !== 'connected') {
      alert('Connection is not ready yet. Please wait until the session is live before saving.')
      return
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    setIsSaving(true)
    syncPayload(text, attachments)
    setHasUnsavedChanges(false)
    saveTimerRef.current = setTimeout(() => {
      setIsSaving(false)
    }, 600)
  }

  const handleClear = () => {
    if (!text && attachments.length === 0) {
      return
    }
    setText('')
    setAttachments([])
    setHasUnsavedChanges(false)
    syncPayload('', [])
  }

  const statusLabel = STATUS_TEXT[status] ?? status
  const editorPlaceholder =
    isLocalMode
      ? 'Type anything to share instantly with devices on the same Wi-Fi network...'
      : sessionCode
        ? 'Connected via code. Start typing to share...'
        : 'Enter or create a code to begin sharing...'
  const nextThemeLabel = theme === 'dark' ? 'Light' : 'Dark'
  const canSave = hasUnsavedChanges && status === 'connected'
  const canClear = Boolean(text || attachments.length)
  const saveButtonLabel = isSaving ? 'Saving…' : 'Save & Share'

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="masthead-top">
          <p className="eyebrow">Inspired by AirForShare</p>
          <div className="masthead-controls">
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              aria-label={`Switch to ${nextThemeLabel} mode`}
            >
              <span className="toggle-icon" aria-hidden="true">
                {theme === 'dark' ? '🌙' : '☀️'}
              </span>
              <span className="toggle-label">{nextThemeLabel} mode</span>
            </button>
            <button
              type="button"
              className="mobile-sidebar-toggle"
              onClick={openSidebar}
              aria-expanded={isSidebarOpen}
              aria-controls="share-sidebar"
            >
              <span className="hamburger-icon" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="sr-only">Share options</span>
            </button>
          </div>
        </div>
        <h1>Share snippets across devices in a blink</h1>
        <div className="masthead-summary">
          <p>
            Your same-network scratchpad is always on. Need to reach someone beyond your Wi-Fi? Spin
            up a secure code in one tap.
          </p>
          <div className="masthead-pill">Local mode is live automatically—no code needed.</div>
        </div>
      </header>

      <section className="connection-section">
        <section
          id="share-sidebar"
          className={`connection-section ${isSidebarOpen ? 'sidebar-open' : ''}`}
          aria-hidden={!isSidebarOpen}
        >
          <div className="sidebar-mobile-bar">
            <span>Share options</span>
            <button type="button" className="sidebar-close" onClick={closeSidebar} aria-label="Close share options">
              ×
            </button>
        </div>
        <div className="connection-tabs">
          <button
            type="button"
            className={`tab-trigger ${infoTab === 'local' ? 'active' : ''}`}
            onClick={() => toggleInfoTab('local')}
          >
            <span className="tab-label">Local devices</span>
            <span className="tab-desc">Share instantly on the same Wi-Fi</span>
            <span className={`live-chip ${isLocalMode ? 'active' : ''}`}>
              {isLocalMode ? 'Live now' : 'Inactive'}
            </span>
          </button>
          <button
            type="button"
            className={`tab-trigger ${infoTab === 'remote' ? 'active' : ''}`}
            onClick={() => toggleInfoTab('remote')}
          >
            <span className="tab-label">Remote code</span>
            <span className="tab-desc">Pair with anyone using a six-letter key</span>
            {sessionCode ? (
              <span className="live-chip active">Code {sessionCode}</span>
            ) : (
              <span className="live-chip">Awaiting code</span>
            )}
          </button>
        </div>

        {infoTab && (
          <div className="tab-panel open">
            {infoTab === 'local' ? (
              <article className="connection-panel local-panel">
                <div className="panel-intro">
                  <span className="pill success">Same Wi-Fi</span>
                  <h2>Instant local drop zone</h2>
                  <p>
                    Keep this page open on any device connected to your router. Everything you type
                    stays in sync without entering a single code.
                  </p>
                </div>
                <ul className="tip-list">
                  <li>
                    Share this link on Wi-Fi: <code>Current Link in the browser</code>
                  </li>
                  <li>Replace “localhost” with your computer IP if needed.</li>
                  <li>Leave the tab open on all devices for live updates.</li>
                </ul>
                {!isLocalMode && (
                  <div className="panel-footer">
                    <button type="button" className="secondary-btn" onClick={resetRemoteSession}>
                      Switch back to local share
                    </button>
                  </div>
                )}
              </article>
            ) : (
              <article className="connection-panel remote-panel">
                <div className="panel-intro">
                  <span className="pill accent">Remote</span>
                  <h2>Bridge different networks</h2>
                  <p>Generate a six-letter code or join an existing one to sync with anyone.</p>
                </div>

                <div className="field-group">
                  <label htmlFor="code-input">Join an existing room</label>
                  <div className="input-row">
                    <input
                      id="code-input"
                      placeholder="e.g. D9KLMN"
                      value={manualCode}
                      onChange={handleCodeChange}
                      maxLength={6}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={joinWithCode}
                      disabled={!manualCode}
                    >
                      Join
                    </button>
                  </div>
                </div>

                <div className="divider">
                  <span>or</span>
                </div>

                <button
                  type="button"
                  className="ghost-btn"
                  onClick={createRemoteSession}
                  disabled={isGenerating}
                >
                  {isGenerating ? 'Creating code...' : 'Generate new code'}
                </button>

                {sessionCode && (
                  <div className="code-display">
                    <p>Share this code</p>
                    <div className="code-chip">
                      <span>{sessionCode}</span>
                      <button type="button" onClick={handleCopyCode}>
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <button type="button" className="text-btn" onClick={resetRemoteSession}>
                      End remote session
                    </button>
                  </div>
                )}
              </article>
            )}
          </div>
        )}
        </section>
        <div className={`sidebar-overlay ${isSidebarOpen ? 'visible' : ''}`} onClick={closeSidebar} />
      </section>

      <section className="editor-panel">
        <div className="panel-header">
          <div className="panel-heading">
            <p className="eyebrow subtle">
              {isLocalMode ? 'Local scratchpad' : sessionCode ? `Remote room ${sessionCode}` : 'Remote'}
            </p>
            <div className="panel-title-row">
              <h3>{isLocalMode ? 'Local network' : sessionCode || 'Waiting for code'}</h3>
              <button type="button" className="mobile-code-tab" onClick={handleMobileRemoteCode}>
                Remote code
              </button>
            </div>
          </div>
          <div className="panel-actions">
            <span className={`status-pill ${status}`}>{statusLabel}</span>
            {!isLocalMode && (
              <button type="button" className="secondary-btn" onClick={resetRemoteSession}>
                Back to local
              </button>
            )}
          </div>
        </div>
        <div className="editor-tools">
          <button
            type="button"
            className="upload-btn"
            onClick={handleAttachFileClick}
            disabled={isUploading}
          >
            {isUploading ? 'Attaching…' : 'Upload file'}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden-input"
            onChange={handleFileSelected}
            accept="image/*,video/*"
          />
          <div className="tool-spacer" aria-hidden="true" />
          <div className="action-buttons">
            <button
              type="button"
              className="secondary-btn"
              onClick={handleClear}
              disabled={!canClear}
            >
              Clear
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={handleSave}
              disabled={!canSave}
            >
              {saveButtonLabel}
            </button>
          </div>
        </div>
        <textarea value={text} onChange={handleTextChange} placeholder={editorPlaceholder} />
        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map((file) => (
              <div key={file.id} className="attachment-item">
                <div className="attachment-meta">
                  <span className="attachment-name">{file.name}</span>
                  <span className="attachment-type">{file.type || 'file'}</span>
                </div>
                <a href={file.dataUrl} download={file.name} className="download-btn">
                  Download
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default App
