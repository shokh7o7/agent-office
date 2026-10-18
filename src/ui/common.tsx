import { useEffect, useRef, type ReactNode } from 'react';
import type { AgentState, Appearance, TaskStatus } from '../types';
import { STATE_LABEL } from '../sim/agentMachine';
import { CHAR_H, CHAR_W, characterSheet } from '../game/pixelArt';

const avatarCache = new Map<string, string>();

/** Front-facing portrait cut from the same sprite sheet used in the office. */
export function Avatar({ appearance, size = 2, dim = false }: { appearance: Appearance; size?: number; dim?: boolean }) {
  const key = JSON.stringify(appearance);
  let url = avatarCache.get(key);
  if (!url) {
    const sheet = characterSheet(appearance);
    const c = document.createElement('canvas');
    c.width = CHAR_W;
    c.height = 14;
    c.getContext('2d')!.drawImage(sheet, 0, 0, CHAR_W, 14, 0, 0, CHAR_W, 14);
    url = c.toDataURL();
    avatarCache.set(key, url);
  }
  return <img className="avatar" src={url} width={CHAR_W * size} height={14 * size} alt="" style={{ opacity: dim ? 0.45 : 1 }} />;
}

/** Full-body preview (used in the agent editor). */
export function FullAvatar({ appearance, size = 4 }: { appearance: Appearance; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CHAR_W, CHAR_H);
    ctx.drawImage(characterSheet(appearance), 0, 0, CHAR_W, CHAR_H, 0, 0, CHAR_W, CHAR_H);
  }, [appearance]);
  return <canvas ref={ref} width={CHAR_W} height={CHAR_H} className="avatar" style={{ width: CHAR_W * size, height: CHAR_H * size }} />;
}

export function StateBadge({ state }: { state: AgentState }) {
  return <span className={`badge state-${state}`}>{STATE_LABEL[state]}</span>;
}

const TASK_LABEL: Record<TaskStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
export function TaskBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge task-${status}`}>{TASK_LABEL[status]}</span>;
}

export function Progress({ value, simulated }: { value: number; simulated?: boolean }) {
  return (
    <div className={`progress${simulated ? ' sim' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : new Date(t).toLocaleDateString();
}

export function clock(t?: number): string {
  return t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
