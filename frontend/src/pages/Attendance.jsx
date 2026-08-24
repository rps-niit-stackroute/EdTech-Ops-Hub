import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Layers,
  Trash2,
  MessageSquareText,
} from "lucide-react";

function FileDrop({ id, label, accept, file, onChange, testid }) {
  return (
    <div>
      <Label className="label-caps">{label}</Label>
      <label
        htmlFor={id}
        className={`mt-2 flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-4 py-4 transition-colors ${
          file ? "border-blue-400 bg-blue-50/50" : "border-slate-300 hover:border-slate-400 bg-slate-50"
        }`}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white border border-slate-200">
          {file ? <FileSpreadsheet className="h-4 w-4 text-blue-600" /> : <Upload className="h-4 w-4 text-slate-400" />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-700">
            {file ? file.name : "Click to choose file"}
          </div>
          <div className="text-xs text-slate-400">{accept}</div>
        </div>
        <input
          id={id}
          type="file"
          accept={accept}
          className="hidden"
          data-testid={testid}
          onChange={(e) => onChange(e.target.files[0] || null)}
        />
      </label>
    </div>
  );
}

async function extractErrorMessage(err, fallback) {
  if (!err.response?.data) return fallback;
  try {
    const text = await err.response.data.text();
    return JSON.parse(text).detail || fallback;
  } catch (parseErr) {
    console.debug("Could not parse error response body", parseErr);
    return fallback;
  }
}

function downloadBlob(blobUrl, filename) {
  if (!blobUrl || !filename) return;
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.click();
}

function Stat({ label, value, className = "" }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className={`font-mono-data text-xl font-bold text-slate-900 ${className}`}>{value}</div>
      <div className="label-caps mt-0.5 !text-[0.6rem]">{label}</div>
    </div>
  );
}

