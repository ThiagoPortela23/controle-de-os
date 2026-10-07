import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from './types';

const LiveContext = createContext({ revision: 0, connected: false, soundEnabled: false,
  toggleSound: async () => {}, soundError: '', newOrder: null as number | null });
export const useLive = () => useContext(LiveContext);

export function LiveProvider({ user, onExpired, children }: { user: User; onExpired: () => void; children: ReactNode }) {
  const [revision, setRevision] = useState(0); const [connected, setConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false); const [soundError, setSoundError] = useState('');
  const [newOrder, setNewOrder] = useState<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (user.must_change_password) return;
    const source = new EventSource('/api/events');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined; let probing = false;
    const seen = new Set<string>();
    const refresh = () => { if (!timer) timer = setTimeout(() => { timer = undefined; setRevision(value => value + 1); }, 300); };
    source.addEventListener('ready', () => { setConnected(true); refresh(); });
    source.addEventListener('change', event => {
      refresh();
      const change = JSON.parse((event as MessageEvent).data) as { orderId: string; number?: number; kind: string };
      if (user.role !== 'ADMIN' || change.kind !== 'opened' || seen.has(change.orderId)) return;
      seen.add(change.orderId); if (seen.size > 100) seen.delete(seen.values().next().value!);
      setNewOrder(change.number ?? null);
      const context = audio.current;
      if (context?.state === 'running') {
        const oscillator = context.createOscillator(); const gain = context.createGain();
        oscillator.frequency.setValueAtTime(740, context.currentTime);
        oscillator.frequency.setValueAtTime(990, context.currentTime + .12);
        gain.gain.setValueAtTime(.12, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .35);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(); oscillator.stop(context.currentTime + .36);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    });
    source.addEventListener('session-ended', () => { source.close(); onExpired(); });
    source.onerror = async () => {
      setConnected(false);
      if (probing || controller.signal.aborted) return;
      probing = true;
      try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin', signal: controller.signal });
        if (response.status === 401) { source.close(); onExpired(); }
      } catch { /* EventSource retries temporary network failures. */ }
      finally { probing = false; }
    };
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      source.close(); controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible);
      void audio.current?.close().catch(() => {}); audio.current = null; setSoundEnabled(false); setConnected(false);
    };
  }, [user.id, user.role, user.must_change_password, onExpired]);
  async function toggleSound() {
    setSoundError('');
    if (audio.current) { const context = audio.current; audio.current = null; setSoundEnabled(false); await context.close().catch(() => {}); return; }
    try {
      const context = new AudioContext(); audio.current = context;
      await context.resume(); setSoundEnabled(context.state === 'running');
    } catch { void audio.current?.close().catch(() => {}); audio.current = null; setSoundError('Não foi possível ativar o som neste navegador.'); }
  }
  return <LiveContext.Provider value={{ revision, connected, soundEnabled, toggleSound, soundError, newOrder }}>{children}</LiveContext.Provider>;
}
