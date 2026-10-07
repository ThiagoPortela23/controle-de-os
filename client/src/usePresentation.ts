import { useCallback, useEffect, useRef, useState } from 'react';

export function usePresentation() {
  const stage = useRef<HTMLElement>(null); const enterButton = useRef<HTMLButtonElement>(null); const exitButton = useRef<HTMLButtonElement>(null);
  const active = useRef(false); const native = useRef(false); const mounted = useRef(false);
  const scroll = useRef({ x: 0, y: 0 }); const focusFrame = useRef<number | undefined>(undefined);
  const [presenting, setPresenting] = useState(false); const [message, setMessage] = useState(''); const [scale, setScale] = useState(1);
  const finish = useCallback(() => {
    if (!active.current) return;
    active.current = false; native.current = false;
    if (!mounted.current) return;
    setPresenting(false); setMessage('');
    cancelAnimationFrame(focusFrame.current ?? 0);
    focusFrame.current = requestAnimationFrame(() => {
      if (!mounted.current) return;
      window.scrollTo(scroll.current.x, scroll.current.y); enterButton.current?.focus({ preventScroll: true });
    });
  }, []);
  const exit = useCallback(async () => {
    if (stage.current && document.fullscreenElement === stage.current) {
      try { await document.exitFullscreen(); }
      catch { if (mounted.current) setMessage('Use Esc para sair da tela cheia.'); return; }
    }
    finish();
  }, [finish]);
  useEffect(() => {
    mounted.current = true; const element = stage.current;
    const change = () => {
      if (document.fullscreenElement === element) {
        if (!active.current) { void document.exitFullscreen().catch(() => {}); return; }
        native.current = true;
      } else if (native.current) finish();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.current) { event.preventDefault(); void exit(); }
    };
    document.addEventListener('fullscreenchange', change); document.addEventListener('keydown', escape);
    return () => {
      mounted.current = false; active.current = false;
      cancelAnimationFrame(focusFrame.current ?? 0);
      document.removeEventListener('fullscreenchange', change); document.removeEventListener('keydown', escape);
      if (element && document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, [exit, finish]);
  useEffect(() => {
    if (!presenting || !stage.current) return;
    const element = stage.current; const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; document.body.classList.add('dashboard-presenting');
    const resize = () => { setScale(Math.min(element.clientWidth / 1920, element.clientHeight / 1080)); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    const frame = requestAnimationFrame(() => exitButton.current?.focus({ preventScroll: true }));
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      document.body.style.overflow = previous; document.body.classList.remove('dashboard-presenting');
    };
  }, [presenting]);
  async function enter() {
    if (active.current || !stage.current) return;
    const element = stage.current;
    scroll.current = { x: window.scrollX, y: window.scrollY };
    active.current = true; native.current = false; setMessage('');
    setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080)); setPresenting(true);
    try {
      if (!element.requestFullscreen) throw new Error('Unsupported fullscreen');
      await element.requestFullscreen();
      if (!mounted.current && document.fullscreenElement === element) await document.exitFullscreen();
    } catch {
      if (mounted.current && active.current) setMessage('Tela cheia nativa indisponível. Apresentação ampliada nesta janela.');
    }
  }
  return { stage, enterButton, exitButton, presenting, scale, message, enter, exit };
}
