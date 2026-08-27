import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import HealthBadge from "@/components/HealthBadge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LabelList,
} from "recharts";
import {
  FolderKanban,
  CalendarRange,
  Users,
  AlertTriangle,
  ClipboardCheck,
  CalendarDays,
  ReceiptText,
  ArrowRight,
  Loader2,
  History,
  Gauge,
  Clock,
  UserCheck,
  Ban,
} from "lucide-react";

const ACCENT = "#2563eb";
const GRID = "#e2e8f0";
const AXIS_TICK = { fontSize: 11, fill: "#94a3b8" };
const HEALTH_COLORS = { green: "#10b981", amber: "#f59e0b", red: "#ef4444" };
const HEALTH_LABELS = { green: "Healthy", amber: "At Risk", red: "Critical" };

function timeAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function fmtDT(date, time) {
  if (!date) return "—";
  const d = dayjs(date).format("D MMM");
  return time ? `${d}, ${time}` : d;
}

function describeChange(c) {
  if (c.change_type === "cancelled") {
    return `Session cancelled — was ${fmtDT(c.before?.date, c.before?.start_time)}–${c.before?.end_time || ""}`;
  }
  if (c.change_type === "removed") {
    return `Session removed — was ${fmtDT(c.before?.date, c.before?.start_time)}–${c.before?.end_time || ""}`;
  }
  const before = `${fmtDT(c.before?.date, c.before?.start_time)}–${c.before?.end_time || ""}`;
  const after = `${fmtDT(c.after?.date, c.after?.start_time)}–${c.after?.end_time || ""}`;
  let durationNote = "";
  if (c.before?.duration != null && c.after?.duration != null && c.before.duration !== c.after.duration) {
    durationNote = ` (${c.before.duration}h → ${c.after.duration}h)`;
  }
  return `${before} → ${after}${durationNote}`;
}

