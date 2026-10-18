import { useState } from 'react';
import type { Task, TaskStatus } from '../types';
import { useStore } from '../store/store';
import { Progress, TaskBadge, clock, timeAgo } from './common';

type Filter = 'all' | 'pending' | 'running' | 'completed' | 'failed';
const FILTERS: { id: Filter; label: string; match: TaskStatus[] }[] = [
  { id: 'all', label: 'All', match: ['queued', 'running', 'completed', 'failed', 'cancelled'] },
  { id: 'pending', label: 'Pending', match: ['queued'] },
  { id: 'running', label: 'Running', match: ['running'] },
  { id: 'completed', label: 'Done', match: ['completed'] },
  { id: 'failed', label: 'Failed', match: ['failed', 'cancelled'] },
];

export function TaskPanel({ roomy = false }: { roomy?: boolean }) {
  const s = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const tasks = [...s.sim.tasks].reverse();
  const f = FILTERS.find((x) => x.id === filter)!;
  const shown = tasks.filter((t) => f.match.includes(t.status));

  return (
    <div className={`panel-body${roomy ? ' roomy' : ''}`}>
      <div className="filters" role="tablist" aria-label="Task filter">
        {FILTERS.map((x) => (
          <button key={x.id} role="tab" aria-selected={filter === x.id} onClick={() => setFilter(x.id)}>
            {x.label} <span className="count">{tasks.filter((t) => x.match.includes(t.status)).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="empty">
          <p>{tasks.length ? 'Nothing in this list.' : 'No tasks yet. Assign one and watch the agent walk to its desk.'}</p>
          <button className="btn primary" onClick={() => s.openTaskForm()}>New task</button>
        </div>
      ) : (
        <ul className="task-list">
          {shown.map((t) => (
            <TaskRow key={t.id} task={t} open={s.ui.selectedTaskId === t.id} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskRow({ task, open }: { task: Task; open: boolean }) {
  const s = useStore();
  const agent = s.sim.state.agents[task.agentId];
  const live = task.status === 'queued' || task.status === 'running';
  return (
    <li className={`task-row${open ? ' open' : ''}`}>
      <button className="task-main" aria-expanded={open} onClick={() => s.setUI({ selectedTaskId: open ? null : task.id })}>
        <span className="task-title">
          {task.title}
          {task.simulated && <span className="sim-tag">simulated</span>}
        </span>
        <span className="task-meta">
          <TaskBadge status={task.status} />
          <span className="muted">{agent?.name ?? 'Unknown agent'}</span>
          <span className="muted tiny">{timeAgo(task.finishedAt ?? task.startedAt ?? task.createdAt)}</span>
        </span>
        {task.status === 'running' && <Progress value={task.progress} simulated={task.simulated} />}
      </button>
      {open && (
        <div className="task-detail">
          {task.description && <p className="desc">{task.description}</p>}
          <dl className="times">
            <div><dt>Created</dt><dd>{clock(task.createdAt)}</dd></div>
            <div><dt>Started</dt><dd>{clock(task.startedAt)}</dd></div>
            <div><dt>Finished</dt><dd>{clock(task.finishedAt)}</dd></div>
            <div><dt>Attempt</dt><dd>{task.attempt}</dd></div>
          </dl>
          {task.output && (
            <>
              <h4>Output</h4>
              <pre className="output">{task.output}</pre>
            </>
          )}
          <h4>Log</h4>
          {task.logs.length ? (
            <ol className="log">
              {task.logs.map((l, i) => (
                <li key={i} className={`lvl-${l.level}`}>
                  <time>{clock(l.t)}</time> {l.msg}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No log entries yet.</p>
          )}
          <div className="row-actions">
            {live && <button className="btn danger" onClick={() => s.cancelTask(task.id)}>Cancel task</button>}
            {task.simulated && (task.status === 'failed' || task.status === 'cancelled') && (
              <button className="btn primary" onClick={() => s.retryTask(task.id)}>Retry task</button>
            )}
            {agent && <button className="btn" onClick={() => s.selectAgent(agent.id, true)}>Show {agent.name}</button>}
          </div>
        </div>
      )}
    </li>
  );
}