function SingleSessionTab() {
  const [tracker, setTracker] = useState(null);
  const [teams, setTeams] = useState(null);
  const [sessionName, setSessionName] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [threshold, setThreshold] = useState(50);
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [blobUrl, setBlobUrl] = useState(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    api.get("/meta").then((r) => setPrograms(r.data.programs || [])).catch(() => {});
  }, []);

  const handleTeamsChange = async (f) => {
    setTeams(f);
    if (!f) return;
    setDetecting(true);
    try {
      const fd = new FormData();
      fd.append("teams", f);
      const r = await api.post("/attendance/detect-date", fd);
      if (r.data?.session_date) {
        setSessionDate(r.data.session_date);
        toast.success(`Session date auto-detected: ${r.data.session_date}`);
      } else {
        toast.info("Couldn't auto-detect date — please pick it manually.");
      }
    } catch (err) {
      console.debug("Session date auto-detect failed", err);
    } finally {
      setDetecting(false);
    }
  };

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setTracker(null);
    setTeams(null);
    setSessionName("");
    setSessionDate("");
    setThreshold(50);
    setProgramId("");
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
  };

  const submit = async () => {
    if (!tracker || !teams || !sessionName || !sessionDate) {
      toast.error("Please fill all fields and upload both files.");
      return;
    }
    setStatus("loading");
    setErrorMsg("");
    const fd = new FormData();
    fd.append("tracker", tracker);
    fd.append("teams", teams);
    fd.append("session_name", sessionName);
    fd.append("session_date", sessionDate);
    fd.append("threshold", String(threshold));
    if (programId) fd.append("program_id", programId);
    try {
      const res = await api.post("/attendance/update", fd, { responseType: "blob" });
      const info = JSON.parse(decodeURIComponent(res.headers["x-process-info"] || "%7B%7D"));
      const fname = decodeURIComponent(res.headers["x-output-filename"] || "updated_tracker.xlsx");
      const url = URL.createObjectURL(res.data);
      setBlobUrl(url);
      setResult({ ...info, fname });
      setStatus("success");
      toast.success("Tracker updated successfully.");
    } catch (e) {
      const msg = await extractErrorMessage(e, "Processing failed.");
      setErrorMsg(msg);
      setStatus("error");
      toast.error(msg);
    }
  };

  const downloadFile = () => downloadBlob(blobUrl, result?.fname);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <Card className="rounded-md border-slate-200 p-6 lg:col-span-3">
        <div className="space-y-5">
          <FileDrop id="tracker-file" label="Existing Tracker Excel (.xlsx)" accept=".xlsx" file={tracker} onChange={setTracker} testid="attendance-tracker-input" />
          <FileDrop id="teams-file" label="Teams Attendance Export (.csv / .xlsx)" accept=".csv,.xlsx" file={teams} onChange={handleTeamsChange} testid="attendance-teams-input" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="label-caps">Session Name</Label>
              <Input
                className="mt-2"
                placeholder="e.g. Security By Design"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                data-testid="attendance-session-name"
              />
            </div>
            <div>
              <Label className="label-caps flex items-center gap-1.5">
                Session Date
                {detecting && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
              </Label>
              <Input
                type="date"
                className="mt-2"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                data-testid="attendance-session-date"
              />
              <p className="mt-1 text-[11px] text-slate-400">Auto-detected from the Teams export · editable</p>
            </div>
          </div>

          <div>
            <Label className="label-caps">Program (optional)</Label>
            <Select value={programId} onValueChange={setProgramId}>
              <SelectTrigger className="mt-2" data-testid="attendance-program-select">
                <SelectValue placeholder="Select the program this session belongs to" />
              </SelectTrigger>
              <SelectContent>
                {programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-slate-400">
              If this program has a scheduled session on the date above, its planned duration caps the
              attendance/attentiveness calculation — so a meeting left running late, or ended early, doesn't skew the numbers.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="label-caps">Attendance Threshold</Label>
              <span className="font-mono-data text-sm font-semibold text-blue-600" data-testid="attendance-threshold-value">
                {threshold}%
              </span>
            </div>
            <Slider
              className="mt-4"
              min={0}
              max={100}
              step={5}
              value={[threshold]}
              onValueChange={(v) => setThreshold(v[0])}
              data-testid="attendance-threshold-slider"
            />
            <p className="mt-2 text-xs text-slate-400">
              A participant is marked <b>Present</b> if their in-meeting minutes ÷ session minutes ≥ threshold.
            </p>
          </div>

          <Button
            className="w-full bg-slate-900 hover:bg-slate-800"
            onClick={submit}
            disabled={status === "loading" || !tracker || !teams || !sessionName || !sessionDate}
            data-testid="attendance-process-btn"
          >
            {status === "loading" ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</>
            ) : (
              <><FileSpreadsheet className="mr-2 h-4 w-4" /> Process &amp; Download</>
            )}
          </Button>
        </div>
      </Card>

      <div className="lg:col-span-2">
        {status === "idle" && (
          <Card className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-md border-dashed border-slate-300 p-6 text-center">
            <FileSpreadsheet className="mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-400">Results will appear here after processing.</p>
          </Card>
        )}

        {status === "loading" && (
          <Card className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-md border-slate-200 p-6 text-center">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-slate-500">Parsing Teams export & updating tracker…</p>
          </Card>
        )}

        {status === "success" && result && (
          <Card className="rounded-md border-green-200 bg-white p-6" data-testid="attendance-success">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold">Tracker updated</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <Stat label="Enrolled" value={result.enrolled} />
              <Stat label="Present" value={result.present} className="text-green-600" />
              <Stat label="Absent" value={result.absent} className="text-red-600" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center">
              <Stat label="Matched" value={result.matched} />
              <Stat label="Session Mins" value={result.session_minutes} />
            </div>

            {result.capped_by_schedule && (
              <p className="mt-3 text-xs text-blue-600" data-testid="attendance-capped-note">
                Session duration was capped to the scheduled length from the program's calendar —
                the Teams export reported a longer meeting than what was actually planned.
              </p>
            )}

            <Button className="mt-5 w-full bg-green-600 hover:bg-green-700" onClick={downloadFile} data-testid="attendance-download-btn">
              <Download className="mr-2 h-4 w-4" /> Download {result.fname}
            </Button>

            {result.absent_names?.length > 0 && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3" data-testid="attendance-absent">
                <div className="flex items-center gap-1.5 text-red-700">
                  <XCircle className="h-4 w-4" />
                  <span className="text-xs font-semibold">
                    {result.absent_names.length} absent — enrolled but not in today's Teams recording
                  </span>
                </div>
                <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-xs text-red-700">
                  {result.absent_names.map((n) => <li key={n}>• {n}</li>)}
                </ul>
              </div>
            )}

            {result.uncertain?.length > 0 && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-1.5 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs font-semibold">Uncertain matches — please double-check</span>
                </div>
                <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700">
                  {result.uncertain.map((n) => <li key={n}>• {n}</li>)}
                </ul>
              </div>
            )}

            {result.unmatched?.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="attendance-warnings">
                <div className="flex items-center gap-1.5 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs font-semibold">
                    {result.unmatched.length} name(s) in the Teams recording but not in the consolidated report
                  </span>
                </div>
                <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-xs text-amber-700">
                  {result.unmatched.map((n) => <li key={n}>• {n}</li>)}
                </ul>
              </div>
            )}

            <Button variant="ghost" className="mt-3 w-full" onClick={reset} data-testid="attendance-reset-btn">
              <RotateCcw className="mr-2 h-4 w-4" /> Process another
            </Button>
          </Card>
        )}

        {status === "error" && (
          <Card className="rounded-md border-red-200 bg-red-50/50 p-6" data-testid="attendance-error">
            <div className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              <span className="font-semibold">Processing failed</span>
            </div>
            <p className="mt-2 text-sm text-red-600">{errorMsg}</p>
            <Button variant="outline" className="mt-4 w-full" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Try again
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}

function FeedbackSummary({ feedback }) {
  if (!feedback.sheet_found) {
    return (
      <p className="mt-2 text-xs text-amber-700">
        This tracker has no Feedback sheet — nothing was added.
      </p>
    );
  }
  if (feedback.columns_missing) {
    return (
      <p className="mt-2 text-xs text-amber-700">
        The Feedback sheet is missing a Date or Participant Name column — nothing was added.
      </p>
    );
  }
  return (
    <>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="Added" value={feedback.added} className="text-green-600" />
        <Stat label="Already had" value={feedback.skipped_existing_dates} />
        <Stat label="Unmatched" value={feedback.unmatched_rows} className="text-amber-600" />
      </div>
      {feedback.unmatched_dates?.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          No schedule found for: {feedback.unmatched_dates.join(", ")}
        </p>
      )}
    </>
  );
}

