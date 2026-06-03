import { useEffect, useState, useCallback } from "react";
import { api, programColor } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus, Pencil, Trash2, X, Loader2, Users, Hash, Building2, FolderKanban,
  Upload, Save, CalendarPlus,
} from "lucide-react";

function TagInput({ tags, onChange, testid }) {
  const [val, setVal] = useState("");
  const add = () => {
    const t = val.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setVal("");
  };
  return (
    <div className="mt-2 rounded-md border border-input p-2">
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
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}

const EMPTY = { name: "", client: "", project_code: "", team_member: "", mentors: [] };

function ProgramForm({ initial, onSubmit, submitting, scheduleFile, setScheduleFile, showUpload }) {
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
        <TagInput tags={form.mentors} onChange={(v) => set("mentors", v)} testid="program-mentor-input" />
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

function EditDrawer({ programId, open, onOpenChange, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!programId) return;
    setLoading(true);
    api.get(`/programs/${programId}`).then((r) => setDetail(r.data)).finally(() => setLoading(false));
  }, [programId]);

  useEffect(() => { if (open) load(); }, [open, load]);

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
    await api.put(`/sessions/${s.id}`, {
      date: s.date, start_time: s.start_time, end_time: s.end_time, topic: s.topic, mentor_name: s.mentor_name,
    });
    toast.success("Session saved.");
    onChanged();
  };
  const deleteSession = async (sid) => {
    await api.delete(`/sessions/${sid}`);
    setDetail((d) => ({ ...d, sessions: d.sessions.filter((s) => s.id !== sid) }));
    toast.success("Session deleted.");
    onChanged();
  };
  const addSession = async () => {
    const r = await api.post(`/sessions`, {
      program_id: programId, date: new Date().toISOString().slice(0, 10),
      start_time: "10:00", end_time: "12:00", topic: "New Session",
      mentor_name: detail?.mentors?.[0] || "",
    });
    setDetail((d) => ({ ...d, sessions: [...d.sessions, r.data] }));
    onChanged();
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
            }} onSubmit={saveProgram} submitting={false} showUpload={false} />

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="label-caps">Sessions ({detail.sessions.length})</h3>
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
                  <div key={s.id} className="rounded-md border border-slate-200 p-3" data-testid="session-row">
                    <div className="grid grid-cols-12 gap-2">
                      <Input type="date" className="col-span-4 h-8 text-xs" value={s.date} onChange={(e) => updateSession(s.id, { date: e.target.value })} />
                      <Input type="time" className="col-span-4 h-8 text-xs" value={s.start_time} onChange={(e) => updateSession(s.id, { start_time: e.target.value })} />
                      <Input type="time" className="col-span-4 h-8 text-xs" value={s.end_time} onChange={(e) => updateSession(s.id, { end_time: e.target.value })} />
                      <Input className="col-span-7 h-8 text-xs" placeholder="Topic" value={s.topic || ""} onChange={(e) => updateSession(s.id, { topic: e.target.value })} />
                      <Input className="col-span-5 h-8 text-xs" placeholder="Mentor" value={s.mentor_name || ""} onChange={(e) => updateSession(s.id, { mentor_name: e.target.value })} />
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-600" onClick={() => deleteSession(s.id)}>
                        <Trash2 className="mr-1 h-3 w-3" /> Delete
                      </Button>
                      <Button size="sm" className="h-7 bg-slate-900 text-xs hover:bg-slate-800" onClick={() => saveSession(s)} data-testid="save-session-btn">
                        <Save className="mr-1 h-3 w-3" /> Save
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Programs() {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scheduleFile, setScheduleFile] = useState(null);
  const [editId, setEditId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/programs").then((r) => setPrograms(r.data)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const createProgram = async (form) => {
    setSubmitting(true);
    try {
      const r = await api.post("/programs", form);
      if (scheduleFile) {
        const fd = new FormData();
        fd.append("file", scheduleFile);
        const sr = await api.post(`/programs/${r.data.id}/schedule`, fd);
        toast.success(`Program created · ${sr.data.inserted} sessions imported.`);
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
    <div data-testid="programs-page">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Programs</h1>
          <p className="mt-1 text-sm text-slate-500">Manage training programs, mentors and session schedules.</p>
        </div>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <Button className="bg-slate-900 hover:bg-slate-800" data-testid="add-program-btn">
              <Plus className="mr-2 h-4 w-4" /> Add Program
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-testid="add-program-drawer">
            <SheetHeader><SheetTitle className="font-display">New Program</SheetTitle></SheetHeader>
            <ProgramForm initial={EMPTY} onSubmit={createProgram} submitting={submitting}
              scheduleFile={scheduleFile} setScheduleFile={setScheduleFile} showUpload />
          </SheetContent>
        </Sheet>
      </header>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : programs.length === 0 ? (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed py-20 text-center">
          <FolderKanban className="mb-3 h-10 w-10 text-slate-300" />
          <p className="font-medium text-slate-600">No programs yet</p>
          <p className="mb-4 text-sm text-slate-400">Add your first program to get started.</p>
          <Button className="bg-slate-900 hover:bg-slate-800" onClick={() => setAddOpen(true)} data-testid="empty-add-program-btn">
            <Plus className="mr-2 h-4 w-4" /> Add your first program
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {programs.map((p) => {
            const c = programColor(p.id);
            return (
              <Card key={p.id} className="flex flex-col rounded-md border-slate-200 p-5 transition-transform hover:-translate-y-0.5" data-testid="program-card">
                <div className="mb-3 h-1.5 w-10 rounded-full" style={{ background: c.border }} />
                <h3 className="font-display text-lg font-bold leading-snug text-slate-900">{p.name}</h3>
                <div className="mt-3 space-y-1.5 text-sm">
                  <Row icon={Building2} text={p.client} />
                  <Row icon={Hash} text={<span className="font-mono-data text-xs">{p.project_code}</span>} />
                  <Row icon={Users} text={p.mentors?.length ? p.mentors.join(", ") : "No mentors"} />
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <Badge variant="secondary" className="font-mono-data">{p.session_count} sessions</Badge>
                  <div className="flex gap-1">
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
          })}
        </div>
      )}

      <EditDrawer programId={editId} open={!!editId} onOpenChange={(o) => !o && setEditId(null)} onChanged={load} />
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
