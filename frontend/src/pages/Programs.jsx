import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { api, PROGRAM_COLORS, buildProgramColorMap } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import HealthBadge from "@/components/HealthBadge";
import MentorInput, { mentorSuggestions } from "@/components/MentorInput";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Plus, Pencil, Trash2, X, Loader2, Users, Hash, Building2, FolderKanban,
  Upload, Save, CalendarPlus, CheckCircle2, AlertTriangle, SkipForward, Archive, RotateCcw,
  UserPlus, CalendarOff, Ban,
} from "lucide-react";

// Live mentor availability hook for a single session draft
function useAvailability(mentor, dateStr, start, end, excludeId) {
  const [state, setState] = useState({ status: "idle", conflicts: [] });
  useEffect(() => {
    if (!mentor || !dateStr || !start || !end) { setState({ status: "idle", conflicts: [] }); return; }
    let active = true;
    setState((s) => ({ ...s, status: "checking" }));
    const t = setTimeout(async () => {
      try {
        const r = await api.post("/availability/check", {
          mentor_name: mentor, date: dateStr, start_time: start, end_time: end, exclude_session_id: excludeId,
        });
        if (active) setState({ status: r.data.available ? "available" : "conflict", conflicts: r.data.conflicts });
      } catch (err) {
        console.debug("Availability check failed", err);
        if (active) setState({ status: "idle", conflicts: [] });
      }
    }, 450);
    return () => { active = false; clearTimeout(t); };
  }, [mentor, dateStr, start, end, excludeId]);
  return state;
}

function AvailabilityHint({ state }) {
  if (state.status === "checking")
    return <span className="flex items-center gap-1 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</span>;
  if (state.status === "available")
    return <span className="flex items-center gap-1 text-xs font-medium text-emerald-600" data-testid="avail-available"><CheckCircle2 className="h-3 w-3" /> Available</span>;
  if (state.status === "conflict") {
    const c = state.conflicts[0];
    return (
      <span className="flex items-start gap-1 text-xs font-medium text-red-600" data-testid="avail-conflict">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        {c.kind === "unavailable"
          ? <>Unavailable: {c.reason} ({c.start_date} to {c.end_date})</>
          : <>Occupied: {c.program_name} {c.start}-{c.end}</>}
      </span>
    );
  }
  return null;
}