async function detectDayDate(row, setDays) {
  try {
    const fd = new FormData();
    fd.append("teams", row.file);
    const r = await api.post("/attendance/detect-date", fd);
    setDays((d) => d.map((x) => (x.id === row.id
      ? { ...x, sessionDate: r.data?.session_date || "", detecting: false }
      : x)));
  } catch (err) {
    console.debug("Session date auto-detect failed", err);
    setDays((d) => d.map((x) => (x.id === row.id ? { ...x, detecting: false } : x)));
  }
}

function BatchSessionTab() {
  const [tracker, setTracker] = useState(null);
  const [sessionName, setSessionName] = useState("");
  const [threshold, setThreshold] = useState(50);
  const [days, setDays] = useState([]); // {id, file, sessionName, sessionDate, detecting}
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    api.get("/meta").then((r) => setPrograms(r.data.programs || [])).catch(() => {});
  }, []);

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const newRows = files.map((f) => ({
      id: `${f.name}-${f.lastModified}-${crypto.randomUUID()}`,
      file: f,
      sessionName,
      sessionDate: "",
      detecting: true,
    }));
    setDays((d) => [...d, ...newRows]);
    newRows.forEach((row) => detectDayDate(row, setDays));
  };

  const updateDay = (id, patch) => setDays((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeDay = (id) => setDays((d) => d.filter((x) => x.id !== id));

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setTracker(null);
    setSessionName("");
    setThreshold(50);
    setDays([]);
    setProgramId("");
    setFeedback(null);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
  };

  const allValid = tracker && days.length > 0 && days.every((d) => d.sessionName && d.sessionDate)
    && (!feedback || programId);

  const submit = async () => {
    if (!allValid) {
      if (feedback && !programId) {
        toast.error("Select a program so feedback can be matched against its schedule.");
      } else {
        toast.error("Upload a tracker and make sure every day has a session name and date.");
      }
      return;
    }
    setStatus("loading");
    setErrorMsg("");
    const fd = new FormData();
    fd.append("tracker", tracker);
    days.forEach((d) => {
      fd.append("teams_files", d.file);
      fd.append("session_names", d.sessionName);
      fd.append("session_dates", d.sessionDate);
    });
    fd.append("threshold", String(threshold));
    if (programId) fd.append("program_id", programId);
    if (feedback) fd.append("feedback", feedback);
    try {
      const res = await api.post("/attendance/update-batch", fd, { responseType: "blob" });
      const info = JSON.parse(decodeURIComponent(res.headers["x-process-info"] || "%7B%7D"));
      const fname = decodeURIComponent(res.headers["x-output-filename"] || "updated_tracker.xlsx");
      const url = URL.createObjectURL(res.data);
      setBlobUrl(url);
      setResult({ ...info, fname });
      setStatus("success");
      toast.success(`${info.sessions_processed} day(s) consolidated into one tracker.`);
    } catch (e) {
      const msg = await extractErrorMessage(e, "Processing failed.");
      setErrorMsg(msg);
      setStatus("error");
      toast.error(msg);
    }
  };

  const downloadFile = () => downloadBlob(blobUrl, result?.fname);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <Card className="rounded-md border-slate-200 p-6 lg:col-span-3">
        <div className="space-y-5">
          <FileDrop id="batch-tracker-file" label="Existing Tracker Excel (.xlsx)" accept=".xlsx" file={tracker} onChange={setTracker} testid="batch-tracker-input" />

          <div>
            <Label className="label-caps">Default Session Name</Label>
            <Input
              className="mt-2"
              placeholder="e.g. Security By Design"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              data-testid="batch-session-name"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Applied to newly added days below — each day's name stays individually editable.
            </p>
          </div>

          <div>
            <Label className="label-caps">Teams Exports — one or more days</Label>
            <label
              htmlFor="batch-teams-files"
              className="mt-2 flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-4 transition-colors hover:border-slate-400"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white">
                <Layers className="h-4 w-4 text-slate-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-700">Click to add Teams exports</div>
                <div className="text-xs text-slate-400">.csv, .xlsx — select multiple at once, or add more later</div>
              </div>
              <input
                id="batch-teams-files"
                type="file"
                accept=".csv,.xlsx"
                multiple
                className="hidden"
                data-testid="batch-teams-input"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
              />
            </label>
          </div>

          {days.length > 0 && (
            <div className="space-y-2" data-testid="batch-day-list">
              {days.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="batch-day-row">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-blue-500" />
                  <div className="min-w-[8rem] max-w-[10rem] flex-1 truncate text-xs text-slate-500" title={d.file.name}>
                    {d.file.name}
                  </div>
                  <Input
                    className="h-8 w-36 text-xs"
                    placeholder="Session name"
                    value={d.sessionName}
                    onChange={(e) => updateDay(d.id, { sessionName: e.target.value })}
                    data-testid="batch-day-name"
                  />
                  <div className="relative flex items-center">
                    <Input
                      type="date"
                      className="h-8 w-36 text-xs"
                      value={d.sessionDate}
                      onChange={(e) => updateDay(d.id, { sessionDate: e.target.value })}
                      data-testid="batch-day-date"
                    />
                    {d.detecting && <Loader2 className="ml-1.5 h-3.5 w-3.5 animate-spin text-blue-500" />}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 p-0 text-red-500 hover:text-red-600"
                    onClick={() => removeDay(d.id)}
                    data-testid="batch-day-remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div>
            <Label className="label-caps">Program (optional)</Label>
            <Select value={programId} onValueChange={setProgramId}>
              <SelectTrigger className="mt-2" data-testid="batch-program-select">
                <SelectValue placeholder="Select the program these sessions belong to" />
              </SelectTrigger>
              <SelectContent>
                {programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-slate-400">
              Needed for the Feedback Export below. It also lets each day's attendance/attentiveness be
              capped at that day's scheduled duration, so a meeting left running late doesn't skew the numbers.
            </p>
          </div>

          <div className="rounded-md border border-slate-200 p-4">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-slate-500" />
              <Label className="label-caps">Feedback Export (optional)</Label>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Consolidate a raw feedback-form export into the tracker's Feedback sheet — the session date, module
              and mentor are looked up from the program's schedule, and dates already captured are skipped.
            </p>

            <div className="mt-3">
              <FileDrop
                id="batch-feedback-file"
                label="Feedback Export (.xlsx)"
                accept=".xlsx"
                file={feedback}
                onChange={setFeedback}
                testid="batch-feedback-input"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="label-caps">Attendance Threshold</Label>
              <span className="font-mono-data text-sm font-semibold text-blue-600" data-testid="batch-threshold-value">
                {threshold}%
              </span>
            </div>
            <Slider
              className="mt-4"
              min={0}
              max={100}
              step={5}
              value={[threshold]}
              onValueChange={(v) => setThreshold(v[0])}
              data-testid="batch-threshold-slider"
            />
            <p className="mt-2 text-xs text-slate-400">Applied to every day in this batch.</p>
          </div>

          <Button
            className="w-full bg-slate-900 hover:bg-slate-800"
            onClick={submit}
            disabled={status === "loading" || !allValid}
            data-testid="batch-process-btn"
          >
            {status === "loading" ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Consolidating {days.length} day(s)…</>
            ) : (
              <><FileSpreadsheet className="mr-2 h-4 w-4" /> Consolidate &amp; Download</>
            )}
          </Button>
        </div>
      </Card>

      <div className="lg:col-span-2">
        {status === "idle" && (
          <Card className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-md border-dashed border-slate-300 p-6 text-center">
            <Layers className="mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-400">
              Add a tracker and one or more Teams exports to consolidate several days into one tracker in a single pass.
            </p>
          </Card>
        )}

        {status === "loading" && (
          <Card className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-md border-slate-200 p-6 text-center">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm text-slate-500">Appending each day to the tracker in chronological order…</p>
          </Card>
        )}

        {status === "success" && result && (
          <Card className="rounded-md border-green-200 bg-white p-6" data-testid="batch-success">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold">{result.sessions_processed} day(s) consolidated</span>
            </div>

            <Button className="mt-5 w-full bg-green-600 hover:bg-green-700" onClick={downloadFile} data-testid="batch-download-btn">
              <Download className="mr-2 h-4 w-4" /> Download {result.fname}
            </Button>

            <div className="mt-4 space-y-3">
              {result.days?.map((d) => (
                <div key={`${d.session_name}-${d.session_date}`} className="rounded-md border border-slate-200 p-3" data-testid="batch-day-summary">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-800">
                    <span className="truncate">{d.session_name}</span>
                    <span className="shrink-0 font-mono-data text-xs text-slate-400">{d.session_date}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <Stat label="Enrolled" value={d.enrolled} />
                    <Stat label="Present" value={d.present} className="text-green-600" />
                    <Stat label="Absent" value={d.absent} className="text-red-600" />
                  </div>
                  {d.unmatched?.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700">
                      {d.unmatched.length} unmatched name(s) in this file.
                    </p>
                  )}
                  {d.capped_by_schedule && (
                    <p className="mt-2 text-xs text-blue-600" data-testid="batch-day-capped-note">
                      Duration capped to this day's scheduled length.
                    </p>
                  )}
                </div>
              ))}
            </div>

            {result.feedback && (
              <div className="mt-4 rounded-md border border-slate-200 p-3" data-testid="batch-feedback-summary">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                  <MessageSquareText className="h-4 w-4 text-slate-500" />
                  Feedback consolidation
                </div>
                <FeedbackSummary feedback={result.feedback} />
              </div>
            )}

            <Button variant="ghost" className="mt-3 w-full" onClick={reset} data-testid="batch-reset-btn">
              <RotateCcw className="mr-2 h-4 w-4" /> Process another batch
            </Button>
          </Card>
        )}

        {status === "error" && (
          <Card className="rounded-md border-red-200 bg-red-50/50 p-6" data-testid="batch-error">
            <div className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              <span className="font-semibold">Processing failed</span>
            </div>
            <p className="mt-2 text-sm text-red-600">{errorMsg}</p>
            <Button variant="outline" className="mt-4 w-full" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Try again
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function Attendance() {
  return (
    <div data-testid="attendance-page">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Attendance Tracker</h1>
        <p className="mt-1 text-sm text-slate-500">
          Append Teams sessions to your master tracker — preserving format, colors &amp; structure.
        </p>
      </header>

      <Tabs defaultValue="single">
        <TabsList className="mb-6" data-testid="attendance-tabs">
          <TabsTrigger value="single" data-testid="attendance-tab-single">Single Session</TabsTrigger>
          <TabsTrigger value="batch" data-testid="attendance-tab-batch">Consolidate Multiple Days</TabsTrigger>
        </TabsList>
        <TabsContent value="single"><SingleSessionTab /></TabsContent>
        <TabsContent value="batch"><BatchSessionTab /></TabsContent>
      </Tabs>
    </div>
  );
}
