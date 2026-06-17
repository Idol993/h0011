import { useState, useEffect, useRef } from 'react';

interface Project {
  id: number;
  name: string;
  client: string;
  rate: number;
  archived: number;
}

interface ActiveTimer {
  id: number;
  project_id: number;
  project_name: string;
  client_name: string;
  rate: number;
  start_time: string;
}

interface TimerProps {
  projects: Project[];
  activeTimer: ActiveTimer | null;
  onRefresh: () => void;
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Timer({ projects, activeTimer, onRefresh }: TimerProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [elapsed, setElapsed] = useState(0);
  const [showManual, setShowManual] = useState(false);
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const [manualProjectId, setManualProjectId] = useState<number | ''>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (activeTimer) {
      setSelectedProjectId(activeTimer.project_id);
      setElapsed(Date.now() - new Date(activeTimer.start_time).getTime());
    }
  }, [activeTimer]);

  useEffect(() => {
    if (activeTimer) {
      intervalRef.current = window.setInterval(() => {
        setElapsed(Date.now() - new Date(activeTimer.start_time).getTime());
      }, 1000);
    } else {
      setElapsed(0);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeTimer]);

  const activeProject = activeTimer
    ? projects.find((p) => p.id === activeTimer.project_id)
    : null;

  async function handleStart() {
    if (!selectedProjectId) {
      setError('请先选择一个项目');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/timer/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: selectedProjectId })
      });
      if (!res.ok) throw new Error((await res.json()).error || '启动失败');
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/timer/stop', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || '停止失败');
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitManual() {
    if (!manualProjectId || !manualStart || !manualEnd) {
      setError('请完整填写项目、开始时间、结束时间');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: manualProjectId,
          start_time: new Date(manualStart).toISOString(),
          end_time: new Date(manualEnd).toISOString()
        })
      });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      setManualStart('');
      setManualEnd('');
      setManualProjectId('');
      setShowManual(false);
      onRefresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const isRunning = !!activeTimer;

  return (
    <div style={{ padding: 16, background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600, color: '#1f2937' }}>
        ⏱ 计时器
      </h2>

      {error && (
        <div style={{
          padding: '8px 12px',
          background: '#fef2f2',
          color: '#dc2626',
          borderRadius: 6,
          marginBottom: 12,
          fontSize: 13,
          border: '1px solid #fecaca'
        }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 6 }}>选择项目</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : '')}
          disabled={isRunning}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 14,
            background: isRunning ? '#f3f4f6' : '#fff',
            cursor: isRunning ? 'not-allowed' : 'pointer'
          }}
        >
          <option value="">-- 请选择项目 --</option>
          {projects.filter((p) => !p.archived).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.client} (¥{p.rate}/h)
            </option>
          ))}
        </select>
        {isRunning && (
          <div style={{ fontSize: 12, color: '#ea580c', marginTop: 4 }}>
            计时中，切换项目会自动停止当前计时并在新项目开始
          </div>
        )}
      </div>

      <div style={{
        textAlign: 'center',
        padding: 24,
        background: isRunning ? '#fff7ed' : '#f9fafb',
        borderRadius: 12,
        marginBottom: 16,
        border: `2px solid ${isRunning ? '#ea580c' : '#e5e7eb'}`,
        animation: isRunning ? 'pulse 1s ease-in-out infinite' : 'none'
      }}>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
          {isRunning
            ? activeTimer
              ? `${activeTimer.project_name} · ${activeTimer.client_name}`
              : '计时中'
            : '未开始'}
        </div>
        <div style={{
          fontSize: 48,
          fontWeight: 700,
          fontFamily: 'monospace',
          color: isRunning ? '#ea580c' : '#374151',
          letterSpacing: 2
        }}>
          {formatDuration(elapsed)}
        </div>
        {isRunning && activeTimer && (
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
            开始于 {new Date(activeTimer.start_time).toLocaleTimeString('zh-CN', { hour12: false })}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        {!isRunning ? (
          <button
            onClick={handleStart}
            disabled={loading || !selectedProjectId}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: '#ea580c',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading || !selectedProjectId ? 'not-allowed' : 'pointer',
              opacity: loading || !selectedProjectId ? 0.6 : 1
            }}
          >
            {loading ? '启动中...' : '▶ 开始计时'}
          </button>
        ) : (
          <button
            onClick={handleStop}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? '保存中...' : '■ 停止并保存'}
          </button>
        )}
      </div>

      <div style={{ marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
        <button
          onClick={() => setShowManual(!showManual)}
          style={{
            background: 'none',
            border: 'none',
            color: '#ea580c',
            fontSize: 14,
            cursor: 'pointer',
            padding: 0,
            fontWeight: 500
          }}
        >
          {showManual ? '▾ 收起手动补录' : '▸ 手动补录工时'}
        </button>

        {showManual && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <select
              value={manualProjectId}
              onChange={(e) => setManualProjectId(e.target.value ? Number(e.target.value) : '')}
              style={{
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 14
              }}
            >
              <option value="">-- 选择项目 --</option>
              {projects.filter((p) => !p.archived).map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {p.client}</option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={manualStart}
              onChange={(e) => setManualStart(e.target.value)}
              placeholder="开始时间"
              style={{
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 14
              }}
            />
            <input
              type="datetime-local"
              value={manualEnd}
              onChange={(e) => setManualEnd(e.target.value)}
              placeholder="结束时间"
              style={{
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 14
              }}
            />
            <button
              onClick={handleSubmitManual}
              disabled={loading}
              style={{
                padding: '10px 16px',
                background: '#ea580c',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? '保存中...' : '保存补录记录'}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
