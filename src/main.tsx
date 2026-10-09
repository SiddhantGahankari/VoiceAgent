import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, transcriptLines, type Cost, type Line, type Turn } from './api';
import { microphoneMessage, VoiceConnection } from './voice';
import { ChatView, ImagesView } from './features';
import './style.css';

function MicIcon({ small = false }: { small?: boolean }) {
  return <svg width={small ? 18 : 28} height={small ? 18 : 28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>;
}

function App() {
  const [view, setView] = useState<'voice' | 'chat' | 'images'>('voice');
  const [ready, setReady] = useState(false);
  const [maxDuration, setMaxDuration] = useState(90);
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [cost, setCost] = useState<Cost>();
  const [sessionId, setSessionId] = useState<string>();
  const [reportStatus, setReportStatus] = useState('');
  const current = useRef<VoiceConnection | undefined>(undefined);
  const starting = useRef(false);
  const stopping = useRef(false);
  const mounted = useRef(true);
  const reportVersion = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    void api<{ max_duration_seconds: number }>('/api/config').then(config => {
      if (mounted.current) { setReady(true); setMaxDuration(config.max_duration_seconds); }
    }).catch(error => setError(error.message));
    const exit = () => current.current?.exit();
    const restore = (event: PageTransitionEvent) => { if (event.persisted && current.current) void end(); };
    window.addEventListener('pagehide', exit);
    window.addEventListener('pageshow', restore);
    return () => { mounted.current = false; reportVersion.current++; exit(); window.removeEventListener('pagehide', exit); window.removeEventListener('pageshow', restore); };
  }, []);
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [lines]);

  async function report(id: string) {
    const version = ++reportVersion.current;
    const valid = () => mounted.current && reportVersion.current === version;
    setReportStatus('Fetching finished transcript and actual cost…');
    try {
      let result: Cost | undefined;
      let turns: Turn[] = [];
      let complete = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        if (!valid()) return;
        const [session, transcript, price] = await Promise.all([
          api<{ status: string }>(`/api/voice/sessions/${id}`),
          api<Turn[]>(`/api/voice/sessions/${id}/transcript`),
          api<Cost>(`/api/voice/sessions/${id}/cost`),
        ]);
        turns = transcript; result = price;
        complete = ['completed', 'failed', 'timeout'].includes(session.status);
        if (complete && attempt >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (!valid()) return;
      // Replace streaming rows with stored turns, rather than appending duplicates.
      if (turns.length) setLines(transcriptLines(turns));
      setCost(result);
      setReportStatus(complete ? 'Stored transcript loaded · reported cost may still settle' : 'Session is still finalizing. Refresh the report shortly.');
    } catch (error) {
      if (valid()) setReportStatus(`${error instanceof Error ? error.message : 'Report unavailable.'} Use Refresh report to try again.`);
    }
  }

  async function end(message = '') {
    if (stopping.current || !current.current) return;
    stopping.current = true;
    setEnding(true); setStatus('Ending');
    const connection = current.current;
    let endError = '';
    try { await connection.stop(); }
    catch (error) { endError = `${error instanceof Error ? error.message : 'Server End failed.'} Microphone released. Retry End before starting another conversation; the server limits session duration.`; }
    if (endError) {
      if (mounted.current) { setError([message, endError].filter(Boolean).join(' ')); setStatus('Retry End'); setEnding(false); setAudioBlocked(false); }
      stopping.current = false;
      return;
    }
    if (mounted.current) {
      if (message || endError) setError([message, endError].filter(Boolean).join(' '));
      setStatus('Ended'); setBusy(false); setEnding(false); setAudioBlocked(false);
      if (connection.sessionId) { setSessionId(connection.sessionId); void report(connection.sessionId); }
    }
    current.current = undefined; starting.current = false; stopping.current = false;
  }

  async function start() {
    if (starting.current || stopping.current || !ready) return;
    starting.current = true; reportVersion.current++;
    setBusy(true); setLines([]); setCost(undefined); setSessionId(undefined); setReportStatus(''); setError('');
    try {
      if (!mounted.current) return;
      const connection = new VoiceConnection({
        status: value => { if (mounted.current) setStatus(value); },
        lines: update => { if (mounted.current) setLines(update); },
        lost: message => { void end(message); },
        playback: blocked => { if (mounted.current) setAudioBlocked(blocked); },
      }, maxDuration);
      current.current = connection;
      await connection.start();
    } catch (error) {
      if (current.current) await end(microphoneMessage(error));
      else if (mounted.current) { setError(microphoneMessage(error)); setStatus('Ready'); setBusy(false); starting.current = false; }
    }
  }

  const connected = status === 'Connected';
  return <div className="shell">
    <header className="topbar"><a className="brand" href="/" aria-label="CallMissed home"><span className="brand-mark">c<span>m</span><i/></span>CallMissed<span className="brand-dot">.</span></a>
      <nav className="view-nav" aria-label="App views">{(['voice', 'chat', 'images'] as const).map(name => <button key={name} aria-current={view === name ? 'page' : undefined} onClick={() => setView(name)}>{name === 'voice' ? 'Voice' : name === 'chat' ? 'Chat' : 'Images'}</button>)}</nav>
      <span className="mode-badge"><i/>{ready ? 'Live mode' : 'Loading…'}</span>
    </header>
    <main>
      <div className="page-intro"><h1>A place for your next idea.</h1><p>{view === 'voice' ? 'Talk it through with a voice that listens. Your conversation appears as you speak.' : view === 'chat' ? 'Put a thought into words. Ask a question, find an answer, and keep it going.' : 'Start with a description. Turn what you have in mind into an image.'}</p></div>
      <div hidden={view !== 'voice'}>
      <div className="workspace">
        <section className="call-panel" aria-labelledby="call-heading">
          <div className="panel-top"><span className="section-label" id="call-heading">Voice session</span><span className={`status ${connected ? 'online' : ''}`} role="status"><i/>{status}</span></div>
          <div className={`orb-stage ${connected ? 'is-active' : ''}`}><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="voice-orb"><div className="wave"><i/><i/><i/><i/><i/><i/><i/></div></div><span className="orbit-speck speck-one"/><span className="orbit-speck speck-two"/></div>
          <div className="call-copy"><h2>{connected ? 'You’re connected.' : 'Ready when you are.'}</h2><p>Start a conversation and speak naturally.</p></div>
          <div className="call-buttons"><button className="primary" onClick={() => void start()} disabled={busy || !ready}><MicIcon small/>{busy && !connected ? 'Connecting…' : 'Start conversation'}<span>↗</span></button><button className="end-button" onClick={() => void end()} disabled={!busy || ending || !current.current}><span className="stop-square"/>{ending ? 'Ending…' : 'End conversation'}</button></div>
          {audioBlocked && <button className="audio-button" onClick={() => void current.current?.enableAudio().catch(() => setError('Audio playback is blocked. Check your browser’s sound settings.'))}>Enable agent audio</button>}
          {error && <div className="error" role="alert">{error}</div>}
          <div className="mic-note"><MicIcon small/><p>Allow microphone access when prompted. Headphones help. Speak naturally—even while the agent is talking.</p></div>
          <div className="session-footer"><span><i/> {ready ? 'DIRECT WEBRTC' : 'LOADING'}</span><span>{maxDuration} SEC MAX</span><span>EN · हिंदी</span></div>
        </section>
        <section className="transcript-panel" aria-labelledby="transcript-heading"><div className="panel-top"><span className="section-label" id="transcript-heading">Conversation</span><span className="live-label"><i/>{busy ? 'Live transcript' : 'Transcript'}</span></div><div className="transcript-body" role="log" aria-label="Conversation transcript" aria-live="polite">{lines.length ? lines.map(line => <div className={`transcript-line ${line.speaker.toLowerCase()}`} key={line.id}><span className="speaker-avatar">{line.speaker === 'You' ? 'Y' : 'c'}</span><div><span className="speaker-name">{line.speaker}</span><p>{line.text}</p></div></div>) : <div className="empty-transcript"><div className="text-icon"><span/><span/><span/></div><h3>Your conversation, in words.</h3><p>Start a call to see what you<br/>and the agent say.</p><span className="empty-pill">You <i/> Agent</span></div>}<div ref={transcriptEnd}/></div><div className="transcript-bottom"><span>Speech transcription</span><span>You and your agent</span></div></section>
      </div>
      <section className="details-row" aria-label="Session details"><div className="detail-heading"><span className="detail-icon">↗</span><div><h3>After the conversation</h3><p>Transcript and actual credits, fetched after you end the call.</p></div></div><div className="cost-display"><span>Session credits</span><strong>{cost && typeof cost.total_credits === 'number' ? `${cost.total_credits.toFixed(2)}` : '—'}<small> credits</small></strong></div></section>
      {reportStatus && <div className="report"><p role="status">{reportStatus}</p>{sessionId && <><code>Session {sessionId}</code><button onClick={() => void report(sessionId)} disabled={busy}>Refresh report</button></>}{cost?.items?.length ? <ul>{cost.items.map(item => <li key={`${item.service}-${item.model}`}>{item.service.toUpperCase()} · {item.model} · {item.credits} credits</li>)}</ul> : null}</div>}
      <div id="agent-audio" className="audio-container" aria-label="Agent audio playback"/>
      </div>
      {view !== 'voice' && !ready && (error ? <div className="error" role="alert">{error}</div> : <p role="status">Loading configuration…</p>)}
      <div hidden={view !== 'chat'}><ChatView ready={ready}/></div>
      <div hidden={view !== 'images'}><ImagesView ready={ready}/></div>
    </main><footer className="site-footer"><span>One space. Three ways to create.</span><p>Powered by CallMissed</p></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
