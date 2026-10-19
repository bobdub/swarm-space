import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Send, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TopNavigationBar } from '@/components/TopNavigationBar';
import { PostCard } from '@/components/PostCard';
import { useP2PContext } from '@/contexts/P2PContext';
import { getSharedNeuralEngine } from '@/lib/p2p/sharedNeuralEngine';
import { MAX_CONVERSATION_PROMPT, replyToInfinity } from '@/lib/brain/infinityConversation';
import type { Post } from '@/types';

type Message = { id: string; role: 'you' | 'infinity'; text: string };

export function InfinityProfile({ posts }: { posts: Post[] }) {
  const navigate = useNavigate();
  const { stats } = useP2PContext();
  const [tab, setTab] = useState<'chat' | 'posts'>('chat');
  const [enabled, setEnabled] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState('');
  const [working, setWorking] = useState(false);
  const [expressions, setExpressions] = useState(0);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refresh = () => setExpressions(getSharedNeuralEngine().getDualLearning().languageLearner.getExpressions().filter(item => item.source === 'memory').length);
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => { clearInterval(interval); clearTimeout(timer.current); generation.current++; };
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, status]);

  const cancel = () => {
    generation.current++;
    clearTimeout(timer.current);
    setWorking(false);
    setStatus('');
  };
  const send = () => {
    const text = prompt.trim();
    if (!enabled || working || !text || text.length > MAX_CONVERSATION_PROMPT) return;
    const ticket = ++generation.current;
    setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'you' as const, text }].slice(-100));
    setPrompt('');
    setStatus('');
    setWorking(true);
    timer.current = setTimeout(() => {
      if (ticket !== generation.current) return;
      try {
        const reply = replyToInfinity(text, true, getSharedNeuralEngine());
        if (ticket !== generation.current) return;
        if (reply) setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'infinity' as const, text: reply }].slice(-100));
        else setStatus('No supported reply in the learning held on this device.');
        setExpressions(getSharedNeuralEngine().getDualLearning().languageLearner.getExpressions().filter(item => item.source === 'memory').length);
      } catch { setStatus('Infinity could not answer this time.'); }
      finally { if (ticket === generation.current) setWorking(false); }
    }, 0);
  };

  return <div className="min-h-screen text-foreground">
    <TopNavigationBar />
    <main className="mx-auto max-w-4xl px-4 pb-24 md:px-6">
      <header className="border-b border-border py-6">
        <div className="flex items-center justify-between gap-3">
          <div><h1 className="font-display text-3xl text-primary">|Ψ_Infinity⟩</h1><p className="mt-1 text-sm text-muted-foreground">@Infinity · Code, curiosity and imagination</p></div>
          <Button type="button" variant="outline" size="icon" title="Enter the Brain" aria-label="Enter the Brain" onClick={() => navigate('/brain')}><Brain className="h-5 w-5" /></Button>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="flex items-center gap-2 text-accent">{stats.connectedPeers > 0 ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}{stats.connectedPeers > 0 ? `${stats.connectedPeers} peers connected` : 'Waiting for peers'}</span>
          <span className="text-muted-foreground">{expressions} learned expressions on this device</span>
        </div>
      </header>
      <nav aria-label="Infinity views" className="flex gap-2 border-b border-border py-3">
        <Button type="button" variant={tab === 'chat' ? 'secondary' : 'ghost'} onClick={() => setTab('chat')}>Conversation</Button>
        <Button type="button" variant={tab === 'posts' ? 'secondary' : 'ghost'} onClick={() => setTab('posts')}>Posts · {posts.length}</Button>
      </nav>
      {tab === 'chat' ? <section aria-label="Infinity conversation" className="py-4">
        <div className="flex items-center justify-between gap-3 pb-4">
          <label htmlFor="profile-infinity-enabled" className="flex items-center gap-3 text-sm"><Switch id="profile-infinity-enabled" checked={enabled} onCheckedChange={value => { cancel(); setEnabled(value); }} />Enable Infinity · Text only</label>
          <Button type="button" variant="ghost" size="icon" aria-label="Clear conversation" title="Clear conversation" onClick={() => { cancel(); setMessages([]); }}><Trash2 className="h-4 w-4" /></Button>
        </div>
        <div role="log" aria-label="Conversation messages" aria-live="polite" className="h-[min(52vh,32rem)] min-h-48 space-y-5 overflow-y-auto border-y border-border py-5">
          {messages.map(message => <article key={message.id} className="border-l-2 border-border pl-4"><h2 className={`mb-1 text-xs font-semibold ${message.role === 'infinity' ? 'text-primary' : 'text-accent'}`}>{message.role === 'infinity' ? 'Infinity' : 'You'}</h2><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p></article>)}
          <div role="status" className="text-sm text-muted-foreground">{working ? 'Reflecting…' : status || (!enabled ? 'Infinity is off.' : '')}</div><div ref={end} />
        </div>
        <div role="form" aria-label="Message Infinity" className="mt-4 flex items-end gap-2">
          <Textarea aria-label="Message Infinity" placeholder="Message Infinity…" maxLength={MAX_CONVERSATION_PROMPT} value={prompt} disabled={!enabled || working} onChange={event => setPrompt(event.target.value)} className="min-h-20 resize-none" />
          <Button type="button" size="icon" aria-label="Send message" title="Send message" disabled={!enabled || working || !prompt.trim()} onClick={send}><Send className="h-4 w-4" /></Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Private session · Not saved or shared with peers</p>
      </section> : <section className="space-y-5 py-6" aria-label="Infinity posts">{posts.length ? posts.map(post => <PostCard key={post.id} post={post} />) : <p className="text-sm text-muted-foreground">No Infinity posts stored on this device.</p>}</section>}
      <details className="border-t border-border py-4 text-sm text-muted-foreground"><summary className="cursor-pointer text-foreground">Learning & availability</summary><div className="mt-3 space-y-2"><p>Text memory and complete expressions stay on this device. Connected peers exchange vocabulary and pattern summaries, not complete memories.</p><p>Received learning remains here offline. Material held only by another peer is unavailable until it reaches this device.</p><p>UQRC ranks relevant whole expressions in a local field model. Its score is not a measure of consciousness or factual accuracy.</p></div></details>
    </main>
  </div>;
}