import express from 'express';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import path from 'path';
import fs from 'fs';

const app = express();
app.use(express.json());

const DB_PATH = path.join(__dirname, '..', 'timetracker.db');

let SQL: SqlJsStatic;
let db: Database;

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

function queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result: T | undefined;
  if (stmt.step()) {
    result = stmt.getAsObject() as T;
  }
  stmt.free();
  return result;
}

function runSQL(sql: string, params: any[] = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

function lastInsertId(): number {
  const r = queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
  return r ? r.id : 0;
}

async function init() {
  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
  });

  let buf: Buffer | null = null;
  try {
    if (fs.existsSync(DB_PATH)) {
      buf = fs.readFileSync(DB_PATH);
    }
  } catch {}

  db = buf ? new SQL.Database(new Uint8Array(buf)) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      client TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      hours REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_start ON time_entries(start_time);
  `);
  saveDB();
}

interface Project {
  id: number;
  name: string;
  client: string;
  rate: number;
  archived: number;
  created_at: string;
}

interface TimeEntry {
  id: number;
  project_id: number;
  start_time: string;
  end_time: string | null;
  hours: number | null;
}

function getWeekRange(date: Date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function getDayHoursForDate(dateStr: string, excludeId?: number): number {
  const dayStart = new Date(dateStr + 'T00:00:00');
  const dayEnd = new Date(dateStr + 'T23:59:59');
  let sql = `SELECT id, start_time, end_time, hours FROM time_entries 
             WHERE start_time >= ? AND start_time <= ? AND end_time IS NOT NULL`;
  const params: any[] = [dayStart.toISOString(), dayEnd.toISOString()];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  const rows = queryAll<TimeEntry>(sql, params);
  return rows.reduce((sum, r) => sum + (r.hours || 0), 0);
}

// ---------- Projects CRUD ----------
app.get('/api/projects', (_req, res) => {
  const rows = queryAll<Project>('SELECT * FROM projects ORDER BY archived ASC, created_at DESC');
  res.json(rows);
});

app.post('/api/projects', (req, res) => {
  const { name, client, rate } = req.body;
  if (!name || !client) return res.status(400).json({ error: '项目名和客户名必填' });
  runSQL('INSERT INTO projects (name, client, rate) VALUES (?, ?, ?)', [name, client, rate || 0]);
  saveDB();
  const id = lastInsertId();
  const project = queryOne<Project>('SELECT * FROM projects WHERE id = ?', [id]);
  res.status(201).json(project);
});

app.put('/api/projects/:id', (req, res) => {
  const { name, client, rate, archived } = req.body;
  const existing = queryOne<Project>('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: '项目不存在' });
  runSQL(
    `UPDATE projects SET 
      name = COALESCE(?, name),
      client = COALESCE(?, client),
      rate = COALESCE(?, rate),
      archived = COALESCE(?, archived)
     WHERE id = ?`,
    [
      name ?? null,
      client ?? null,
      rate ?? null,
      archived ?? null,
      req.params.id
    ]
  );
  saveDB();
  const project = queryOne<Project>('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  runSQL('DELETE FROM time_entries WHERE project_id = ?', [req.params.id]);
  runSQL('DELETE FROM projects WHERE id = ?', [req.params.id]);
  saveDB();
  res.status(204).end();
});

// ---------- Timer ----------
app.get('/api/timer/active', (_req, res) => {
  const row = queryOne(
    `SELECT te.*, p.name as project_name, p.client as client_name, p.rate as rate
     FROM time_entries te 
     JOIN projects p ON te.project_id = p.id 
     WHERE te.end_time IS NULL 
     ORDER BY te.id DESC LIMIT 1`
  );
  res.json(row || null);
});

app.post('/api/timer/start', (req, res) => {
  const { project_id } = req.body;
  if (!project_id) return res.status(400).json({ error: '请选择项目' });
  const project = queryOne<Project>('SELECT * FROM projects WHERE id = ?', [project_id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const now = new Date().toISOString();
  const actives = queryAll<TimeEntry>('SELECT * FROM time_entries WHERE end_time IS NULL');
  for (const a of actives) {
    const startTime = new Date(a.start_time).getTime();
    const endTime = new Date(now).getTime();
    const h = Math.round(((endTime - startTime) / 3600000) * 100) / 100;
    runSQL('UPDATE time_entries SET end_time = ?, hours = ? WHERE id = ?', [now, h, a.id]);
  }

  runSQL('INSERT INTO time_entries (project_id, start_time) VALUES (?, ?)', [project_id, now]);
  saveDB();
  const id = lastInsertId();
  const entry = queryOne(
    `SELECT te.*, p.name as project_name, p.client as client_name, p.rate as rate
     FROM time_entries te JOIN projects p ON te.project_id = p.id WHERE te.id = ?`,
    [id]
  );
  res.status(201).json(entry);
});

app.post('/api/timer/stop', (req, res) => {
  const active = queryOne<TimeEntry>('SELECT * FROM time_entries WHERE end_time IS NULL ORDER BY id DESC LIMIT 1');
  if (!active) return res.status(400).json({ error: '没有正在进行的计时' });

  const endTime = new Date().toISOString();
  const hours = Math.round(((new Date(endTime).getTime() - new Date(active.start_time).getTime()) / 3600000) * 100) / 100;
  const dayKey = dateKey(new Date(active.start_time));
  const existingHours = getDayHoursForDate(dayKey, active.id);

  if (existingHours + hours > 24) {
    return res.status(400).json({ error: `当日工时已达 ${existingHours.toFixed(2)}h，加上本次 ${hours.toFixed(2)}h 超过24小时上限` });
  }

  runSQL('UPDATE time_entries SET end_time = ?, hours = ? WHERE id = ?', [endTime, hours, active.id]);
  saveDB();
  const entry = queryOne(
    `SELECT te.*, p.name as project_name, p.client as client_name, p.rate as rate
     FROM time_entries te JOIN projects p ON te.project_id = p.id WHERE te.id = ?`,
    [active.id]
  );
  res.json(entry);
});

// ---------- Manual entry ----------
app.post('/api/time-entries', (req, res) => {
  const { project_id, start_time, end_time } = req.body;
  if (!project_id || !start_time || !end_time) {
    return res.status(400).json({ error: '项目、开始时间、结束时间必填' });
  }
  const start = new Date(start_time);
  const end = new Date(end_time);
  if (end <= start) return res.status(400).json({ error: '结束时间必须晚于开始时间' });

  const hours = Math.round(((end.getTime() - start.getTime()) / 3600000) * 100) / 100;
  const dayKey = dateKey(start);
  const existingHours = getDayHoursForDate(dayKey);

  if (existingHours + hours > 24) {
    return res.status(400).json({ error: `当日工时已达 ${existingHours.toFixed(2)}h，加上本次 ${hours.toFixed(2)}h 超过24小时上限` });
  }

  runSQL('INSERT INTO time_entries (project_id, start_time, end_time, hours) VALUES (?, ?, ?, ?)', [
    project_id,
    start.toISOString(),
    end.toISOString(),
    hours
  ]);
  saveDB();
  const id = lastInsertId();
  const entry = queryOne(
    `SELECT te.*, p.name as project_name, p.client as client_name, p.rate as rate
     FROM time_entries te JOIN projects p ON te.project_id = p.id WHERE te.id = ?`,
    [id]
  );
  res.status(201).json(entry);
});

app.delete('/api/time-entries/:id', (req, res) => {
  runSQL('DELETE FROM time_entries WHERE id = ?', [req.params.id]);
  saveDB();
  res.status(204).end();
});

// ---------- Weekly report ----------
function buildWeeklyReport(base: Date) {
  const { start, end } = getWeekRange(base);

  const entries = queryAll(
    `SELECT te.*, p.name as project_name, p.client as client_name, p.rate as rate, p.archived as archived
     FROM time_entries te JOIN projects p ON te.project_id = p.id
     WHERE te.start_time >= ? AND te.start_time <= ? AND te.end_time IS NOT NULL
     ORDER BY te.start_time ASC`,
    [start.toISOString(), end.toISOString()]
  ) as Array<TimeEntry & { project_name: string; client_name: string; rate: number; archived: number }>;

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(dateKey(d));
  }

  const byProject = new Map<
    number,
    {
      project_id: number;
      project_name: string;
      client_name: string;
      rate: number;
      daily: Record<string, number>;
      entries: typeof entries;
      total_hours: number;
      total_amount: number;
    }
  >();

  for (const e of entries) {
    if (!byProject.has(e.project_id)) {
      const daily: Record<string, number> = {};
      days.forEach((d) => (daily[d] = 0));
      byProject.set(e.project_id, {
        project_id: e.project_id,
        project_name: e.project_name,
        client_name: e.client_name,
        rate: e.rate,
        daily,
        entries: [],
        total_hours: 0,
        total_amount: 0
      });
    }
    const p = byProject.get(e.project_id)!;
    const dk = dateKey(new Date(e.start_time));
    const h = e.hours || 0;
    p.daily[dk] = (p.daily[dk] || 0) + h;
    p.total_hours += h;
    p.entries.push(e);
  }

  const projects = Array.from(byProject.values()).map((p) => ({
    ...p,
    total_amount: Math.round(p.total_hours * p.rate * 100) / 100,
    daily_amounts: Object.fromEntries(
      Object.entries(p.daily).map(([k, v]) => [k, Math.round(v * p.rate * 100) / 100])
    )
  }));

  const grandTotal = projects.reduce(
    (acc, p) => {
      acc.hours += p.total_hours;
      acc.amount += p.total_amount;
      return acc;
    },
    { hours: 0, amount: 0 }
  );

  const dailyTotals: Record<string, { hours: number; amount: number }> = {};
  for (const d of days) {
    dailyTotals[d] = { hours: 0, amount: 0 };
    for (const p of projects) {
      dailyTotals[d].hours += p.daily[d] || 0;
      dailyTotals[d].amount += (p.daily_amounts[d] || 0);
    }
  }

  const byClient = new Map<
    string,
    {
      client_name: string;
      projects: Array<{ project_id: number; project_name: string; rate: number; hours: number; amount: number; entries: typeof entries }>;
      total_hours: number;
      total_amount: number;
    }
  >();

  for (const p of projects) {
    if (!byClient.has(p.client_name)) {
      byClient.set(p.client_name, {
        client_name: p.client_name,
        projects: [],
        total_hours: 0,
        total_amount: 0
      });
    }
    const c = byClient.get(p.client_name)!;
    c.projects.push({
      project_id: p.project_id,
      project_name: p.project_name,
      rate: p.rate,
      hours: p.total_hours,
      amount: p.total_amount,
      entries: p.entries
    });
    c.total_hours += p.total_hours;
    c.total_amount += p.total_amount;
  }
  const clients = Array.from(byClient.values());

  return {
    week_start: start.toISOString(),
    week_end: end.toISOString(),
    week_start_key: dateKey(start),
    week_end_key: dateKey(end),
    days,
    day_labels: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    projects,
    clients,
    daily_totals: dailyTotals,
    grand_total: {
      hours: Math.round(grandTotal.hours * 100) / 100,
      amount: Math.round(grandTotal.amount * 100) / 100
    },
    raw_entries: entries
  };
}

app.get('/api/reports/weekly', (req, res) => {
  const base = req.query.date ? new Date(String(req.query.date)) : new Date();
  const report = buildWeeklyReport(base);
  const { raw_entries: _r, ...rest } = report;
  res.json(rest);
});

app.get('/api/reports/weekly/clients', (req, res) => {
  const base = req.query.date ? new Date(String(req.query.date)) : new Date();
  const report = buildWeeklyReport(base);
  res.json({
    week_start: report.week_start,
    week_end: report.week_end,
    week_start_key: report.week_start_key,
    week_end_key: report.week_end_key,
    clients: report.clients.map((c) => ({
      client_name: c.client_name,
      total_hours: Math.round(c.total_hours * 100) / 100,
      total_amount: Math.round(c.total_amount * 100) / 100,
      projects: c.projects.map((p) => ({
        project_id: p.project_id,
        project_name: p.project_name,
        rate: p.rate,
        hours: Math.round(p.hours * 100) / 100,
        amount: Math.round(p.amount * 100) / 100,
        daily_entries: p.entries.map((e) => ({
          date: dateKey(new Date(e.start_time)),
          start_time: e.start_time,
          end_time: e.end_time,
          hours: e.hours
        }))
      }))
    })),
    grand_total: report.grand_total
  });
});

// ---------- CSV export ----------
app.get('/api/reports/weekly/csv', (req, res) => {
  const base = req.query.date ? new Date(String(req.query.date)) : new Date();
  const format = (req.query.format as string) || 'detail';
  const report = buildWeeklyReport(base);
  const filename = `weekly-${format}-${report.week_start_key}_${report.week_end_key}.csv`;
  let header: string[] = [];
  let rows: string[][] = [];

  if (format === 'client') {
    header = ['客户', '项目', '费率', '工时(h)', '金额'];
    let totalHours = 0;
    let totalAmount = 0;
    for (const c of report.clients) {
      for (const p of c.projects) {
        rows.push([c.client_name, p.project_name, `¥${p.rate.toFixed(2)}`, p.hours.toFixed(2), `¥${p.amount.toFixed(2)}`]);
        totalHours += p.hours;
        totalAmount += p.amount;
      }
      rows.push([`▶ ${c.client_name} 小计`, '', '', c.total_hours.toFixed(2), `¥${c.total_amount.toFixed(2)}`]);
      rows.push(['', '', '', '', '']);
    }
    rows.push(['合计', '', '', totalHours.toFixed(2), `¥${totalAmount.toFixed(2)}`]);
  } else {
    header = ['日期', '开始时间', '结束时间', '项目', '客户', '工时(h)', '费率(¥/h)', '金额(¥)'];
    const entries = report.raw_entries;
    for (const e of entries) {
      const s = new Date(e.start_time);
      const en = new Date(e.end_time!);
      const date = s.toISOString().slice(0, 10);
      const st = s.toTimeString().slice(0, 5);
      const et = en.toTimeString().slice(0, 5);
      const h = (e.hours || 0).toFixed(2);
      const amount = ((e.hours || 0) * e.rate).toFixed(2);
      rows.push([date, st, et, e.project_name, e.client_name, h, e.rate.toFixed(2), amount]);
    }
    rows.push([
      '合计', '', '', '', '',
      report.grand_total.hours.toFixed(2),
      '',
      report.grand_total.amount.toFixed(2)
    ]);
  }

  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const bom = '\uFEFF';

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(bom + csv);
});

const PORT = 3001;
init().then(() => {
  app.listen(PORT, () => {
    console.log(`工时记录服务运行在 http://localhost:${PORT}`);
  });
}).catch((e) => {
  console.error('数据库初始化失败:', e);
  process.exit(1);
});
