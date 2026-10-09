import { useRef, useState, type FormEvent } from 'react';
import { api } from './api';

type Message = { role: 'user' | 'assistant'; content: string };
type Props = { ready: boolean };

export function ChatView({ ready }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!ready || pending.current || !content) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const user: Message = { role: 'user', content };
      const reply = await api<{ content: string }>('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages.slice(-8), user].map(({ role, content }) => ({ role, content })) }),
      });
      setMessages(previous => [...previous, user, { role: 'assistant', content: reply.content }]);
      setDraft('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Chat is unavailable.');
    }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="feature-panel chat-panel" aria-labelledby="chat-heading">
    <div className="panel-top"><h2 id="chat-heading">Chat</h2><button className="end-button" disabled={busy || !messages.length} onClick={() => { setMessages([]); setDraft(''); setError(''); }}>Clear chat</button></div>
    <p className="feature-note">Type a message for a written response. The agent remembers your last four exchanges. Clear or reload to start fresh.</p>
    <div className="chat-history" role="log" aria-label="Typed conversation" aria-live="polite">
      {!messages.length && <div className="feature-empty chat-empty"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 10h28v22H22l-9 7v-7h-3z"/><path d="M17 18h14M17 24h9"/></svg><h3>What’s on your mind?</h3><p>No messages yet. Start by typing a question.</p></div>}
      {messages.map((message, index) => <div className={`transcript-line ${message.role === 'user' ? 'you' : 'agent'}`} key={index}><span className="speaker-avatar">{message.role === 'user' ? 'Y' : 'c'}</span><div><span className="speaker-name">{message.role === 'user' ? 'You' : 'Agent'}</span><p>{message.content}</p></div></div>)}
    </div>
    <form className="feature-form" onSubmit={event => void send(event)}>
      <label htmlFor="chat-message">Your message</label>
      <textarea id="chat-message" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        if (event.ctrlKey) {
          const input = event.currentTarget;
          if (input.value.length - (input.selectionEnd - input.selectionStart) < 1000) {
            input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
            setDraft(input.value);
          }
        } else if (!event.repeat) event.currentTarget.form?.requestSubmit();
      }} aria-describedby="chat-keyboard-hint" maxLength={1000} rows={3} disabled={busy} placeholder="Ask a question…" required/>
      <small id="chat-keyboard-hint">Enter to send · Ctrl+Enter for a new line</small>
      <button className="primary" type="submit" disabled={!ready || busy || !draft.trim()}>{busy ? 'Sending…' : 'Send message'}</button>
    </form>
    {busy && <p role="status">Waiting for a reply…</p>}
    {error && <div className="error" role="alert">{error}</div>}
  </section>;
}

export function ImagesView({ ready }: Props) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<{ src: string; prompt: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function generate(event: FormEvent) {
    event.preventDefault();
    const description = prompt.trim();
    if (!ready || pending.current || !description) return;
    pending.current = true; setBusy(true); setError(''); setResult(undefined);
    try {
      const image = await api<{ src: string }>('/api/images', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: description }),
      });
      setResult({ src: image.src, prompt: description });
    } catch (error) { setError(error instanceof Error ? error.message : 'Image generation is unavailable.'); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="feature-panel image-panel" aria-labelledby="images-heading">
    <div className="panel-top"><h2 id="images-heading">Images</h2><span className="panel-tag">One image at a time</span></div>
    <div className="image-workspace">
      <div className="image-controls">
        <p className="feature-note">Describe a subject, its surroundings, and the style you have in mind.</p>
        <form className="feature-form" onSubmit={event => void generate(event)}>
          <label htmlFor="image-prompt">Image prompt</label>
          <textarea id="image-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={1000} rows={7} disabled={busy} placeholder="A quiet garden after the rain, soft morning light, watercolor…" required/>
          <button className="primary" type="submit" disabled={!ready || busy || !prompt.trim()}>{busy ? 'Generating…' : 'Generate image'}</button>
        </form>
        <p className="image-spec">SDXL Lightning <span>1024 × 1024</span></p>
        <p className="feature-note image-expiry">Signed image links are temporary. Save a result you want to keep.</p>
        {error && <div className="error" role="alert">{error}</div>}
      </div>
      <div className={`image-preview ${result ? 'has-image' : ''}`}>
        {busy && <div className="feature-empty"><span className="loading-ring" aria-hidden="true"/><p role="status">Generating one image…</p></div>}
        {!busy && !result && <div className="feature-empty"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="7" width="34" height="34" rx="5"/><circle cx="18" cy="18" r="3"/><path d="m9 35 11-11 8 8 6-6 7 7"/></svg><h3>Your image preview</h3><p>Your generated image will appear here.</p></div>}
        {result && <img className="generated-image" src={result.src} alt={`Generated image: ${result.prompt}`} referrerPolicy="no-referrer" onError={() => { setResult(undefined); setError('The image link may have expired or could not be loaded. Check usage before generating again.'); }}/>}
      </div>
    </div>
  </section>;
}
