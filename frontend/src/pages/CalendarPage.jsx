import { useEffect, useState, useCallback, useMemo } from "react";
import dayjs from "dayjs";
import { api, programColor } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  ChevronLeft, ChevronRight, AlertTriangle, Loader2, Clock, Building2, User, Hash, X,
} from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALL = "__all__";

export default function CalendarPage() {
  const [cursor, setCursor] = useState(dayjs());
  const [data, setData] = useState({ sessions: [], clashes: [] });
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ mentors: [], programs: [], team_members: [] });
  const [fTeam, setFTeam] = useState(ALL);
  const [fProgram, setFProgram] = useState(ALL);
  const [fMentor, setFMentor] = useState(ALL);
  const [selected, setSelected] = useState(null);
  const [clashPanel, setClashPanel] = useState(false);

  const month = cursor.month() + 1;
  const year = cursor.year();

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/calendar?month=${month}&year=${year}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get("/meta").then((r) => setMeta(r.data)); }, []);

  const filtered = useMemo(() => {
    return data.sessions.filter((s) => {
      if (fTeam !== ALL && s.team_member !== fTeam) return false;
      if (fProgram !== ALL && s.program_id !== fProgram) return false;
      if (fMentor !== ALL && s.mentor_name !== fMentor) return false;
      return true;
    });
  }, [data.sessions, fTeam, fProgram, fMentor]);

  const byDate = useMemo(() => {
    const m = {};
    filtered.forEach((s) => { (m[s.date] = m[s.date] || []).push(s); });
    return m;
  }, [filtered]);

  const startOfMonth = cursor.startOf("month");
  const daysInMonth = cursor.daysInMonth();
  const leading = startOfMonth.day();
  const cells = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const clashCount = data.clashes.length;

  return (
    <div data-testid="calendar-page">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Master Calendar</h1>
          <p className="mt-1 text-sm text-slate-500">All sessions across programs — with live clash detection.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor(cursor.subtract(1, "month"))} data-testid="cal-prev-btn">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="w-44 text-center font-display text-lg font-bold" data-testid="cal-month-label">
            {cursor.format("MMMM YYYY")}
          </div>
          <Button variant="outline" size="icon" onClick={() => setCursor(cursor.add(1, "month"))} data-testid="cal-next-btn">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {clashCount > 0 && (
        <button
          onClick={() => setClashPanel(true)}
          data-testid="clash-banner"
          className="mb-4 flex w-full items-center gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-left transition-colors hover:bg-red-100"
        >
          <span className="pulse-dot flex h-8 w-8 items-center justify-center rounded-md bg-red-600 text-white">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-red-700">
            ⚠ {clashCount} clash{clashCount > 1 ? "es" : ""} detected — click to view
          </span>
        </button>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <FilterSelect label="Team Member" value={fTeam} onChange={setFTeam} options={meta.team_members} testid="filter-team" />
        <FilterSelect label="Program" value={fProgram} onChange={setFProgram}
          options={meta.programs.map((p) => ({ value: p.id, label: p.name }))} testid="filter-program" />
        <FilterSelect label="Mentor" value={fMentor} onChange={setFMentor} options={meta.mentors} testid="filter-mentor" />
      </div>

      <Card className="overflow-hidden rounded-md border-slate-200">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">{w}</div>
          ))}
        </div>
        {loading ? (
          <div className="flex h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((d, idx) => {
              const dateStr = d ? cursor.date(d).format("YYYY-MM-DD") : null;
              const items = d ? (byDate[dateStr] || []) : [];
              const isToday = dateStr === dayjs().format("YYYY-MM-DD");
              return (
                <div
                  key={idx}
                  className={`min-h-[112px] border-b border-r border-slate-100 p-1.5 ${d ? "" : "bg-slate-50/50"}`}
                  data-testid={d ? `cal-cell-${dateStr}` : undefined}
                >
                  {d && (
                    <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${isToday ? "bg-slate-900 text-white" : "text-slate-500"}`}>
                      {d}
                    </div>
                  )}
                  <div className="space-y-1">
                    {items.map((s) => {
                      const c = programColor(s.program_id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSelected(s)}
                          data-testid="cal-session-block"
                          className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] font-medium transition-transform hover:scale-[1.02]"
                          style={{
                            background: c.bg, color: c.text,
                            border: s.has_clash ? "2px solid #DC2626" : `1px solid ${c.border}`,
                          }}
                          title={`${s.program_name} · ${s.start_time}-${s.end_time}`}
                        >
                          {s.start_time} {s.program_name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Session detail side panel */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent data-testid="session-detail-panel">
          <SheetHeader><SheetTitle className="font-display">Session Details</SheetTitle></SheetHeader>
          {selected && (
            <div className="mt-4 space-y-4">
              {selected.has_clash && (
                <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  <AlertTriangle className="h-4 w-4" /> This session is part of a clash
                </div>
              )}
              <Detail label="Program" value={selected.program_name} />
              <Detail label="Client" value={selected.client} icon={Building2} />
              <Detail label="Mentor" value={selected.mentor_name} icon={User} />
              <Detail label="Time" value={`${selected.start_time} – ${selected.end_time}`} icon={Clock} />
              <Detail label="Topic" value={selected.topic || "—"} />
              <Detail label="Project Code" value={selected.project_code} icon={Hash} mono />
              <Detail label="Date" value={dayjs(selected.date).format("ddd, DD MMM YYYY")} />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Clash panel */}
      <Sheet open={clashPanel} onOpenChange={setClashPanel}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="clash-panel">
          <SheetHeader>
            <SheetTitle className="font-display flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" /> {clashCount} Clash{clashCount > 1 ? "es" : ""}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {data.clashes.map((c, i) => (
              <Card key={i} className="rounded-md border-red-200 bg-red-50/40 p-4" data-testid="clash-item">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <User className="h-4 w-4 text-red-500" /> {c.mentor}
                  <span className="ml-auto font-mono-data text-xs text-slate-500">{dayjs(c.date).format("DD MMM YYYY")}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-slate-200 bg-white p-2">
                    <div className="font-medium text-slate-700">{c.program_a}</div>
                    <div className="font-mono-data text-slate-500">{c.time_a}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white p-2">
                    <div className="font-medium text-slate-700">{c.program_b}</div>
                    <div className="font-mono-data text-slate-500">{c.time_b}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, testid }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[200px] bg-white" data-testid={testid}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label}s</SelectItem>
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          const t = typeof o === "string" ? o : o.label;
          return <SelectItem key={v} value={v}>{t}</SelectItem>;
        })}
      </SelectContent>
    </Select>
  );
}

function Detail({ label, value, icon: Icon, mono }) {
  return (
    <div>
      <div className="label-caps mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className={`text-sm text-slate-800 ${mono ? "font-mono-data" : ""}`}>{value}</div>
    </div>
  );
}