function Metric({ label, value, icon: Icon, danger, testid }) {
  return (
    <Card
      data-testid={testid}
      className={`relative overflow-hidden rounded-md border p-6 transition-transform hover:-translate-y-0.5 ${
        danger ? "border-red-300 bg-red-50/60" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between">
        <span className="label-caps">{label}</span>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-md ${
            danger ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-600"
          }`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <div
        className={`mt-4 font-display text-4xl font-black tracking-tighter ${
          danger ? "text-red-600" : "text-slate-900"
        }`}
        data-testid={`${testid}-value`}
      >
        {value}
      </div>
      {danger && value > 0 && (
        <span className="mt-1 inline-block text-xs font-medium text-red-500">
          Requires attention
        </span>
      )}
    </Card>
  );
}

function ChartCard({ title, subtitle, children, testid }) {
  return (
    <Card className="rounded-md border-slate-200 p-6" data-testid={testid}>
      <h3 className="font-display text-base font-bold text-slate-900">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      {label && <div className="mb-0.5 font-medium text-slate-700">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="text-slate-600">
          {p.name}: <span className="font-mono-data font-semibold text-slate-900">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

const ACTIONS = [
  { to: "/attendance", label: "Process Attendance", desc: "Upload Teams export & update tracker", icon: ClipboardCheck },
  { to: "/calendar", label: "Open Calendar", desc: "View sessions & detect clashes", icon: CalendarDays },
  { to: "/programs", label: "Manage Programs", desc: "Add or edit programs & sessions", icon: FolderKanban },
  { to: "/sow", label: "Generate SOW", desc: "Mentor billing statements", icon: ReceiptText },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [changes, setChanges] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    api
      .get("/dashboard")
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
    api
      .get("/schedule-changes/recent")
      .then((r) => setChanges(r.data?.changes || []))
      .catch(() => {});
  }, []);

  const healthPieData = data
    ? ["green", "amber", "red"].map((k) => ({
        key: k, name: HEALTH_LABELS[k], value: data.health_distribution?.[k] || 0,
      }))
    : [];
  const hasHealthData = healthPieData.some((d) => d.value > 0);

  // Cancellations get their own banner — they're the one schedule change that
  // silently shrinks a SOW rather than just moving it, so they're easy to miss
  // buried in a general list of reschedules.
  const cancellations = changes.filter((c) => c.change_type === "cancelled");
  const otherChanges = changes.filter((c) => c.change_type !== "cancelled");

  return (
    <div data-testid="dashboard-page">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">
          Operations Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Live snapshot of programs, sessions and mentor activity.
        </p>
      </header>

      {!loading && cancellations.length > 0 && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3" data-testid="dashboard-cancellations">
          <div className="flex items-center gap-2">
            <Ban className="h-4 w-4 shrink-0 text-red-700" />
            <span className="text-sm font-semibold text-red-900">
              {cancellations.length} session{cancellations.length === 1 ? "" : "s"} cancelled in the last 7 days
            </span>
            <button
              onClick={() => nav("/sow")}
              className="ml-auto shrink-0 text-xs font-medium text-red-800 underline hover:text-red-900"
            >
              Review SOW impact
            </button>
          </div>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {cancellations.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 text-xs" data-testid="cancellation-row">
                <span className="min-w-0 truncate text-red-900">
                  <span className="font-medium">{c.program_name}{c.topic ? ` — ${c.topic}` : ""}:</span> {describeChange(c)}
                </span>
                <span className="shrink-0 text-red-600">{timeAgo(c.changed_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && otherChanges.length > 0 && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3" data-testid="dashboard-schedule-changes">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-amber-700" />
            <span className="text-sm font-semibold text-amber-900">
              {otherChanges.length} schedule change{otherChanges.length === 1 ? "" : "s"} in the last 7 days
            </span>
            <button
              onClick={() => nav("/sow")}
              className="ml-auto shrink-0 text-xs font-medium text-amber-800 underline hover:text-amber-900"
            >
              Review SOW impact
            </button>
          </div>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {otherChanges.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 text-xs" data-testid="schedule-change-row">
                <span className="min-w-0 truncate text-amber-900">
                  <span className="font-medium">{c.program_name}{c.topic ? ` — ${c.topic}` : ""}:</span> {describeChange(c)}
                </span>
                <span className="shrink-0 text-amber-600">{timeAgo(c.changed_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Metric testid="metric-programs" label="Total Active Programs" value={data.total_programs} icon={FolderKanban} />
            <Metric testid="metric-sessions" label="Sessions This Week" value={data.sessions_this_week} icon={CalendarRange} />
            <Metric testid="metric-mentors" label="Active Mentors" value={data.active_mentors} icon={Users} />
            <Metric testid="metric-clashes" label="Clashes Detected" value={data.clashes_detected} icon={AlertTriangle} danger />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
            <Metric testid="metric-avg-health" label="Avg Health Score" value={`${data.avg_health_score}%`} icon={Gauge} />
            <Metric testid="metric-hours-month" label="Hours This Month" value={data.hours_this_month} icon={Clock} />
            <Metric testid="metric-avg-attendance" label="Avg Attendance %" value={`${data.avg_attendance_pct}%`} icon={UserCheck} />
          </div>

          <section className="mt-10" data-testid="dashboard-charts">
            <h2 className="mb-4 label-caps">Trends</h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ChartCard
                  title="Sessions per Week"
                  subtitle="Trailing 8 weeks"
                  testid="chart-sessions-trend"
                >
                  {data.sessions_trend?.some((d) => d.sessions > 0) ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={data.sessions_trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: GRID }} tickLine={false} />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
                        <Bar dataKey="sessions" name="Sessions" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">No sessions scheduled yet.</div>
                  )}
                </ChartCard>
              </div>

              <ChartCard title="Program Health" subtitle="Across all active programs" testid="chart-health-distribution">
                {hasHealthData ? (
                  <>
                    <div className="relative">
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie
                            data={healthPieData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={55}
                            outerRadius={78}
                            paddingAngle={healthPieData.filter((d) => d.value > 0).length > 1 ? 3 : 0}
                            strokeWidth={0}
                            isAnimationActive={false}
                          >
                            {healthPieData.map((d) => <Cell key={d.key} fill={HEALTH_COLORS[d.key]} />)}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-display text-2xl font-black text-slate-900">{data.avg_health_score}%</span>
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">avg score</span>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {healthPieData.map((d) => (
                        <li key={d.key} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2 text-slate-600">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: HEALTH_COLORS[d.key] }} />
                            {d.name}
                          </span>
                          <span className="font-mono-data font-semibold text-slate-800">{d.value}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">No programs yet.</div>
                )}
              </ChartCard>
            </div>

            {data.mentor_workload?.length > 0 && (
              <div className="mt-6">
                <ChartCard title="Mentor Workload" subtitle="Sessions delivered, top 8 mentors" testid="chart-mentor-workload">
                  <ResponsiveContainer width="100%" height={Math.max(180, data.mentor_workload.length * 34)}>
                    <BarChart
                      data={data.mentor_workload}
                      layout="vertical"
                      margin={{ top: 0, right: 28, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid horizontal={false} stroke={GRID} />
                      <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="mentor"
                        tick={{ fontSize: 12, fill: "#475569" }}
                        axisLine={false}
                        tickLine={false}
                        width={112}
                      />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
                      <Bar dataKey="sessions" name="Sessions" fill={ACCENT} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                        <LabelList dataKey="sessions" position="right" style={{ fontSize: 11, fill: "#475569" }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            )}
          </section>

          <section className="mt-10">
            <h2 className="mb-4 label-caps">Quick Actions</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ACTIONS.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.to}
                    data-testid={`quick-action-${a.to.replace("/", "") || "home"}`}
                    onClick={() => nav(a.to)}
                    className="group flex flex-col rounded-md border border-slate-200 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-slate-900"
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="font-semibold text-slate-900">{a.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{a.desc}</div>
                    <ArrowRight className="mt-3 h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-slate-900" />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="mb-4 label-caps">Program Health</h2>
            <Card className="overflow-hidden rounded-md border-slate-200" data-testid="dashboard-health-table">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                      <th className="px-5 py-3">Program</th>
                      <th className="px-5 py-3">Client</th>
                      <th className="px-5 py-3 text-right">Sessions</th>
                      <th className="px-5 py-3 text-right">Health Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.programs?.length === 0 && (
                      <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">No programs yet.</td></tr>
                    )}
                    {data.programs?.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100" data-testid="dashboard-health-row">
                        <td className="px-5 py-3 font-medium text-slate-800">{p.name}</td>
                        <td className="px-5 py-3 text-slate-600">{p.client}</td>
                        <td className="px-5 py-3 text-right font-mono-data text-slate-600">{p.session_count}</td>
                        <td className="px-5 py-3 text-right">
                          <HealthBadge health={p.health} testid={`dashboard-health-${p.id}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
