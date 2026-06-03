import { useEffect, useState, Fragment } from "react";
import { api, API } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import MultiSelect from "@/components/MultiSelect";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet, Download, Loader2, ReceiptText } from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export default function SOW() {
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
      else toast.success("SOW generated.");
    } catch (e) {
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
    } catch (e) {
      toast.error("Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div data-testid="sow-page">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Mentor SOW</h1>
        <p className="mt-1 text-sm text-slate-500">Generate monthly statement-of-work billing for mentors.</p>
      </header>

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
                    <th className="px-4 py-2.5 font-semibold">S.No</th>
                    <th className="px-4 py-2.5 font-semibold">Mentor</th>
                    <th className="px-4 py-2.5 font-semibold">Program</th>
                    <th className="px-4 py-2.5 font-semibold">Project Code</th>
                    <th className="px-4 py-2.5 font-semibold">Client</th>
                    <th className="px-4 py-2.5 font-semibold">Month</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Sessions</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Hours</th>
                    <th className="px-4 py-2.5 font-semibold">Dates</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => { let sno = 0; return data.grouped.map((grp) => (
                    <Fragment key={grp.mentor}>
                      {grp.rows.map((r, i) => {
                        sno += 1;
                        return (
                        <tr key={`${grp.mentor}-${i}`} className="border-b border-slate-100" data-testid="sow-row">
                          <td className="px-4 py-2.5 font-mono-data text-xs text-slate-500">{sno}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800">{r.mentor}</td>
                          <td className="px-4 py-2.5 text-slate-700">{r.program_name}</td>
                          <td className="px-4 py-2.5 font-mono-data text-xs text-slate-500">{r.project_code}</td>
                          <td className="px-4 py-2.5 text-slate-700">{r.client}</td>
                          <td className="px-4 py-2.5 text-slate-500">{r.month}</td>
                          <td className="px-4 py-2.5 text-right font-mono-data">{r.sessions_conducted}</td>
                          <td className="px-4 py-2.5 text-right font-mono-data">{r.total_hours}</td>
                          <td className="px-4 py-2.5 font-mono-data text-xs text-slate-600">{r.dates}</td>
                        </tr>
                        );
                      })}
                      <tr key={`${grp.mentor}-sub`} className="border-b border-slate-200 bg-slate-100 font-semibold" data-testid="sow-subtotal">
                        <td className="px-4 py-2" colSpan={6}>{grp.mentor} — Subtotal</td>
                        <td className="px-4 py-2 text-right font-mono-data">{grp.subtotal_sessions}</td>
                        <td className="px-4 py-2 text-right font-mono-data">{grp.subtotal_hours}</td>
                        <td className="px-4 py-2"></td>
                      </tr>
                    </Fragment>
                  )); })()}
                  <tr className="bg-amber-100 font-bold text-slate-900" data-testid="sow-grand-total">
                    <td className="px-4 py-3" colSpan={6}>GRAND TOTAL</td>
                    <td className="px-4 py-3 text-right font-mono-data">{data.grand_total.sessions}</td>
                    <td className="px-4 py-3 text-right font-mono-data">{data.grand_total.hours}</td>
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
