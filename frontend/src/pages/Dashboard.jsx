import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import HealthBadge from "@/components/HealthBadge";
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
} from "lucide-react";

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

const ACTIONS = [
  { to: "/attendance", label: "Process Attendance", desc: "Upload Teams export & update tracker", icon: ClipboardCheck },
  { to: "/calendar", label: "Open Calendar", desc: "View sessions & detect clashes", icon: CalendarDays },
  { to: "/programs", label: "Manage Programs", desc: "Add or edit programs & sessions", icon: FolderKanban },
  { to: "/sow", label: "Generate SOW", desc: "Mentor billing statements", icon: ReceiptText },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    api
      .get("/dashboard")
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

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