function SessionRow({ s, onChange, onSave, onDelete, onToggleCancel, mentors }) {
  const isCancelled = s.status === "cancelled";
  const avail = useAvailability(
    isCancelled ? "" : s.mentor_name, s.date, s.start_time, s.end_time, s.id
  );
  const blocked = avail.status === "conflict";
  return (
    <div
      className={`rounded-md border p-3 ${isCancelled ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200"}`}
      data-testid="session-row"
    >
      {isCancelled && (
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-red-600" data-testid="session-cancelled-badge">
          <Ban className="h-3.5 w-3.5" /> Cancelled — hidden from the calendar and SOW
        </div>
      )}
      <div className="grid grid-cols-12 gap-2">
        <Input type="date" className="col-span-4 h-8 text-xs" value={s.date} disabled={isCancelled} onChange={(e) => onChange({ date: e.target.value })} />
        <Input type="time" className="col-span-4 h-8 text-xs" value={s.start_time} disabled={isCancelled} onChange={(e) => onChange({ start_time: e.target.value })} />
        <Input type="time" className="col-span-4 h-8 text-xs" value={s.end_time} disabled={isCancelled} onChange={(e) => onChange({ end_time: e.target.value })} />
        <Input className="col-span-7 h-8 text-xs" placeholder="Topic" value={s.topic || ""} disabled={isCancelled} onChange={(e) => onChange({ topic: e.target.value })} />
        <div className="col-span-5">
          <MentorInput className="h-8 text-xs" value={s.mentor_name || ""} onChange={(v) => onChange({ mentor_name: v })} mentors={mentors} disabled={isCancelled} testid="session-mentor-input" />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {isCancelled ? <span className="text-xs text-slate-400">Restore it to edit again</span> : <AvailabilityHint state={avail} />}
        <div className="flex gap-2">
          {isCancelled ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onToggleCancel("scheduled")} data-testid="restore-session-btn">
              <RotateCcw className="mr-1 h-3 w-3" /> Restore
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-600 hover:text-amber-700" onClick={() => onToggleCancel("cancelled")} data-testid="cancel-session-btn">
                <Ban className="mr-1 h-3 w-3" /> Cancel
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-600" onClick={onDelete}>
                <Trash2 className="mr-1 h-3 w-3" /> Delete
              </Button>
              <Button size="sm" disabled={blocked} className="h-7 bg-slate-900 text-xs hover:bg-slate-800 disabled:opacity-50" onClick={onSave} data-testid="save-session-btn">
                <Save className="mr-1 h-3 w-3" /> Save
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConflictRow({ row, onChange, mentors }) {
  const avail = useAvailability(row.mentor_name, row.date, row.start_time, row.end_time);
  return (
    <div className={`rounded-md border p-3 ${row.skip ? "border-slate-200 bg-slate-50 opacity-60" : "border-red-200 bg-red-50/40"}`} data-testid="conflict-row">
      <div className="grid grid-cols-12 gap-2">
        <Input type="date" className="col-span-4 h-8 text-xs" value={row.date} onChange={(e) => onChange({ date: e.target.value })} disabled={row.skip} />
        <Input type="time" className="col-span-4 h-8 text-xs" value={row.start_time} onChange={(e) => onChange({ start_time: e.target.value })} disabled={row.skip} />
        <Input type="time" className="col-span-4 h-8 text-xs" value={row.end_time} onChange={(e) => onChange({ end_time: e.target.value })} disabled={row.skip} />
        <Input className="col-span-7 h-8 text-xs" placeholder="Topic" value={row.topic || ""} onChange={(e) => onChange({ topic: e.target.value })} disabled={row.skip} />
        <div className="col-span-5">
          <MentorInput className="h-8 text-xs" value={row.mentor_name || ""} onChange={(v) => onChange({ mentor_name: v })} mentors={mentors} disabled={row.skip} testid="conflict-mentor-input" />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        {row.skip ? <span className="text-xs text-slate-400">Skipped — will not be imported</span> : <AvailabilityHint state={avail} />}
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange({ skip: !row.skip })} data-testid="conflict-skip-btn">
          <SkipForward className="mr-1 h-3 w-3" /> {row.skip ? "Include" : "Skip"}
        </Button>
      </div>
    </div>
  );
}

function ScheduleResolver({ data, onDone, onClose, mentors }) {
  const [rows, setRows] = useState(
    data.conflicts.map((c) => ({ ...c.session, skip: false, _key: crypto.randomUUID() }))
  );
  const [committing, setCommitting] = useState(false);

  const setRow = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const commit = async () => {
    setCommitting(true);
    try {
      const resolved = rows.filter((r) => !r.skip).map((r) => ({
        date: r.date, start_time: r.start_time, end_time: r.end_time, topic: r.topic, mentor_name: r.mentor_name,
      }));
      const sessions = [...data.clean, ...resolved];
      const r = await api.post(`/programs/${data.programId}/sessions/bulk`, { sessions });
      toast.success(`Imported ${r.data.inserted} session(s)` + (r.data.skipped.length ? `, ${r.data.skipped.length} still conflicting (skipped).` : "."));
      onDone();
    } catch (err) {
      console.error("Failed to commit schedule", err);
      toast.error("Failed to commit schedule.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="schedule-resolver">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> Resolve Schedule Conflicts
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-emerald-600">{data.clean.length}</span> session(s) are clear and will be imported.{" "}
          <span className="font-semibold text-red-600">{data.conflicts.length}</span> have mentor clashes — reassign the mentor/time or skip each.
        </div>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
          {rows.map((row, i) => <ConflictRow key={row._key} row={row} onChange={(p) => setRow(i, p)} mentors={mentors} />)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-slate-900 hover:bg-slate-800" onClick={commit} disabled={committing} data-testid="schedule-commit-btn">
            {committing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Commit Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagInput({ tags, onChange, testid, mentors = [] }) {
  const [val, setVal] = useState("");
  const [open, setOpen] = useState(false);
  const add = (name) => {
    const t = (name ?? val).trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setVal("");
    setOpen(false);
  };
  const suggestions = mentorSuggestions(val, mentors).filter((m) => !tags.includes(m));
  return (
    <div className="relative mt-2 rounded-md border border-input p-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          className="min-w-[120px] flex-1 bg-transparent px-1 text-sm outline-none"
          placeholder="Type mentor & press Enter"
          value={val}
          data-testid={testid}
          onChange={(e) => { setVal(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          }}
          onBlur={() => setTimeout(() => { add(); setOpen(false); }, 150)}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white py-1 shadow-md" data-testid={testid ? `${testid}-suggestions` : undefined}>
          {suggestions.map((m) => (
            <button
              type="button"
              key={m}
              onMouseDown={(e) => { e.preventDefault(); add(m); }}
              className="block w-full truncate px-2.5 py-1.5 text-left text-xs hover:bg-slate-50"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY = { name: "", client: "", project_code: "", team_member: "", mentors: [], status: "active" };

function ProgramForm({ initial, onSubmit, submitting, scheduleFile, setScheduleFile, showUpload, mentors = [] }) {
  const [form, setForm] = useState(initial || EMPTY);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-4 py-2">
      <Field label="Program Name *">
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="program-name-input" />
      </Field>
      <Field label="Client Name *">
        <Input value={form.client} onChange={(e) => set("client", e.target.value)} data-testid="program-client-input" />
      </Field>
      <Field label="Project Code * (used in SOW)">
        <Input className="font-mono-data" value={form.project_code} onChange={(e) => set("project_code", e.target.value)} data-testid="program-code-input" />
      </Field>
      <Field label="Team Member / Owner *">
        <Input value={form.team_member} onChange={(e) => set("team_member", e.target.value)} data-testid="program-owner-input" />
      </Field>
      <Field label="Mentor Names">
        <TagInput tags={form.mentors} onChange={(v) => set("mentors", v)} testid="program-mentor-input" mentors={mentors} />
      </Field>
      {showUpload && (
        <Field label="Upload Schedule Excel (optional)">
          <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 hover:border-slate-400">
            <Upload className="h-4 w-4" />
            {scheduleFile ? scheduleFile.name : "Choose schedule .xlsx"}
            <input type="file" accept=".xlsx" className="hidden" data-testid="program-schedule-input"
              onChange={(e) => setScheduleFile(e.target.files[0] || null)} />
          </label>
        </Field>
      )}
      <Button
        className="w-full bg-slate-900 hover:bg-slate-800"
        disabled={submitting}
        data-testid="program-save-btn"
        onClick={() => {
          if (!form.name || !form.client || !form.project_code || !form.team_member) {
            toast.error("Name, Client, Project Code and Owner are required.");
            return;
          }
          onSubmit(form);
        }}
      >
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save Program
      </Button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="label-caps">{label}</Label>
      {children}
    </div>
  );
}

function EditDrawer({ programId, open, onOpenChange, onChanged, mentors }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reuploadFile, setReuploadFile] = useState(null);
  const [reuploading, setReuploading] = useState(false);
  const [reuploadResolver, setReuploadResolver] = useState(null);

  const load = useCallback(() => {
    if (!programId) return;
    setLoading(true);
    api.get(`/programs/${programId}`).then((r) => setDetail(r.data)).finally(() => setLoading(false));
  }, [programId]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { if (!open) { setReuploadFile(null); setReuploadResolver(null); } }, [open]);

  const doReupload = async () => {
    if (!reuploadFile || !detail) return;
    setReuploading(true);
    try {
      const fd = new FormData();
      fd.append("file", reuploadFile);
      const r = await api.post(`/programs/${programId}/schedule/replace`, fd);
      setReuploadFile(null);
      if (r.data.conflicts.length === 0) {
        if (r.data.clean.length) {
          await api.post(`/programs/${programId}/sessions/bulk`, { sessions: r.data.clean });
        }
        toast.success(`Schedule replaced · ${r.data.removed_count} old session(s) removed, ${r.data.clean.length} imported.`);
        onChanged();
        load();
      } else {
        toast.warning(`${r.data.removed_count} old session(s) removed · ${r.data.conflicts.length} conflict(s) to resolve.`);
        setReuploadResolver({ programId, clean: r.data.clean, conflicts: r.data.conflicts });
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to re-upload schedule.");
    } finally {
      setReuploading(false);
    }
  };

  const saveProgram = async (form) => {
    await api.put(`/programs/${programId}`, form);
    toast.success("Program updated.");
    onChanged();
    load();
  };

  const updateSession = (sid, patch) => {
    setDetail((d) => ({ ...d, sessions: d.sessions.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }));
  };
  const saveSession = async (s) => {
    try {
      await api.put(`/sessions/${s.id}`, {
        date: s.date, start_time: s.start_time, end_time: s.end_time, topic: s.topic, mentor_name: s.mentor_name,
      });
      toast.success("Session saved.");
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save session.");
    }
  };
  const deleteSession = async (sid) => {
    await api.delete(`/sessions/${sid}`);
    setDetail((d) => ({ ...d, sessions: d.sessions.filter((s) => s.id !== sid) }));
    toast.success("Session deleted.");
    onChanged();
  };
  const toggleSessionStatus = async (sid, status) => {
    try {
      const r = await api.patch(`/sessions/${sid}/status`, { status });
      setDetail((d) => ({ ...d, sessions: d.sessions.map((s) => (s.id === sid ? r.data : s)) }));
      toast.success(status === "cancelled" ? "Session cancelled." : "Session restored.");
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update the session's status.");
    }
  };
  const addSession = async () => {
    try {
      const r = await api.post(`/sessions`, {
        program_id: programId, date: new Date().toISOString().slice(0, 10),
        start_time: "10:00", end_time: "12:00", topic: "New Session",
        mentor_name: detail?.mentors?.[0] || "",
      });
      setDetail((d) => ({ ...d, sessions: [...d.sessions, r.data] }));
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not add session (mentor conflict).");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="program-edit-drawer">
        <SheetHeader>
          <SheetTitle className="font-display">Edit Program</SheetTitle>
        </SheetHeader>
        {loading || !detail ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="mt-2">
            <ProgramForm initial={{
              name: detail.name, client: detail.client, project_code: detail.project_code,
              team_member: detail.team_member, mentors: detail.mentors || [],
              status: detail.status || "active",
            }} onSubmit={saveProgram} submitting={false} showUpload={false} mentors={mentors} />

            <div className="mt-6 border-t border-slate-100 pt-4">
              <h3 className="label-caps mb-2">Re-upload Schedule</h3>
              <p className="mb-2 text-xs text-slate-500">
                Lots of date/time changes to make? Replace all {detail.sessions.length} session(s) at once with a
                fresh Excel file instead of editing each one — client, program name, project code and team stay untouched.
              </p>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 hover:border-slate-400">
                <Upload className="h-4 w-4" />
                {reuploadFile ? reuploadFile.name : "Choose schedule .xlsx"}
                <input
                  type="file" accept=".xlsx" className="hidden" data-testid="reupload-schedule-input"
                  onChange={(e) => setReuploadFile(e.target.files[0] || null)}
                />
              </label>
              {reuploadFile && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="mt-2 w-full" variant="outline" disabled={reuploading} data-testid="reupload-schedule-btn">
                      {reuploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      Replace Schedule
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent data-testid="reupload-confirm-dialog">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Replace all {detail.sessions.length} session(s)?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes every existing session for this program and imports the ones from “{reuploadFile.name}”
                        instead. Program details (client, name, project code, team, mentors) are kept.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction className="bg-slate-900 hover:bg-slate-800" onClick={doReupload} data-testid="confirm-reupload-btn">
                        Replace
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="label-caps">
                  Sessions ({detail.sessions.length})
                  {detail.sessions.some((s) => s.status === "cancelled") && (
                    <span className="ml-1.5 font-normal normal-case text-slate-400">
                      · {detail.sessions.filter((s) => s.status === "cancelled").length} cancelled
                    </span>
                  )}
                </h3>
                <Button size="sm" variant="outline" onClick={addSession} data-testid="add-session-btn">
                  <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {detail.sessions.length === 0 && (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-slate-400">
                    No sessions yet. Add one or upload a schedule.
                  </p>
                )}
                {detail.sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    onChange={(patch) => updateSession(s.id, patch)}
                    onSave={() => saveSession(s)}
                    onDelete={() => deleteSession(s.id)}
                    onToggleCancel={(status) => toggleSessionStatus(s.id, status)}
                    mentors={mentors}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {reuploadResolver && (
          <ScheduleResolver
            data={reuploadResolver}
            onClose={() => { setReuploadResolver(null); onChanged(); load(); }}
            onDone={() => { setReuploadResolver(null); onChanged(); load(); }}
            mentors={mentors}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

function ProgramsListTab() {
  const [programs, setPrograms] = useState([]);
  const [mentors, setMentors] = useState([]);
  const [allPrograms, setAllPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scheduleFile, setScheduleFile] = useState(null);
  const [editId, setEditId] = useState(null);
  const [resolver, setResolver] = useState(null);
  const [statusFilter, setStatusFilter] = useState("active");

  const load = useCallback(() => {
    setLoading(true);
    api.get("/programs").then((r) => setPrograms(r.data)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/meta").then((r) => {
      setMentors(r.data.mentors || []);
      setAllPrograms(r.data.programs || []);
    });
  }, []);

  // Built from the full program list (not the possibly role-filtered `programs`
  // state) so a program's color matches what the Calendar page shows too.
  const colorMap = useMemo(() => buildProgramColorMap(allPrograms), [allPrograms]);

  const visiblePrograms = programs.filter((p) => {
    const status = p.status || "active";
    if (statusFilter === "all") return true;
    return status === statusFilter;
  });
  const completedCount = programs.filter((p) => (p.status || "active") === "completed").length;

  const setProgramStatus = async (id, status) => {
    try {
      await api.patch(`/programs/${id}/status`, { status });
      toast.success(status === "completed" ? "Program marked complete." : "Program reactivated.");
      load();
    } catch (err) {
      console.error("Failed to update program status", err);
      toast.error("Could not update program status.");
    }
  };

  const createProgram = async (form) => {
    setSubmitting(true);
    try {
      const r = await api.post("/programs", form);
      if (scheduleFile) {
        const fd = new FormData();
        fd.append("file", scheduleFile);
        const sr = await api.post(`/programs/${r.data.id}/schedule`, fd);
        if (sr.data.conflicts.length === 0) {
          await api.post(`/programs/${r.data.id}/sessions/bulk`, { sessions: sr.data.clean });
          toast.success(`Program created · ${sr.data.clean.length} sessions imported.`);
        } else {
          setResolver({ programId: r.data.id, clean: sr.data.clean, conflicts: sr.data.conflicts });
          toast.warning(`Program created · ${sr.data.conflicts.length} schedule conflict(s) to resolve.`);
        }
      } else {
        toast.success("Program created.");
      }
      setAddOpen(false);
      setScheduleFile(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create program.");
    } finally {
      setSubmitting(false);
    }
  };

  const removeProgram = async (id) => {
    await api.delete(`/programs/${id}`);
    toast.success("Program deleted.");
    load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-end">
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <Button className="bg-slate-900 hover:bg-slate-800" data-testid="add-program-btn">
              <Plus className="mr-2 h-4 w-4" /> Add Program
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-testid="add-program-drawer">
            <SheetHeader><SheetTitle className="font-display">New Program</SheetTitle></SheetHeader>
            <ProgramForm initial={EMPTY} onSubmit={createProgram} submitting={submitting}
              scheduleFile={scheduleFile} setScheduleFile={setScheduleFile} showUpload mentors={mentors} />
          </SheetContent>
        </Sheet>
      </div>

      <div className="mb-6 flex gap-1 rounded-md border border-slate-200 bg-white p-1 w-fit" data-testid="status-filter-tabs">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            data-testid={`status-tab-${t.value}`}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              statusFilter === t.value ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {t.label}{t.value === "completed" && completedCount > 0 ? ` (${completedCount})` : ""}
          </button>
        ))}
      </div>

      <ProgramsBody
        loading={loading} programs={programs} visiblePrograms={visiblePrograms} statusFilter={statusFilter}
        setAddOpen={setAddOpen} colorMap={colorMap} setProgramStatus={setProgramStatus}
        setEditId={setEditId} removeProgram={removeProgram}
      />

      <EditDrawer programId={editId} open={!!editId} onOpenChange={(o) => !o && setEditId(null)} onChanged={load} mentors={mentors} />

      {resolver && (
        <ScheduleResolver
          data={resolver}
          onClose={() => { setResolver(null); setAddOpen(false); setScheduleFile(null); load(); }}
          onDone={() => { setResolver(null); setAddOpen(false); setScheduleFile(null); load(); }}
          mentors={mentors}
        />
      )}
    </div>
  );
}

function ProgramCard({ p, colorMap, setProgramStatus, setEditId, removeProgram }) {
  const c = colorMap[p.id] || PROGRAM_COLORS[0];
  const isCompleted = (p.status || "active") === "completed";
  return (
    <Card className={`flex flex-col rounded-md border-slate-200 p-5 transition-transform hover:-translate-y-0.5 ${isCompleted ? "opacity-70" : ""}`} data-testid="program-card">
      <div className="mb-3 h-1.5 w-10 rounded-full" style={{ background: c.border }} />
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-lg font-bold leading-snug text-slate-900">{p.name}</h3>
        {isCompleted && <Badge variant="secondary" className="shrink-0 text-slate-500">Completed</Badge>}
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        <Row icon={Building2} text={p.client} />
        <Row icon={Hash} text={<span className="font-mono-data text-xs">{p.project_code}</span>} />
        <Row icon={Users} text={p.mentors?.length ? p.mentors.join(", ") : "No mentors"} />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono-data">{p.session_count} sessions</Badge>
          <HealthBadge health={p.health} testid={`program-health-${p.id}`} />
        </div>
        <div className="flex gap-1">
          <Button
            size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
            onClick={() => setProgramStatus(p.id, isCompleted ? "active" : "completed")}
            title={isCompleted ? "Reactivate program" : "Mark as completed"}
            data-testid="toggle-status-btn"
          >
            {isCompleted ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditId(p.id)} data-testid="edit-program-btn">
            <Pencil className="h-4 w-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500 hover:text-red-600" data-testid="delete-program-btn">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent data-testid="delete-confirm-dialog">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{p.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the program and all {p.session_count} of its sessions.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => removeProgram(p.id)} data-testid="confirm-delete-btn">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </Card>
  );
}

function ProgramsBody({
  loading, programs, visiblePrograms, statusFilter, setAddOpen,
  colorMap, setProgramStatus, setEditId, removeProgram,
}) {
  if (loading) {
    return <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  }
  if (programs.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center rounded-md border-dashed py-20 text-center">
        <FolderKanban className="mb-3 h-10 w-10 text-slate-300" />
        <p className="font-medium text-slate-600">No programs yet</p>
        <p className="mb-4 text-sm text-slate-400">Add your first program to get started.</p>
        <Button className="bg-slate-900 hover:bg-slate-800" onClick={() => setAddOpen(true)} data-testid="empty-add-program-btn">
          <Plus className="mr-2 h-4 w-4" /> Add your first program
        </Button>
      </Card>
    );
  }
  if (visiblePrograms.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center rounded-md border-dashed py-20 text-center">
        <FolderKanban className="mb-3 h-10 w-10 text-slate-300" />
        <p className="font-medium text-slate-600">No {statusFilter} programs</p>
        <p className="text-sm text-slate-400">Try a different filter above.</p>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {visiblePrograms.map((p) => (
        <ProgramCard
          key={p.id} p={p} colorMap={colorMap}
          setProgramStatus={setProgramStatus} setEditId={setEditId} removeProgram={removeProgram}
        />
      ))}
    </div>
  );
}

function Row({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-2 text-slate-600">
      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span className="truncate">{text}</span>
    </div>
  );
}

const EMPTY_PERIOD = { start_date: "", end_date: "", reason: "" };

function UnavailabilityDialog({ mentorName, periods, onClose, onChanged }) {
  const [form, setForm] = useState(EMPTY_PERIOD);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!form.start_date || !form.end_date) { toast.error("Start and end dates are required."); return; }
    if (form.start_date > form.end_date) { toast.error("Start date must be on or before end date."); return; }
    setSaving(true);
    try {
      await api.post("/mentor-unavailability", { mentor_name: mentorName, ...form });
      toast.success(`${mentorName} marked unavailable.`);
      setForm(EMPTY_PERIOD);
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save unavailability.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/mentor-unavailability/${id}`);
      toast.success("Unavailability period removed.");
      onChanged();
    } catch (err) {
      console.error("Failed to remove unavailability period", err);
      toast.error("Failed to remove period.");
    }
  };

  return (
    <Dialog open={!!mentorName} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="unavailability-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <CalendarOff className="h-5 w-5 text-amber-500" /> Unavailability — {mentorName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {periods.length === 0 && (
            <p className="text-sm text-slate-400">No unavailable periods on record.</p>
          )}
          {periods.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2.5 text-sm" data-testid="unavailability-period-row">
              <div>
                <div className="font-mono-data text-xs text-slate-700">{p.start_date} → {p.end_date}</div>
                {p.reason && <div className="text-xs text-slate-500">{p.reason}</div>}
              </div>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                onClick={() => remove(p.id)} data-testid="delete-unavailability-btn">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
          <Field label="Start Date *">
            <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} data-testid="unavailability-start-input" />
          </Field>
          <Field label="End Date *">
            <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} data-testid="unavailability-end-input" />
          </Field>
          <div className="col-span-2">
            <Field label="Reason (optional)">
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="e.g. On personal leave" data-testid="unavailability-reason-input" />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button className="bg-slate-900 hover:bg-slate-800" onClick={add} disabled={saving} data-testid="unavailability-save-btn">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Mark Unavailable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MentorRow({ m, openEdit, toggleStatus, remove, openAdd, unavailableToday, openUnavailability }) {
  return (
    <tr className="border-t border-slate-100" data-testid="mentor-row">
      <td className="px-5 py-3 font-medium text-slate-800">{m.name}</td>
      <td className="px-5 py-3 text-xs text-slate-500">
        {m.email || m.phone
          ? [m.email, m.phone].filter(Boolean).join(" · ")
          : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-5 py-3 text-xs text-slate-500">
        {m.programs.length ? m.programs.join(", ") : <span className="text-slate-300">Not yet assigned</span>}
      </td>
      <td className="px-5 py-3 text-right font-mono-data text-slate-600">{m.sessions_count}</td>
      <td className="px-5 py-3">
        {m.id ? (
          <button onClick={() => toggleStatus(m)} data-testid="mentor-status-toggle">
            <Badge variant="secondary" className={m.status === "inactive" ? "text-slate-400" : "text-emerald-700"}>
              {m.status === "inactive" ? "Inactive" : "Active"}
            </Badge>
          </button>
        ) : (
          <Badge variant="secondary" className="text-slate-400">Not in directory</Badge>
        )}
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          {unavailableToday ? (
            <Badge variant="secondary" className="gap-1 text-red-600">
              <CalendarOff className="h-3 w-3" /> Unavailable
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-slate-400">Available</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => openUnavailability(m.name)}
            data-testid="manage-unavailability-btn"
          >
            <CalendarOff className="h-3 w-3" /> Manage
          </Button>
        </div>
      </td>
      <td className="px-5 py-3 text-right">
        {m.id ? (
          <>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEdit(m)} data-testid="edit-mentor-btn">
              <Pencil className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500 hover:text-red-600" data-testid="delete-mentor-btn">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove "{m.name}" from the directory?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Their program and session history is unaffected — they'll still show up here if they have any sessions.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => remove(m.id)} data-testid="confirm-delete-mentor-btn">
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openAdd(m.name)} data-testid="formalize-mentor-btn">
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Add to Directory
          </Button>
        )}
      </td>
    </tr>
  );
}

function MentorsTableBody({ loading, filtered, mentors, openAdd, openEdit, toggleStatus, remove, isUnavailableToday, openUnavailability }) {
  if (loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }
  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Users className="mb-3 h-10 w-10 text-slate-300" />
        <p className="font-medium text-slate-600">{mentors.length === 0 ? "No mentors yet" : "No mentors match your search"}</p>
        <p className="mb-4 text-sm text-slate-400">
          {mentors.length === 0 ? "Add a mentor as soon as they start working with you." : "Try a different search."}
        </p>
        {mentors.length === 0 && (
          <Button className="bg-slate-900 hover:bg-slate-800" onClick={() => openAdd()} data-testid="empty-add-mentor-btn">
            <UserPlus className="mr-2 h-4 w-4" /> Add your first mentor
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Contact</th>
            <th className="px-5 py-3">Programs</th>
            <th className="px-5 py-3 text-right">Sessions</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Availability</th>
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => (
            <MentorRow
              key={m.id || m.name} m={m} openEdit={openEdit} toggleStatus={toggleStatus} remove={remove} openAdd={openAdd}
              unavailableToday={isUnavailableToday(m.name)} openUnavailability={openUnavailability}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY_MENTOR = { name: "", email: "", phone: "", notes: "" };

function MentorsTab() {
  const [mentors, setMentors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_MENTOR);
  const [saving, setSaving] = useState(false);
  const [periods, setPeriods] = useState([]);
  const [unavailMentor, setUnavailMentor] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/mentors").then((r) => setMentors(r.data)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadPeriods = useCallback(() => {
    api.get("/mentor-unavailability").then((r) => setPeriods(r.data));
  }, []);
  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  const isUnavailableToday = useCallback((name) => {
    const today = dayjs().format("YYYY-MM-DD");
    return periods.some((p) => p.mentor_name.toLowerCase() === name.toLowerCase()
      && p.start_date <= today && p.end_date >= today);
  }, [periods]);

  const periodsForMentor = (name) => periods.filter((p) => p.mentor_name.toLowerCase() === name.toLowerCase());

  const openAdd = (prefillName = "") => {
    setEditingId(null);
    setForm({ ...EMPTY_MENTOR, name: prefillName });
    setDialogOpen(true);
  };
  const openEdit = (m) => {
    setEditingId(m.id);
    setForm({ name: m.name, email: m.email || "", phone: m.phone || "", notes: m.notes || "" });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/mentors/${editingId}`, form);
        toast.success("Mentor updated.");
      } else {
        await api.post("/mentors", form);
        toast.success("Mentor added.");
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save mentor.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/mentors/${id}`);
      toast.success("Mentor removed from directory.");
      load();
    } catch (err) {
      console.error("Failed to remove mentor", err);
      toast.error("Failed to remove mentor.");
    }
  };

  const toggleStatus = async (m) => {
    try {
      await api.put(`/mentors/${m.id}`, { status: m.status === "inactive" ? "active" : "inactive" });
      load();
    } catch (err) {
      console.error("Failed to update mentor status", err);
      toast.error("Failed to update status.");
    }
  };

  const filtered = mentors.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div data-testid="mentors-tab">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Input
          placeholder="Search mentors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="mentor-search"
        />
        <Button className="bg-slate-900 hover:bg-slate-800" onClick={() => openAdd()} data-testid="add-mentor-btn">
          <UserPlus className="mr-2 h-4 w-4" /> Add Mentor
        </Button>
      </div>

      <Card className="overflow-hidden rounded-md border-slate-200" data-testid="mentors-table">
        <MentorsTableBody
          loading={loading} filtered={filtered} mentors={mentors}
          openAdd={openAdd} openEdit={openEdit} toggleStatus={toggleStatus} remove={remove}
          isUnavailableToday={isUnavailableToday} openUnavailability={setUnavailMentor}
        />
      </Card>

      {unavailMentor && (
        <UnavailabilityDialog
          mentorName={unavailMentor}
          periods={periodsForMentor(unavailMentor)}
          onClose={() => setUnavailMentor(null)}
          onChanged={loadPeriods}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="mentor-dialog">
          <DialogHeader><DialogTitle className="font-display">{editingId ? "Edit Mentor" : "New Mentor"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Field label="Name *">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="mentor-name-input" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="mentor-email-input" />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="mentor-phone-input" />
            </Field>
            <Field label="Notes">
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Skills, specialization, etc." data-testid="mentor-notes-input" />
            </Field>
          </div>
          <DialogFooter>
            <Button className="bg-slate-900 hover:bg-slate-800" onClick={save} disabled={saving} data-testid="mentor-save-btn">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Programs() {
  const [searchParams] = useSearchParams();
  // Lets other pages deep-link straight into a tab, e.g. Calendar's mentor
  // unavailability panel links to /programs?tab=mentors rather than leaving
  // people to find the Mentors tab on their own.
  const initialTab = searchParams.get("tab") === "mentors" ? "mentors" : "programs";

  return (
    <div data-testid="programs-page">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Programs</h1>
        <p className="mt-1 text-sm text-slate-500">Manage training programs, mentors and session schedules.</p>
      </header>

      <Tabs defaultValue={initialTab}>
        <TabsList className="mb-6" data-testid="programs-tabs">
          <TabsTrigger value="programs" data-testid="programs-tab-programs">Programs</TabsTrigger>
          <TabsTrigger value="mentors" data-testid="programs-tab-mentors">Mentors</TabsTrigger>
        </TabsList>
        <TabsContent value="programs"><ProgramsListTab /></TabsContent>
        <TabsContent value="mentors"><MentorsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
