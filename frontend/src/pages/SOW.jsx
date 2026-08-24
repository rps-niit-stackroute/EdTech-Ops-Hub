import { useEffect, useState, Fragment } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import dayjs from "dayjs";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import MultiSelect from "@/components/MultiSelect";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ProvisionPanel from "@/components/ProvisionPanel";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet, Download, Loader2, ReceiptText, AlertTriangle, History } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function deltaColorClass(sessDelta, hoursDelta) {
  if (hoursDelta === 0 && sessDelta === 0) return "text-slate-500";
  if (hoursDelta > 0 || sessDelta > 0) return "text-green-700";
  return "text-red-700";
}

function MentorSowTab() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(now.getFullYear());
  const [meta, setMeta] = useState({ mentors: [], programs: [] });
  const [selMentors, setSelMentors] = useState([]);
  const [selPrograms, setSelPrograms] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => { api.get("/meta").then((r) => setMeta(r.data)); }, []);

  const qs = () => {
    const p = new URLSearchParams({ month, year: String(year) });
    if (selMentors.length) p.set("mentors", selMentors.join(","));
    if (selPrograms.length) p.set("programs", selPrograms.join(","));
    return p.toString();
  };

  const generate = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/sow?${qs()}`);
      setData(r.data);
      if (r.data.grand_total.sessions === 0) toast.info("No sessions match these filters.");
      else if (r.data.changes?.length) {
        toast.warning(`${r.data.changes.length} program(s) have schedule changes since the last SOW — see below.`);
      } else toast.success("SOW generated.");
    } catch (err) {
      console.error("Failed to generate SOW", err);
      toast.error("Failed to generate SOW.");
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const res = await api.get(`/sow/download?${qs()}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SOW_${MONTHS[Number(month) - 1]}_${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel downloaded.");
    } catch (err) {
      console.error("SOW download failed", err);
      toast.error("Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div data-testid="mentor-sow-tab">
      <Card className="mb-6 rounded-md border-slate-200 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div>
            <Label className="label-caps">Month</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="mt-2" data-testid="sow-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="label-caps">Year</Label>
            <Input type="number" className="mt-2 font-mono-data" value={year}
              onChange={(e) => setYear(Number(e.target.value))} data-testid="sow-year" />
          </div>
          <div>
            <Label className="label-caps">Mentors</Label>
            <div className="mt-2">
              <MultiSelect options={meta.mentors} selected={selMentors} onChange={setSelMentors}
                placeholder="All mentors" testid="sow-mentors" />
            </div>
          </div>
          <div>
            <Label className="label-caps">Programs</Label>
            <div className="mt-2">
              <MultiSelect options={meta.programs.map((p) => ({ value: p.id, label: p.name }))}
                selected={selPrograms} onChange={setSelPrograms} placeholder="All programs" testid="sow-programs" />
            </div>
          </div>
          <div className="flex items-end">
            <Button className="w-full bg-slate-900 hover:bg-slate-800" onClick={generate} disabled={loading} data-testid="sow-generate-btn">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
              Generate SOW
            </Button>
          </div>
        </div>
      </Card>

      {!data && (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed py-20 text-center">
          <ReceiptText className="mb-3 h-10 w-10 text-slate-300" />
          <p className="font-medium text-slate-600">No SOW generated yet</p>
          <p className="text-sm text-slate-400">Choose filters and click Generate SOW.</p>
        </Card>
      )}

      {data && data.changes?.length > 0 && (
        <Card className="mb-6 rounded-md border-amber-300 bg-amber-50 p-5" data-testid="sow-changes-alert">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="font-display text-base font-bold">
              Schedule changed since this SOW was last generated ({data.changes.length})
            </h2>
          </div>
          <p className="mt-1 text-xs text-amber-700">
            The numbers below reflect the current schedule. Here's what's different from the last time the SOW was downloaded for this period:
          </p>
          <ul className="mt-3 space-y-2">
            {data.changes.map((c, i) => {
              const sessDelta = c.new_sessions - c.prev_sessions;
              const hoursDelta = Math.round((c.new_hours - c.prev_hours) * 100) / 100;
              const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
              return (
                <li key={`${c.program_id}-${c.mentor}-${i}`}
                  className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm" data-testid="sow-change-row">
                  <div className="font-medium text-slate-800">
                    {c.program_name} {c.project_code ? `(${c.project_code})` : ""} — {c.mentor}
                  </div>
                  {c.removed ? (
                    <p className="mt-0.5 text-xs text-red-700">
                      Previously billed <b>{c.prev_sessions} sessions / {c.prev_hours} hrs</b>
                      {c.last_generated_at ? ` (as of ${dayjs(c.last_generated_at).format("DD MMM YYYY")})` : ""} —
                      no sessions found for this program/mentor this month now. The schedule may have been cleared or moved.
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-600">
                      Was <b>{c.prev_sessions} sessions / {c.prev_hours} hrs</b>
                      {c.last_generated_at ? ` (last generated ${dayjs(c.last_generated_at).format("DD MMM YYYY")})` : ""}
                      {" "}→ now <b>{c.new_sessions} sessions / {c.new_hours} hrs</b>
                      {" "}
                      <span className={deltaColorClass(sessDelta, hoursDelta)}>
                        ({sign(sessDelta)} session{Math.abs(sessDelta) === 1 ? "" : "s"}, {sign(hoursDelta)} hrs)
                      </span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {data && (
        <Card className="overflow-hidden rounded-md border-slate-200" data-testid="sow-preview">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
            <div>
              <h2 className="font-display text-lg font-bold">SOW — {data.month_label}</h2>
              <p className="text-xs text-slate-500">
                {data.grand_total.sessions} sessions · {data.grand_total.hours} hours
              </p>
            </div>
            <Button variant="outline" onClick={download} disabled={downloading || data.grand_total.sessions === 0} data-testid="sow-download-btn">
              {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Download Excel
            </Button>
          </div>

          {data.grand_total.sessions === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">No matching sessions for this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-left text-xs uppercase tracking-wider text-white">
                    <th className="px-4 py-2.5 font-semibold">Month</th>
                    <th className="px-4 py-2.5 font-semibold">Trainer</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Duration Hours</th>
                    <th className="px-4 py-2.5 font-semibold">Training</th>
                    <th className="px-4 py-2.5 font-semibold">Start Date</th>
                    <th className="px-4 py-2.5 font-semibold">End Date</th>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold">Project Code</th>
                    <th className="px-4 py-2.5 font-semibold">Project Manager</th>
                    <th className="px-4 py-2.5 font-semibold">Session Dates</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Session Count</th>
                    <th className="px-4 py-2.5 font-semibold">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.grouped.map((grp) => (
                    <Fragment key={grp.mentor}>
                      {grp.rows.map((r, i) => (
                        <tr key={`${grp.mentor}-${i}`} className="border-b border-slate-100" data-testid="sow-row">
                          <td className="px-4 py-2.5 text-slate-500">{r.month}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800">{r.mentor}</td>
                          <td className="px-4 py-2.5 text-right font-mono-data">{r.total_hours}</td>
                          <td className="px-4 py-2.5 text-slate-700">{r.program_name}</td>
                          <td className="px-4 py-2.5 font-mono-data text-xs text-slate-600">{r.start_date}</td>
                          <td className="px-4 py-2.5 font-mono-data text-xs text-slate-600">{r.end_date}</td>
                          <td className="px-4 py-2.5 text-slate-700">{r.client}</td>
                          <td className="px-4 py-2.5 font-mono-data text-xs text-slate-500">{r.project_code}</td>
                          <td className="px-4 py-2.5 text-slate-700">{r.project_manager}</td>
                          <td className="px-4 py-2.5 font-mono-data text-xs text-slate-600">{r.dates}</td>
                          <td className="px-4 py-2.5 text-right font-mono-data">{r.sessions_conducted}</td>
                          <td className="px-4 py-2.5 text-slate-400">—</td>
                        </tr>
                      ))}
                      <tr key={`${grp.mentor}-sub`} className="border-b border-slate-200 bg-slate-100 font-semibold" data-testid="sow-subtotal">
                        <td className="px-4 py-2" colSpan={2}>{grp.mentor} — Subtotal</td>
                        <td className="px-4 py-2 text-right font-mono-data">{grp.subtotal_hours}</td>
                        <td className="px-4 py-2" colSpan={7}></td>
                        <td className="px-4 py-2 text-right font-mono-data">{grp.subtotal_sessions}</td>
                        <td className="px-4 py-2"></td>
                      </tr>
                    </Fragment>
                  ))}
                  <tr className="bg-amber-100 font-bold text-slate-900" data-testid="sow-grand-total">
                    <td className="px-4 py-3" colSpan={2}>GRAND TOTAL</td>
                    <td className="px-4 py-3 text-right font-mono-data">{data.grand_total.hours}</td>
                    <td className="px-4 py-3" colSpan={7}></td>
                    <td className="px-4 py-3 text-right font-mono-data">{data.grand_total.sessions}</td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function SowHistoryBody({ loading, history, downloadingId, downloadAgain }) {
  if (loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <History className="mb-3 h-10 w-10 text-slate-300" />
        <p className="font-medium text-slate-600">No SOWs downloaded yet</p>
        <p className="text-sm text-slate-400">Every SOW you download from the Mentor SOW tab will show up here.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
            <th className="px-5 py-3">Month</th>
            <th className="px-5 py-3">Downloaded By</th>
            <th className="px-5 py-3">Date</th>
            <th className="px-5 py-3">Filters</th>
            <th className="px-5 py-3 text-right">Sessions</th>
            <th className="px-5 py-3 text-right">Hours</th>
            <th className="px-5 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-t border-slate-100" data-testid="sow-history-row">
              <td className="px-5 py-3 font-medium text-slate-800">{h.month_label}</td>
              <td className="px-5 py-3 text-slate-600">{h.downloaded_by}</td>
              <td className="px-5 py-3 text-xs text-slate-400">{dayjs(h.downloaded_at).format("DD MMM YYYY, HH:mm")}</td>
              <td className="px-5 py-3 text-xs text-slate-500">
                {h.mentors || h.programs ? (
                  <>
                    {h.mentors && <span>Mentors: {h.mentors}</span>}
                    {h.mentors && h.programs && <br />}
                    {h.programs && <span>Programs: {h.programs}</span>}
                  </>
                ) : (
                  <span className="text-slate-300">All</span>
                )}
              </td>
              <td className="px-5 py-3 text-right font-mono-data">{h.total_sessions}</td>
              <td className="px-5 py-3 text-right font-mono-data">{h.total_hours}</td>
              <td className="px-5 py-3 text-right">
                <Button
                  size="sm" variant="outline" className="h-8 text-xs"
                  onClick={() => downloadAgain(h)}
                  disabled={downloadingId === h.id}
                  data-testid="sow-history-download-btn"
                >
                  {downloadingId === h.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                  Download again
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SowHistoryTab() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get("/sow/history").then((r) => setHistory(r.data.history || [])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const downloadAgain = async (h) => {
    setDownloadingId(h.id);
    try {
      const p = new URLSearchParams({ month: h.month, year: String(h.year) });
      if (h.mentors) p.set("mentors", h.mentors);
      if (h.programs) p.set("programs", h.programs);
      const res = await api.get(`/sow/download?${p.toString()}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = h.filename || `SOW_${h.month_label.replace(/\s+/g, "_")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel downloaded.");
      load();
    } catch (err) {
      console.error("SOW history re-download failed", err);
      toast.error("Download failed.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div data-testid="sow-history-tab">
      <Card className="overflow-hidden rounded-md border-slate-200" data-testid="sow-history-table">
        <SowHistoryBody loading={loading} history={history} downloadingId={downloadingId} downloadAgain={downloadAgain} />
      </Card>
    </div>
  );
}

export default function SOW() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div data-testid="sow-page">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Mentor SOW</h1>
        <p className="mt-1 text-sm text-slate-500">Generate monthly statement-of-work billing for mentors.</p>
      </header>

      <Tabs defaultValue="sow">
        <TabsList className="mb-6" data-testid="sow-tabs">
          <TabsTrigger value="sow" data-testid="sow-tab-mentor">Mentor SOW</TabsTrigger>
          <TabsTrigger value="history" data-testid="sow-tab-history">SOW History</TabsTrigger>
          {isAdmin && <TabsTrigger value="provision" data-testid="sow-tab-provision">Provision</TabsTrigger>}
        </TabsList>
        <TabsContent value="sow"><MentorSowTab /></TabsContent>
        <TabsContent value="history"><SowHistoryTab /></TabsContent>
        {isAdmin && <TabsContent value="provision"><ProvisionPanel /></TabsContent>}
      </Tabs>
    </div>
  );
}
