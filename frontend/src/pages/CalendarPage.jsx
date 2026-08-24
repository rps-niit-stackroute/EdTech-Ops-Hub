import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { api, PROGRAM_COLORS, buildProgramColorMap } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  ChevronLeft, ChevronRight, AlertTriangle, Loader2, Clock, Building2, User, Hash,
  CalendarRange, LayoutGrid, List, CalendarOff,
} from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALL = "__all__";

function mergeSessionResponses(responses) {
  const sessions = [];
  const seen = new Set();
  responses.forEach((r) => collectNewSessions(r.data.sessions, seen, sessions));
  // clashes are computed tool-wide, not per-month, so any response carries the full list
  return { sessions, clashes: responses[0]?.data.clashes || [] };
}

function collectNewSessions(list, seen, into) {
  (list || []).forEach((s) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    into.push(s);
  });
}

export default function CalendarPage() {
  const nav = useNavigate();
  const [view, setView] = useState("month"); // "month" | "week"
  const [cursor, setCursor] = useState(dayjs());
  const [data, setData] = useState({ sessions: [], clashes: [] });
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ mentors: [], programs: [], team_members: [] });
  const [fTeam, setFTeam] = useState(ALL);
  const [fProgram, setFProgram] = useState(ALL);
  const [fMentor, setFMentor] = useState(ALL);
  const [selected, setSelected] = useState(null);
  const [clashPanel, setClashPanel] = useState(false);
  const [unavailability, setUnavailability] = useState([]);
  const [unavailPanel, setUnavailPanel] = useState(false);

  const rangeStartStr = (view === "week" ? cursor.startOf("week") : cursor.startOf("month")).format("YYYY-MM-DD");
  const rangeEndStr = (view === "week" ? cursor.endOf("week") : cursor.endOf("month")).format("YYYY-MM-DD");

  // a week can straddle two months — figure out every (month, year) the visible range touches
  const monthsToFetch = useMemo(() => {
    const keys = new Map();
    let d = dayjs(rangeStartStr);
    const end = dayjs(rangeEndStr);
    while (d.isBefore(end) || d.isSame(end, "day")) {
      const key = `${d.year()}-${d.month() + 1}`;
      if (!keys.has(key)) keys.set(key, { month: d.month() + 1, year: d.year() });
      d = d.add(1, "day");
    }
    return [...keys.values()];
  }, [rangeStartStr, rangeEndStr]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all(monthsToFetch.map(({ month, year }) => api.get(`/calendar?month=${month}&year=${year}`)))
      .then((responses) => setData(mergeSessionResponses(responses)))
      .finally(() => setLoading(false));
  }, [monthsToFetch]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get("/meta").then((r) => setMeta(r.data)); }, []);
  useEffect(() => { api.get("/mentor-unavailability").then((r) => setUnavailability(r.data)); }, []);

  // periods that overlap the currently visible month/week range
  const visibleUnavailability = useMemo(
    () => unavailability.filter((p) => p.start_date <= rangeEndStr && p.end_date >= rangeStartStr),
    [unavailability, rangeStartStr, rangeEndStr]
  );

  // Built from the full program list (not just what's visible this month/filter)
  // so a program's color never shifts depending on what else happens to be shown.
  const colorMap = useMemo(() => buildProgramColorMap(meta.programs), [meta.programs]);
  const colorFor = (programId) => colorMap[programId] || PROGRAM_COLORS[0];

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
    filtered.forEach((s) => {
      if (!m[s.date]) m[s.date] = [];
      m[s.date].push(s);
    });
    return m;
  }, [filtered]);

  const startOfMonth = cursor.startOf("month");
  const daysInMonth = cursor.daysInMonth();
  const leading = startOfMonth.day();
  const cells = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => cursor.startOf("week").add(i, "day")),
    [rangeStartStr] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const clashCount = data.clashes.length;
  const todayStr = dayjs().format("YYYY-MM-DD");

  const goPrev = () => setCursor(cursor.subtract(1, view === "week" ? "week" : "month"));
  const goNext = () => setCursor(cursor.add(1, view === "week" ? "week" : "month"));
  const goToday = () => setCursor(dayjs());

  const rangeLabel = view === "week"
    ? `${cursor.startOf("week").format("D MMM")} – ${cursor.endOf("week").format("D MMM YYYY")}`
    : cursor.format("MMMM YYYY");

  return (
    <div data-testid="calendar-page">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Master Calendar</h1>
          <p className="mt-1 text-sm text-slate-500">All sessions across programs — with live clash detection.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setView("month")}
              data-testid="view-toggle-month"
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === "month" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Month
            </button>
            <button
              onClick={() => setView("week")}
              data-testid="view-toggle-week"
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === "week" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <List className="h-3.5 w-3.5" /> Week
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={goToday} data-testid="cal-today-btn">
            Today
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={goPrev} data-testid="cal-prev-btn">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="w-44 text-center font-display text-lg font-bold" data-testid="cal-month-label">
              {rangeLabel}
            </div>
            <Button variant="outline" size="icon" onClick={goNext} data-testid="cal-next-btn">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
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

      {visibleUnavailability.length > 0 && (
        <button
          onClick={() => setUnavailPanel(true)}
          data-testid="unavailability-banner"
          className="mb-4 flex w-full items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-left transition-colors hover:bg-amber-100"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500 text-white">
            <CalendarOff className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-amber-800">
            {visibleUnavailability.length} mentor{visibleUnavailability.length > 1 ? "s" : ""} unavailable this period — click to view
          </span>
        </button>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <FilterSelect label="Team Member" value={fTeam} onChange={setFTeam} options={meta.team_members} testid="filter-team" />
        <FilterSelect label="Program" value={fProgram} onChange={setFProgram}
          options={meta.programs.map((p) => ({ value: p.id, label: p.name }))} testid="filter-program" />
        <FilterSelect label="Mentor" value={fMentor} onChange={setFMentor} options={meta.mentors} testid="filter-mentor" />
      </div>

      <ProgramLegend sessions={filtered} colorMap={colorMap} />

      <CalendarBody
        loading={loading} view={view} cells={cells} cursor={cursor} weekDays={weekDays}
        byDate={byDate} todayStr={todayStr} colorFor={colorFor} setSelected={setSelected}
      />

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
            {data.clashes.map((c) => (
              <Card key={`${c.mentor}-${c.date}-${c.time_a}-${c.time_b}`} className="rounded-md border-red-200 bg-red-50/40 p-4" data-testid="clash-item">
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

      {/* Mentor unavailability panel */}
      <Sheet open={unavailPanel} onOpenChange={setUnavailPanel}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="unavailability-panel">
          <SheetHeader>
            <SheetTitle className="font-display flex items-center gap-2 text-amber-600">
              <CalendarOff className="h-5 w-5" /> Mentor Unavailability
            </SheetTitle>
          </SheetHeader>
          <Button
            className="mt-4 w-full bg-slate-900 hover:bg-slate-800"
            onClick={() => nav("/programs?tab=mentors")}
            data-testid="go-manage-unavailability-btn"
          >
            <CalendarOff className="mr-2 h-4 w-4" /> Manage mentor unavailability
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-slate-400">
            Opens Programs → Mentors, where you can mark a mentor unavailable or edit an existing period.
          </p>
          <div className="mt-4 space-y-3">
            {visibleUnavailability.map((p) => (
              <Card key={p.id} className="rounded-md border-amber-200 bg-amber-50/40 p-4" data-testid="unavailability-item">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <User className="h-4 w-4 text-amber-500" /> {p.mentor_name}
                </div>
                <div className="mt-2 font-mono-data text-xs text-slate-600">
                  {dayjs(p.start_date).format("DD MMM YYYY")} – {dayjs(p.end_date).format("DD MMM YYYY")}
                </div>
                {p.reason && <div className="mt-1 text-xs text-slate-500">{p.reason}</div>}
              </Card>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MonthGrid({ cells, cursor, byDate, todayStr, colorFor, setSelected }) {
  return (
    <Card className="overflow-hidden rounded-md border-slate-200">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, idx) => {
          const dateStr = d ? cursor.date(d).format("YYYY-MM-DD") : null;
          const items = d ? (byDate[dateStr] || []) : [];
          const isToday = dateStr === todayStr;
          return (
            <div
              key={d ? dateStr : `pad-${idx}`}
              className={`min-h-[112px] border-b border-r border-slate-100 p-1.5 ${d ? "" : "bg-slate-50/50"}`}
              data-testid={d ? `cal-cell-${dateStr}` : undefined}
            >
              {d != null && (
                <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${isToday ? "bg-slate-900 text-white" : "text-slate-500"}`}>
                  {d}
                </div>
              )}
              <div className="space-y-1">
                {items.map((s) => {
                  const c = colorFor(s.program_id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelected(s)}
                      data-testid="cal-session-block"
                      className="block w-full rounded px-1.5 py-1 text-left transition-transform hover:scale-[1.02]"
                      style={{
                        background: c.bg, color: c.text,
                        border: s.has_clash ? "2px solid #DC2626" : `1px solid ${c.border}`,
                      }}
                      title={`${s.program_name} · ${s.start_time}-${s.end_time}`}
                    >
                      <div className="truncate text-[11px] font-semibold leading-tight">{s.program_name}</div>
                      <div className="truncate text-[10px] leading-tight opacity-80">{s.start_time}–{s.end_time}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekAgenda({ weekDays, byDate, todayStr, colorFor, setSelected }) {
  return (
    <div className="space-y-3" data-testid="week-agenda">
      {weekDays.map((day) => {
        const dateStr = day.format("YYYY-MM-DD");
        const items = (byDate[dateStr] || []).slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
        const isToday = dateStr === todayStr;
        return (
          <Card
            key={dateStr}
            className={`rounded-md p-4 ${isToday ? "border-slate-900" : "border-slate-200"}`}
            data-testid={`week-day-${dateStr}`}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isToday ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                {day.date()}
              </span>
              <span className="font-display text-sm font-bold text-slate-800">{day.format("dddd, D MMM")}</span>
              {isToday && (
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">Today</span>
              )}
              <span className="ml-auto text-xs text-slate-400">
                {items.length} session{items.length === 1 ? "" : "s"}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="pl-9 text-xs text-slate-400">No sessions</p>
            ) : (
              <div className="space-y-1.5">
                {items.map((s) => {
                  const c = colorFor(s.program_id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelected(s)}
                      data-testid="week-session-row"
                      className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50"
                      style={{
                        borderColor: s.has_clash ? "#DC2626" : "#E2E8F0",
                        borderWidth: s.has_clash ? 2 : 1,
                      }}
                    >
                      <span className="w-24 shrink-0 font-mono-data text-xs text-slate-500">
                        {s.start_time}–{s.end_time}
                      </span>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.border }} />
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{s.program_name}</span>
                      <span className="hidden shrink-0 truncate text-xs text-slate-500 sm:block">{s.mentor_name}</span>
                      {s.has_clash && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function CalendarBody({ loading, view, cells, cursor, weekDays, byDate, todayStr, colorFor, setSelected }) {
  if (loading) {
    return (
      <Card className="flex h-80 items-center justify-center rounded-md border-slate-200">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </Card>
    );
  }
  if (view === "month") {
    return <MonthGrid cells={cells} cursor={cursor} byDate={byDate} todayStr={todayStr} colorFor={colorFor} setSelected={setSelected} />;
  }
  return <WeekAgenda weekDays={weekDays} byDate={byDate} todayStr={todayStr} colorFor={colorFor} setSelected={setSelected} />;
}

function ProgramLegend({ sessions, colorMap }) {
  const programs = useMemo(() => {
    const seen = new Map();
    sessions.forEach((s) => {
      if (!seen.has(s.program_id)) seen.set(s.program_id, s.program_name);
    });
    return [...seen.entries()];
  }, [sessions]);

  if (programs.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5" data-testid="calendar-legend">
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <CalendarRange className="h-3 w-3" /> Legend
      </span>
      {programs.map(([id, name]) => {
        const c = colorMap[id] || PROGRAM_COLORS[0];
        return (
          <div key={id} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.border }} />
            {name}
          </div>
        );
      })}
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
