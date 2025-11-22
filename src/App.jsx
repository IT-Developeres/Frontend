import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SHARE_SERVER = (() => {
  if (import.meta.env.VITE_SHARE_SERVER) {
    return import.meta.env.VITE_SHARE_SERVER;
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    const port = import.meta.env.VITE_SHARE_SERVER_PORT || '4000';
    return `${protocol}//${hostname}:${port}`;
  }

  return 'http://localhost:4000';
})();

const LOCAL_ROOM = 'LOCAL-NET';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const STATUS_TEXT = {
  idle: 'Waiting',
  waiting: 'Waiting for code',
  connecting: 'Connecting...',
  connected: 'Live',
  disconnected: 'Disconnected',
  error: 'Connection issue',
};

function App() {
  const [mode, setMode] = useState('local');
  const [text, setText] = useState('');
  const [sessionCode, setSessionCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [status, setStatus] = useState('idle');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState('light');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const socketRef = useRef(null);
  const copyTimerRef = useRef(null);
  const textareaRef = useRef(null);

  const isLocalMode = mode === 'local';
  const roomCode = isLocalMode ? LOCAL_ROOM : sessionCode;

  const syncPayload = (nextTextValue) => {
    socketRef.current?.emit('update-data', nextTextValue);
  };

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (!roomCode) {
      setStatus('waiting');
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    setStatus('connecting');
    const socket = io(SHARE_SERVER, {
      transports: ['websocket'],
      query: { roomCode },
    });
    socketRef.current = socket;

    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => setStatus('error'));
    socket.on('sync-data', (content) => {
      setText(content || '');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode]);

  const handleTextChange = (event) => {
    const value = event.target.value;
    setText(value);
    syncPayload(value);
  };

  const createRemoteSession = async () => {
    try {
      setIsGenerating(true);
      const response = await fetch(`${SHARE_SERVER}/api/session`, {
        method: 'POST',
      });
      const data = await response.json();
      setSessionCode(data.code);
      setManualCode(data.code);
      setMode('remote');
    } catch (error) {
      console.error('Failed to create session:', error);
      alert('Failed to create a new session. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const joinSession = (code) => {
    const normalizedCode = code.trim().toUpperCase();
    if (normalizedCode) {
      setSessionCode(normalizedCode);
      setMode('remote');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="app">
      <header className="header">
        <button className="menu-button" onClick={toggleSidebar}>
          ☰
        </button>
        <h1>Forshare</h1>
        <div className="status">
          <span className={`status-dot ${status}`} />
          {STATUS_TEXT[status] || 'Unknown'}
        </div>
      </header>

      <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-content">
          <h2>Share Options</h2>
          
          <div className="mode-selector">
            <button
              className={`mode-btn ${isLocalMode ? 'active' : ''}`}
              onClick={() => setMode('local')}
            >
              Local Network
            </button>
            <button
              className={`mode-btn ${!isLocalMode ? 'active' : ''}`}
              onClick={() => setMode('remote')}
            >
              Remote Share
            </button>
          </div>

          {!isLocalMode && (
            <div className="remote-options">
              {!sessionCode ? (
                <div className="session-controls">
                  <button
                    className="btn primary"
                    onClick={createRemoteSession}
                    disabled={isGenerating}
                  >
                    {isGenerating ? 'Creating...' : 'Create New Session'}
                  </button>
                  <div className="divider">OR</div>
                  <div className="join-session">
                    <input
                      type="text"
                      placeholder="Enter Session Code"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && joinSession(manualCode)}
                    />
                    <button
                      className="btn"
                      onClick={() => joinSession(manualCode)}
                      disabled={!manualCode.trim()}
                    >
                      Join
                    </button>
                  </div>
                </div>
              ) : (
                <div className="session-active">
                  <div className="session-code">
                    <span>Session Code:</span>
                    <div className="code-display">
                      {sessionCode}
                      <button
                        className="copy-btn"
                        onClick={() => copyToClipboard(sessionCode)}
                        title="Copy to clipboard"
                      >
                        {copied ? '✓' : '⎘'}
                      </button>
                    </div>
                  </div>
                  <button
                    className="btn"
                    onClick={() => {
                      setSessionCode('');
                      setMode('local');
                    }}
                  >
                    End Session
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="theme-toggle">
            <button className="btn" onClick={toggleTheme}>
              {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
            </button>
          </div>
        </div>
      </div>

      <main className="main-content">
        <div className="editor-container">
          <textarea
            ref={textareaRef}
            className="text-editor"
            value={text}
            onChange={handleTextChange}
            placeholder="Start typing here..."
            spellCheck="false"
          />
        </div>
      </main>

      <footer className="footer">
        <div className="footer-content">
          <div className="footer-section">
            <h3>Forshare</h3>
            <p>Real-time collaborative text sharing tool</p>
          </div>
          <div className="footer-section">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="#" onClick={(e) => { e.preventDefault(); setMode('local'); }}>Local Network</a></li>
              <li><a href="#" onClick={(e) => { e.preventDefault(); setMode('remote'); }}>Remote Share</a></li>
              <li><a href="#" onClick={toggleTheme}>Toggle Theme</a></li>
            </ul>
          </div>
          <div className="footer-section">
            <h4>Status</h4>
            <div className="status-display">
              <span className={`status-dot ${status}`}></span>
              {STATUS_TEXT[status] || 'Unknown'}
            </div>
            {!isLocalMode && sessionCode && (
              <div className="session-info">
                <span>Session: {sessionCode}</span>
              </div>
            )}
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} Forshare. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
