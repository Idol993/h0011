import { useState, useEffect, useCallback, useMemo } from 'react';
import Timer from './Timer';

interface Project {
  id: number;
  name: string;
  client: string;
  rate: number;
  archived: number;
  created_at: string;
}

interface ActiveTimer {
  id: number;
  project_id: number;
  project_name: string;
  client_name: string;
  rate: number;
  start_time: string;
}

interface TimeEntry {
  id: number;
  project_id: number;
  start_time: string;
  end_time: string | null;
  hours: number | null;
  project_name: string;
  client_name: string;
  rate: number;
}

interface WeeklyReport {
  week_start: string;
  week_end: string;
  week_start_key?: string;
  week_end_key?: string;
  days: string[];
  day_labels: string[];
  projects: Array<{
    project_id: number;
    project_name: string;
    client_name: string;
    rate: number;
    daily: Record<string, number>;
    entries: TimeEntry[];
    total_hours: number;
    total_amount: number;
    daily_amounts: Record<string, number>;
  }>;
  daily_totals: Record<string, { hours: number; amount: number }>;
  grand_total: { hours: number; amount: number };
}

interface ClientBill {
  client_name: string;
  total_hours: number;
  total_amount: number;
  projects: Array<{
    project_id: number;
    project_name: string;
    rate: number;
    hours: number;
    amount: number;
    daily_entries: Array<{
      date: string;
      start_time: string;
      end_time: string | null;
      hours: number | null;
    }>;
  }>;
}

interface ClientReport {
  week_start: string;
  week_end: string;
  week_start_key: string;
  week_end_key: string;
  clients: ClientBill[];
  grand_total: { hours: number; amount: number };
}

const COLORS = ['#ea580c', '#f97316', '#fb923c', '#fdba74', '#f59e0b', '#d97706', '#c2410c', '#92400e'];

