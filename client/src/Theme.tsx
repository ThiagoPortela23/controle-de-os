import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon } from './ui';

type Theme = 'light' | 'dark';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void; setUser: (id: string | null) => void } | null>(null);
const keyFor = (id: string | null) => `central-services-theme:${id ?? 'public'}`;
function storedTheme(id: string | null): Theme | null {
  try { const value = localStorage.getItem(keyFor(id)); return value === 'light' || value === 'dark' ? value : null; }
  catch { return null; }
}
const systemTheme = (): Theme => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => storedTheme(null) ?? systemTheme());
  useEffect(() => {
    setTheme(storedTheme(user) ?? systemTheme());
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => { if (!storedTheme(user)) setTheme(systemTheme()); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [user]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#10212b' : '#f4f6f7');
  }, [theme]);
  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light'; setTheme(next);
    try { localStorage.setItem(keyFor(user), next); } catch { /* Theme remains usable when storage is unavailable. */ }
  }
  return <ThemeContext.Provider value={{ theme, toggle, setUser }}>{children}</ThemeContext.Provider>;
}
export function ThemeScope({ userId }: { userId: string }) {
  const { setUser } = useContext(ThemeContext)!;
  useEffect(() => { setUser(userId); return () => setUser(null); }, [userId, setUser]);
  return null;
}
export function ThemeToggle() {
  const { theme, toggle } = useContext(ThemeContext)!;
  return <button className="preference-button" onClick={toggle} aria-label={`Usar tema ${theme === 'light' ? 'escuro' : 'claro'}`}>
    <Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} /><span>Tema {theme === 'light' ? 'escuro' : 'claro'}</span>
  </button>;
}
