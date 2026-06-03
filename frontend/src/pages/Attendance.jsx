import { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
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

export default function Attendance() {
  const [tracker, setTracker] = useState(null);
  const [teams, setTeams] = useState(null);
  const [sessionName, setSessionName] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [threshold, setThreshold] = useState(50);
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [blobUrl, setBlobUrl] = useState(null);
  const [detecting, setDetecting] = useState(false);

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
    } catch (_) {
      /* silent */
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
      let msg = "Processing failed.";
      if (e.response?.data) {
        try {
          msg = JSON.parse(await e.response.data.text()).detail || msg;
        } catch (_) {}
      }
      setErrorMsg(msg);
      setStatus("error");
      toast.error(msg);
    }
  };

  const downloadFile = () => {
    if (!blobUrl || !result) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = result.fname;
    a.click();
  };

  return (
    <div data-testid="attendance-page">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Attendance Tracker</h1>
        <p className="mt-1 text-sm text-slate-500">
          Append a new Teams session to your master tracker — preserving format, colors & structure.
        </p>
      </header>

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
              <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                <Stat label="Participants" value={result.total_participants} />
                <Stat label="Matched" value={result.matched} />
                <Stat label="Present" value={result.present} />
                <Stat label="Session Mins" value={result.session_minutes} />
              </div>

              <Button className="mt-5 w-full bg-green-600 hover:bg-green-700" onClick={downloadFile} data-testid="attendance-download-btn">
                <Download className="mr-2 h-4 w-4" /> Download {result.fname}
              </Button>

              {result.uncertain?.length > 0 && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-1.5 text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-xs font-semibold">Uncertain matches (first-name only)</span>
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
                    <span className="text-xs font-semibold">{result.unmatched.length} unmatched name(s) — not added</span>
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
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="font-mono-data text-xl font-bold text-slate-900">{value}</div>
      <div className="label-caps mt-0.5 !text-[0.6rem]">{label}</div>
    </div>
  );
}