type ReportView = 'chart' | 'client';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport | null>(null);
  const [clientReport, setClientReport] = useState<ClientReport | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formRate, setFormRate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('');
  const [reportView, setReportView] = useState<ReportView>('chart');
  const [showExportModal, setShowExportModal] = useState(false);

  const refreshAll = useCallback(async () => {
    try {
      const dateQuery = weekOffset ? `?date=${getWeekDate(weekOffset)}` : '';
      const [pRes, tRes, rRes, cRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/timer/active'),
        fetch(`/api/reports/weekly${dateQuery}`),
        fetch(`/api/reports/weekly/clients${dateQuery}`)
      ]);
      const [p, t, r, c] = await Promise.all([
        pRes.json(),
        tRes.json(),
        rRes.json(),
        cRes.json()
      ]);
      setProjects(p);
      setActiveTimer(t);
      setWeeklyReport(r);
      setClientReport(c);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [weekOffset]);

  function getWeekDate(offset: number) {
    const d = new Date();
    d.setDate(d.getDate() + offset * 7);
    return d.toISOString();
  }

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  async function handleSaveProject() {
    if (!formName.trim() || !formClient.trim()) {
      setError('项目名和客户名必填');
      return;
    }
    setError('');
    try {
      const rateNum = parseFloat(formRate) || 0;
      if (editingProject) {
        await fetch(`/api/projects/${editingProject.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName, client: formClient, rate: rateNum })
        });
      } else {
        await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName, client: formClient, rate: rateNum })
        });
      }
      setFormName('');
      setFormClient('');
      setFormRate('');
      setShowAddProject(false);
      setEditingProject(null);
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function openEditProject(p: Project) {
    setEditingProject(p);
    setFormName(p.name);
    setFormClient(p.client);
    setFormRate(String(p.rate));
    setShowAddProject(true);
    setShowArchived(true);
  }

  async function toggleArchive(id: number) {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: p.archived ? 0 : 1 })
    });
    refreshAll();
  }

  async function deleteProject(id: number) {
    if (!confirm('确定删除该项目及其所有工时记录？')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    refreshAll();
  }

  async function deleteEntry(id: number) {
    await fetch(`/api/time-entries/${id}`, { method: 'DELETE' });
    refreshAll();
  }

  function exportCSV(format: 'detail' | 'client') {
    const dateQuery = weekOffset ? `&date=${getWeekDate(weekOffset)}` : '';
    const url = `/api/reports/weekly/csv?format=${format}${dateQuery}`;
    window.open(url, '_blank');
    setShowExportModal(false);
  }

  const allClients = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => set.add(p.client));
    return Array.from(set).sort();
  }, [projects]);

  const projectColors = useMemo(() => {
    const map = new Map<number, string>();
    projects.forEach((p, i) => map.set(p.id, COLORS[i % COLORS.length]));
    return map;
  }, [projects]);

  const displayedProjects = useMemo(() => {
    return projects.filter((p) => {
      if (!showArchived && p.archived) return false;
      if (clientFilter && p.client !== clientFilter) return false;
      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        if (!p.name.toLowerCase().includes(kw) && !p.client.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [projects, showArchived, clientFilter, searchKeyword]);

  function changeWeek(delta: number) {
    setWeekOffset((o) => o + delta);
    setExpandedDay(null);
  }

  function getEntriesForDay(day: string): TimeEntry[] {
    if (!weeklyReport) return [];
    const list: TimeEntry[] = [];
    for (const p of weeklyReport.projects) {
      for (const e of p.entries) {
        if (new Date(e.start_time).toISOString().slice(0, 10) === day) {
          list.push(e);
        }
      }
    }
    return list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  if (loading) {
    return <div style={{ padding: 40, fontSize: 16, color: '#6b7280' }}>加载中...</div>;
  }

  const hasData = weeklyReport && weeklyReport.projects.length > 0;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#fafafa',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    }}>
      <div style={{
        maxWidth: 1440,
        margin: '0 auto',
        padding: 20
      }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          padding: '16px 24px',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1f2937' }}>
              🏢 工时记录 & 账单汇总
            </h1>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              设计工作室简易版 · 按项目计费
            </div>
          </div>
          <button
            onClick={() => setShowExportModal(true)}
            style={{
              padding: '10px 20px',
              background: '#ea580c',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            📥 导出本周 CSV
          </button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '440px 1fr', gap: 20 }}>
          {/* ========== 左侧栏 ========== */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Timer projects={projects} activeTimer={activeTimer} onRefresh={refreshAll} />

            {/* 项目列表 */}
            <div style={{
              padding: 16,
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#1f2937' }}>
                  📋 项目管理
                </h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(e) => setShowArchived(e.target.checked)}
                    />
                    归档
                  </label>
                  <button
                    onClick={() => {
                      setEditingProject(null);
                      setFormName('');
                      setFormClient('');
                      setFormRate('');
                      setShowAddProject(!showAddProject);
                    }}
                    style={{
                      padding: '6px 12px',
                      background: '#ea580c',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer'
                    }}
                  >
                    + 新建
                  </button>
                </div>
              </div>

              {/* 搜索 & 客户筛选 */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  placeholder="🔍 搜索项目/客户"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    fontSize: 13,
                    minWidth: 0
                  }}
                />
                <select
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  style={{
                    padding: '8px 10px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    fontSize: 13,
                    maxWidth: 130
                  }}
                >
                  <option value="">全部客户</option>
                  {allClients.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {showAddProject && (
                <div style={{
                  padding: 14,
                  background: '#fff7ed',
                  borderRadius: 8,
                  marginBottom: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}>
                  {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
                  <input
                    placeholder="项目名称"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    style={{
                      padding: '9px 12px',
                      border: '1px solid #fed7aa',
                      borderRadius: 6,
                      fontSize: 14
                    }}
                  />
                  <input
                    placeholder="客户名称"
                    value={formClient}
                    onChange={(e) => setFormClient(e.target.value)}
                    style={{
                      padding: '9px 12px',
                      border: '1px solid #fed7aa',
                      borderRadius: 6,
                      fontSize: 14
                    }}
                  />
                  <input
                    type="number"
                    placeholder="小时费率 (¥)"
                    value={formRate}
                    onChange={(e) => setFormRate(e.target.value)}
                    style={{
                      padding: '9px 12px',
                      border: '1px solid #fed7aa',
                      borderRadius: 6,
                      fontSize: 14
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleSaveProject}
                      style={{
                        flex: 1,
                        padding: '9px 12px',
                        background: '#ea580c',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                    >
                      {editingProject ? '保存修改' : '创建项目'}
                    </button>
                    <button
                      onClick={() => {
                        setShowAddProject(false);
                        setEditingProject(null);
                        setError('');
                      }}
                      style={{
                        padding: '9px 12px',
                        background: '#fff',
                        color: '#6b7280',
                        border: '1px solid #d1d5db',
                        borderRadius: 6,
                        fontSize: 14,
                        cursor: 'pointer'
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
                {displayedProjects.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#9ca3af', padding: 20, fontSize: 14 }}>
                    {searchKeyword || clientFilter ? '没有匹配的项目' : '暂无项目，点击右上角"新建"开始'}
                  </div>
                )}
                {displayedProjects.map((p) => {
                  const weekly = weeklyReport?.projects.find((r) => r.project_id === p.id);
                  const color = projectColors.get(p.id) || '#ea580c';
                  return (
                    <div
                      key={p.id}
                      style={{
                        padding: 14,
                        borderRadius: 10,
                        border: '1px solid #e5e7eb',
                        opacity: p.archived ? 0.55 : 1,
                        background: p.archived ? '#f9fafb' : '#fff',
                        borderLeft: `4px solid ${color}`
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 15, color: '#1f2937', marginBottom: 2 }}>
                            {p.name}
                            {p.archived && <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>[已归档]</span>}
                          </div>
                          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
                            客户：{p.client}
                          </div>
                          <div style={{ fontSize: 13, color: '#ea580c', fontWeight: 500 }}>
                            ¥{p.rate.toFixed(2)} / 小时
                          </div>
                          {weekly && (
                            <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                              本周 {weekly.total_hours.toFixed(2)}h · 计 ¥{weekly.total_amount.toFixed(2)}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginLeft: 10 }}>
                          <button
                            onClick={() => openEditProject(p)}
                            style={{
                              padding: '4px 10px',
                              fontSize: 12,
                              background: '#eff6ff',
                              color: '#2563eb',
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer'
                            }}
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => toggleArchive(p.id)}
                            style={{
                              padding: '4px 10px',
                              fontSize: 12,
                              background: p.archived ? '#f0fdf4' : '#fef9c3',
                              color: p.archived ? '#15803d' : '#a16207',
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer'
                            }}
                          >
                            {p.archived ? '恢复' : '归档'}
                          </button>
                          <button
                            onClick={() => deleteProject(p.id)}
                            style={{
                              padding: '4px 10px',
                              fontSize: 12,
                              background: '#fef2f2',
                              color: '#dc2626',
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer'
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ========== 右侧栏：周报 ========== */}
          <div style={{
            padding: 20,
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#1f2937' }}>
                  📊 本周工时汇总
                </h2>
                <div style={{ display: 'flex', gap: 4, background: '#f3f4f6', padding: 3, borderRadius: 8 }}>
                  <button
                    onClick={() => setReportView('chart')}
                    style={{
                      padding: '6px 14px',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 13,
                      cursor: 'pointer',
                      background: reportView === 'chart' ? '#fff' : 'transparent',
                      color: reportView === 'chart' ? '#ea580c' : '#6b7280',
                      fontWeight: reportView === 'chart' ? 600 : 500,
                      boxShadow: reportView === 'chart' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'
                    }}
                  >
                    📈 柱状图 & 项目明细
                  </button>
                  <button
                    onClick={() => setReportView('client')}
                    style={{
                      padding: '6px 14px',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 13,
                      cursor: 'pointer',
                      background: reportView === 'client' ? '#fff' : 'transparent',
                      color: reportView === 'client' ? '#ea580c' : '#6b7280',
                      fontWeight: reportView === 'client' ? 600 : 500,
                      boxShadow: reportView === 'client' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'
                    }}
                  >
                    💼 客户账单视图
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => changeWeek(-1)}
                  style={{
                    padding: '6px 14px',
                    background: '#f3f4f6',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 14
                  }}
                >
                  ← 上周
                </button>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>
                  {weeklyReport && (
                    <>
                      {new Date(weeklyReport.week_start).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                      {' - '}
                      {new Date(weeklyReport.week_end).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                    </>
                  )}
                </div>
                <button
                  onClick={() => changeWeek(1)}
                  style={{
                    padding: '6px 14px',
                    background: '#f3f4f6',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 14
                  }}
                >
                  下周 →
                </button>
                {weekOffset !== 0 && (
                  <button
                    onClick={() => setWeekOffset(0)}
                    style={{
                      padding: '6px 14px',
                      background: '#ea580c',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 500
                    }}
                  >
                    本周
                  </button>
                )}
              </div>
            </div>

            {!hasData ? (
              <div style={{
                textAlign: 'center',
                padding: '80px 20px',
                color: '#9ca3af',
                fontSize: 15
              }}>
                本周暂无工时记录 · 开始工作让数据出现吧！
              </div>
            ) : reportView === 'chart' ? (
              weeklyReport && (
                <>
                  {/* 总计卡片 */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 14,
                    marginBottom: 20
                  }}>
                    <div style={{
                      padding: 18,
                      borderRadius: 10,
                      background: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
                      border: '1px solid #fed7aa'
                    }}>
                      <div style={{ fontSize: 13, color: '#9a3412', marginBottom: 6 }}>项目数</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: '#ea580c' }}>
                        {weeklyReport.projects.length}
                      </div>
                    </div>
                    <div style={{
                      padding: 18,
                      borderRadius: 10,
                      background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                      border: '1px solid #bfdbfe'
                    }}>
                      <div style={{ fontSize: 13, color: '#1e40af', marginBottom: 6 }}>总工时</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: '#2563eb' }}>
                        {weeklyReport.grand_total.hours.toFixed(2)}h
                      </div>
                    </div>
                    <div style={{
                      padding: 18,
                      borderRadius: 10,
                      background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
                      border: '1px solid #bbf7d0'
                    }}>
                      <div style={{ fontSize: 13, color: '#15803d', marginBottom: 6 }}>总金额</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: '#16a34a' }}>
                        ¥{weeklyReport.grand_total.amount.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* 图例 */}
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 14,
                    marginBottom: 16,
                    padding: 12,
                    background: '#fafafa',
                    borderRadius: 8
                  }}>
                    {weeklyReport.projects.map((p) => {
                      const color = projectColors.get(p.project_id) || '#ea580c';
                      return (
                        <div key={p.project_id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <div style={{ width: 14, height: 14, background: color, borderRadius: 3 }} />
                          <span style={{ color: '#374151' }}>{p.project_name}</span>
                          <span style={{ color: '#9ca3af' }}>
                            {p.total_hours.toFixed(1)}h · ¥{p.total_amount.toFixed(0)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* 柱状图 */}
                  <div style={{
                    position: 'relative',
                    padding: '20px 12px 30px',
                    borderTop: '1px solid #e5e7eb',
                    borderBottom: '1px solid #e5e7eb',
                    marginBottom: 20
                  }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${weeklyReport.days.length}, 1fr)`,
                      gap: 16,
                      height: 280,
                      alignItems: 'flex-end'
                    }}>
                      {weeklyReport.days.map((day, idx) => {
                        const totalHours = weeklyReport.daily_totals[day].hours;
                        const maxHours = Math.max(
                          ...weeklyReport.days.map((d) => weeklyReport.daily_totals[d].hours),
                          8
                        );
                        const isExpanded = expandedDay === day;
                        const isToday = day === new Date().toISOString().slice(0, 10);

                        return (
                          <div
                            key={day}
                            onClick={() => setExpandedDay(isExpanded ? null : day)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              height: '100%',
                              cursor: 'pointer',
                              padding: '0 2px',
                              borderRadius: 8,
                              background: isExpanded ? '#fff7ed' : 'transparent',
                              transition: 'background 0.15s'
                            }}
                          >
                            <div style={{
                              fontSize: 11,
                              color: '#6b7280',
                              marginBottom: 6,
                              fontWeight: totalHours > 0 ? 600 : 400
                            }}>
                              {totalHours > 0 ? `${totalHours.toFixed(1)}h` : ''}
                            </div>

                            <div style={{
                              flex: 1,
                              width: '100%',
                              display: 'flex',
                              flexDirection: 'column-reverse',
                              alignItems: 'center',
                              gap: 2
                            }}>
                              {weeklyReport.projects.map((p) => {
                                const h = p.daily[day] || 0;
                                if (h <= 0) return null;
                                const color = projectColors.get(p.project_id) || '#ea580c';
                                const pct = (h / maxHours) * 85;
                                return (
                                  <div
                                    key={p.project_id}
                                    title={`${p.project_name}: ${h.toFixed(2)}h · ¥${(h * p.rate).toFixed(2)}`}
                                    style={{
                                      width: '82%',
                                      minHeight: 4,
                                      height: `${pct}%`,
                                      background: color,
                                      borderRadius: 4,
                                      transition: 'all 0.2s',
                                      boxShadow: isExpanded ? '0 0 0 2px rgba(234,88,12,0.3)' : 'none'
                                    }}
                                  />
                                );
                              })}
                            </div>

                            <div style={{
                              marginTop: 8,
                              fontSize: 13,
                              fontWeight: isToday ? 700 : 500,
                              color: isToday ? '#ea580c' : '#374151'
                            }}>
                              {weeklyReport.day_labels[idx]}
                            </div>
                            <div style={{
                              fontSize: 11,
                              color: '#9ca3af'
                            }}>
                              {day.slice(5)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 当日明细 */}
                  {expandedDay && (
                    <div style={{
                      padding: 16,
                      background: '#fff7ed',
                      borderRadius: 10,
                      border: '1px solid #fed7aa',
                      marginBottom: 20
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 12
                      }}>
                        <div style={{ fontWeight: 600, color: '#9a3412' }}>
                          📅 {expandedDay} 工时明细
                          <span style={{ marginLeft: 10, fontSize: 13, color: '#c2410c', fontWeight: 400 }}>
                            {weeklyReport.daily_totals[expandedDay].hours.toFixed(2)}h ·
                            ¥{weeklyReport.daily_totals[expandedDay].amount.toFixed(2)}
                          </span>
                        </div>
                        <button
                          onClick={() => setExpandedDay(null)}
                          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 18 }}
                        >
                          ×
                        </button>
                      </div>
                      <div style={{
                        maxHeight: 320,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8
                      }}>
                        {getEntriesForDay(expandedDay).length === 0 && (
                          <div style={{ textAlign: 'center', padding: 16, color: '#9ca3af', fontSize: 14 }}>
                            该日无工时记录
                          </div>
                        )}
                        {getEntriesForDay(expandedDay).map((e) => {
                          const color = projectColors.get(e.project_id) || '#ea580c';
                          return (
                            <div
                              key={e.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: 12,
                                background: '#fff',
                                borderRadius: 8,
                                borderLeft: `3px solid ${color}`
                              }}
                            >
                              <div style={{ flex: 1, fontSize: 14 }}>
                                <div style={{ fontWeight: 500, color: '#1f2937' }}>{e.project_name}</div>
                                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                                  {new Date(e.start_time).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                                  {' → '}
                                  {new Date(e.end_time!).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                                  {' · '}{e.client_name}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', marginRight: 14 }}>
                                <div style={{ fontWeight: 600, color: '#ea580c' }}>{(e.hours || 0).toFixed(2)}h</div>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>¥{((e.hours || 0) * e.rate).toFixed(2)}</div>
                              </div>
                              <button
                                onClick={(ev) => { ev.stopPropagation(); deleteEntry(e.id); }}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: 12,
                                  background: '#fef2f2',
                                  color: '#dc2626',
                                  border: 'none',
                                  borderRadius: 4,
                                  cursor: 'pointer'
                                }}
                              >
                                删除
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 项目明细表 */}
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: '#1f2937' }}>
                      📝 按项目明细
                    </h3>
                    <div style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      overflow: 'hidden'
                    }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>项目</th>
                            <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>客户</th>
                            <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>费率</th>
                            {weeklyReport.days.map((d, i) => (
                              <th
                                key={d}
                                onClick={() => setExpandedDay(expandedDay === d ? null : d)}
                                style={{
                                  padding: '10px 8px',
                                  textAlign: 'right',
                                  fontWeight: 600,
                                  color: expandedDay === d ? '#ea580c' : '#374151',
                                  borderBottom: '1px solid #e5e7eb',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  background: expandedDay === d ? '#fff7ed' : 'transparent'
                                }}
                              >
                                <div>{weeklyReport.day_labels[i]}</div>
                                <div style={{ color: '#9ca3af', fontWeight: 400, marginTop: 2 }}>{d.slice(5)}</div>
                              </th>
                            ))}
                            <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#2563eb', borderBottom: '1px solid #e5e7eb', background: '#eff6ff' }}>工时</th>
                            <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#16a34a', borderBottom: '1px solid #e5e7eb', background: '#f0fdf4' }}>金额</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weeklyReport.projects.map((p) => {
                            const color = projectColors.get(p.project_id) || '#ea580c';
                            return (
                              <tr key={p.project_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '12px 14px', fontWeight: 500 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                                    {p.project_name}
                                  </div>
                                </td>
                                <td style={{ padding: '12px 14px', color: '#6b7280' }}>{p.client_name}</td>
                                <td style={{ padding: '12px 14px', textAlign: 'right', color: '#6b7280' }}>¥{p.rate.toFixed(0)}</td>
                                {weeklyReport.days.map((d) => {
                                  const h = p.daily[d] || 0;
                                  return (
                                    <td
                                      key={d}
                                      style={{
                                        padding: '10px 8px',
                                        textAlign: 'right',
                                        fontSize: 13,
                                        background: h > 0 ? '#fffbeb' : 'transparent',
                                        color: h > 0 ? '#92400e' : '#d1d5db',
                                        fontWeight: h > 0 ? 500 : 400
                                      }}
                                    >
                                      {h > 0 ? h.toFixed(1) : '-'}
                                    </td>
                                  );
                                })}
                                <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#2563eb', background: '#eff6ff' }}>
                                  {p.total_hours.toFixed(2)}h
                                </td>
                                <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#16a34a', background: '#f0fdf4' }}>
                                  ¥{p.total_amount.toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                          <tr style={{ background: '#f9fafb', fontWeight: 700 }}>
                            <td colSpan={3} style={{ padding: '12px 14px', color: '#374151' }}>合计</td>
                            {weeklyReport.days.map((d) => (
                              <td key={d} style={{
                                padding: '10px 8px',
                                textAlign: 'right',
                                fontSize: 13,
                                color: '#1f2937',
                                background: weeklyReport.daily_totals[d].hours > 0 ? '#fef3c7' : 'transparent'
                              }}>
                                {weeklyReport.daily_totals[d].hours > 0 ? weeklyReport.daily_totals[d].hours.toFixed(1) : '-'}
                              </td>
                            ))}
                            <td style={{ padding: '12px 14px', textAlign: 'right', color: '#2563eb', background: '#dbeafe' }}>
                              {weeklyReport.grand_total.hours.toFixed(2)}h
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'right', color: '#16a34a', background: '#bbf7d0' }}>
                              ¥{weeklyReport.grand_total.amount.toFixed(2)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )
            ) : clientReport && (
              /* ============ 客户账单视图 ============ */
              <div>
                {/* 总计 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 14,
                  marginBottom: 24
                }}>
                  <div style={{
                    padding: 18,
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                    border: '1px solid #fcd34d'
                  }}>
                    <div style={{ fontSize: 13, color: '#92400e', marginBottom: 6 }}>客户数</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#b45309' }}>
                      {clientReport.clients.length}
                    </div>
                  </div>
                  <div style={{
                    padding: 18,
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                    border: '1px solid #bfdbfe'
                  }}>
                    <div style={{ fontSize: 13, color: '#1e40af', marginBottom: 6 }}>总工时</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#2563eb' }}>
                      {clientReport.grand_total.hours.toFixed(2)}h
                    </div>
                  </div>
                  <div style={{
                    padding: 18,
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
                    border: '1px solid #bbf7d0'
                  }}>
                    <div style={{ fontSize: 13, color: '#15803d', marginBottom: 6 }}>总金额</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: '#16a34a' }}>
                      ¥{clientReport.grand_total.amount.toFixed(2)}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                  💡 此视图按客户合并所有项目，可直接复制到月底客户对账单邮件中
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {clientReport.clients.map((client, ci) => (
                    <div
                      key={client.client_name}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 12,
                        overflow: 'hidden'
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '14px 20px',
                        background: 'linear-gradient(90deg, #fff7ed, #ffedd5)',
                        borderBottom: '1px solid #fed7aa'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: '#ea580c',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: 16
                          }}>
                            {ci + 1}
                          </div>
                          <div>
                            <div style={{ fontSize: 17, fontWeight: 700, color: '#7c2d12' }}>
                              {client.client_name}
                            </div>
                            <div style={{ fontSize: 12, color: '#a16207' }}>
                              本周 {client.projects.length} 个项目
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 13, color: '#78716c' }}>客户小计</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: '#c2410c' }}>
                            {client.total_hours.toFixed(2)}h · ¥{client.total_amount.toFixed(2)}
                          </div>
                        </div>
                      </div>

                      <div style={{
                        borderBottom: client.projects.length > 0 ? '1px solid #f3f4f6' : 'none'
                      }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                          <thead>
                            <tr style={{ background: '#fafafa' }}>
                              <th style={{ padding: '10px 20px', textAlign: 'left', fontSize: 12, color: '#6b7280', fontWeight: 600 }}>项目名称</th>
                              <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: '#6b7280', fontWeight: 600 }}>费率</th>
                              <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: '#6b7280', fontWeight: 600 }}>工时</th>
                              <th style={{ padding: '10px 20px', textAlign: 'right', fontSize: 12, color: '#6b7280', fontWeight: 600 }}>小计金额</th>
                            </tr>
                          </thead>
                          <tbody>
                            {client.projects.map((p) => {
                              const color = projectColors.get(p.project_id) || '#ea580c';
                              return (
                                <tr key={p.project_id} style={{ borderBottom: '1px dashed #f3f4f6' }}>
                                  <td style={{ padding: '12px 20px', fontWeight: 500 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                                      {p.project_name}
                                    </div>
                                  </td>
                                  <td style={{ padding: '12px 14px', textAlign: 'right', color: '#6b7280' }}>
                                    ¥{p.rate.toFixed(2)}/h
                                  </td>
                                  <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#2563eb' }}>
                                    {p.hours.toFixed(2)}h
                                  </td>
                                  <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>
                                    ¥{p.amount.toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}
                            <tr style={{ background: '#fef9c3', fontWeight: 700 }}>
                              <td colSpan={2} style={{ padding: '10px 20px', color: '#854d0e', textAlign: 'right' }}>
                                合计 · {client.client_name}
                              </td>
                              <td style={{ padding: '10px 14px', textAlign: 'right', color: '#1d4ed8' }}>
                                {client.total_hours.toFixed(2)}h
                              </td>
                              <td style={{ padding: '10px 20px', textAlign: 'right', color: '#15803d' }}>
                                ¥{client.total_amount.toFixed(2)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}

                  {/* 全部合计 */}
                  <div style={{
                    padding: 18,
                    borderRadius: 12,
                    background: 'linear-gradient(135deg, #f5f5f4, #e7e5e4)',
                    border: '2px solid #a8a29e',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#292524' }}>
                      📌 全部客户合计
                    </div>
                    <div style={{ display: 'flex', gap: 40 }}>
                      <div>
                        <div style={{ fontSize: 12, color: '#78716c', textAlign: 'right' }}>总工时</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: '#1d4ed8' }}>
                          {clientReport.grand_total.hours.toFixed(2)}h
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: '#78716c', textAlign: 'right' }}>总金额</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: '#15803d' }}>
                          ¥{clientReport.grand_total.amount.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========== 导出弹窗 ========== */}
      {showExportModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }} onClick={() => setShowExportModal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: 24,
              width: 420,
              boxShadow: '0 20px 40px rgba(0,0,0,0.15)'
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#1f2937' }}>
              📥 导出本周 CSV
            </h3>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              周期：
              {weeklyReport?.week_start_key || clientReport?.week_start_key}
              {' ~ '}
              {weeklyReport?.week_end_key || clientReport?.week_end_key}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                onClick={() => exportCSV('detail')}
                style={{
                  padding: 16,
                  border: '1px solid #fed7aa',
                  borderRadius: 10,
                  background: '#fff7ed',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  gap: 14,
                  alignItems: 'flex-start'
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 8,
                  background: '#ea580c', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, flexShrink: 0
                }}>📝</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#7c2d12', fontSize: 15 }}>按项目明细导出</div>
                  <div style={{ fontSize: 12, color: '#a16207', marginTop: 4 }}>
                    每行一条工时记录，含日期、起止时间、项目、客户、工时、费率、金额，适合做账
                  </div>
                </div>
              </button>

              <button
                onClick={() => exportCSV('client')}
                style={{
                  padding: 16,
                  border: '1px solid #bfdbfe',
                  borderRadius: 10,
                  background: '#eff6ff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  gap: 14,
                  alignItems: 'flex-start'
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 8,
                  background: '#2563eb', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, flexShrink: 0
                }}>💼</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#1e3a8a', fontSize: 15 }}>按客户账单导出</div>
                  <div style={{ fontSize: 12, color: '#1d4ed8', marginTop: 4 }}>
                    客户分组，列出各项目工时与小计，带客户合计行，适合月底对账发给客户
                  </div>
                </div>
              </button>
            </div>

            <div style={{ marginTop: 22, textAlign: 'right' }}>
              <button
                onClick={() => setShowExportModal(false)}
                style={{
                  padding: '8px 18px',
                  background: '#f3f4f6',
                  color: '#374151',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
