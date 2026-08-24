import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import MultiSelect from "@/components/MultiSelect";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  FileSpreadsheet, Download, Loader2, ReceiptText, UserPlus, Trash2, Pencil, PlusCircle,
} from "lucide-react";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export default function ProvisionPanel() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(now.getFullYear());
  const [mentors, setMentors] = useState([]);
  const [selMentors, setSelMentors] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [mentorDialogOpen, setMentorDialogOpen] = useState(false);
  const [mentorForm, setMentorForm] = useState({ name: "", cost_per_hour: "" });
  const [editingMentorId, setEditingMentorId] = useState(null);
  const [savingMentor, setSavingMentor] = useState(false);

  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [chargeForm, setChargeForm] = useState({ trainer: "", description: "", total_cost: "" });
  const [savingCharge, setSavingCharge] = useState(false);

  const loadMentors = useCallback(() => {
    api.get("/provision/mentors").then((r) => setMentors(r.data)).catch(() => {});
  }, []);
  useEffect(() => { loadMentors(); }, [loadMentors]);

  const qs = () => {
    const p = new URLSearchParams({ month, year: String(year) });
    if (selMentors.length) p.set("mentors", selMentors.join(","));
    return p.toString();
  };

  const generate = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/provision?${qs()}`);
      setData(r.data);
      if (r.data.rows.length === 0 && r.data.charges.length === 0) {
        toast.info("No provision entries for this period.");
      } else toast.success("Provision report generated.");
    } catch (err) {
      console.error("Failed to generate Provision report", err);
      toast.error("Failed to generate Provision report.");
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const res = await api.get(`/provision/download?${qs()}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Provision_${MONTHS[Number(month) - 1]}_${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel downloaded.");
    } catch (err) {
      console.error("Provision download failed", err);
      toast.error("Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  const openAddMentor = () => {
    setEditingMentorId(null);
    setMentorForm({ name: "", cost_per_hour: "" });
    setMentorDialogOpen(true);
  };

  const openEditMentor = (m) => {
    setEditingMentorId(m.id);
    setMentorForm({ name: m.name, cost_per_hour: String(m.cost_per_hour) });
    setMentorDialogOpen(true);
  };

  const saveMentor = async () => {
    if (!mentorForm.name.trim()) { toast.error("Mentor name is required"); return; }
    setSavingMentor(true);
    try {
      const payload = { name: mentorForm.name.trim(), cost_per_hour: Number(mentorForm.cost_per_hour) || 0 };
      if (editingMentorId) await api.put(`/provision/mentors/${editingMentorId}`, payload);
      else await api.post("/provision/mentors", payload);
      toast.success(editingMentorId ? "Mentor updated" : "Mentor added");
      setMentorDialogOpen(false);
      loadMentors();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save mentor");
    } finally {
      setSavingMentor(false);
    }
  };

  const deleteMentor = async (id) => {
    try {
      await api.delete(`/provision/mentors/${id}`);
      toast.success("Mentor removed");
      const removedName = mentors.find((m) => m.id === id)?.name;
      setSelMentors((s) => s.filter((n) => n !== removedName));
      loadMentors();
    } catch (err) {
      console.error("Failed to remove Provision mentor", err);
      toast.error("Failed to remove mentor");
    }
  };

  const saveCharge = async () => {
    if (!chargeForm.trainer.trim() || !chargeForm.total_cost) {
      toast.error("Trainer/vendor and total cost are required");
      return;
    }
    setSavingCharge(true);
    try {
      await api.post("/provision/charges", {
        month, year: Number(year),
        trainer: chargeForm.trainer.trim(),
        description: chargeForm.description.trim(),
        total_cost: Number(chargeForm.total_cost),
      });
      toast.success("Service charge added");
      setChargeDialogOpen(false);
      setChargeForm({ trainer: "", description: "", total_cost: "" });
      generate();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to add charge");
    } finally {
      setSavingCharge(false);
    }
  };

  const deleteCharge = async (id) => {
    try {
      await api.delete(`/provision/charges/${id}`);
      toast.success("Charge removed");
      generate();
    } catch (err) {
      console.error("Failed to remove Provision charge", err);
      toast.error("Failed to remove charge");
    }
  };

  return (
    <div data-testid="provision-panel">
      <Card className="mb-6 rounded-md border-slate-200 p-5" data-testid="provision-mentors-section">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold">Provision Mentors</h2>
            <p className="text-xs text-slate-500">
              Mentors billed separately from the regular Mentor SOW. Their sessions are excluded from it automatically.
            </p>
          </div>
          <Button className="bg-slate-900 hover:bg-slate-800" onClick={openAddMentor} data-testid="add-provision-mentor-btn">
            <UserPlus className="mr-2 h-4 w-4" /> Add Mentor
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Cost / hr</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mentors.map((m) => (
                <tr key={m.id} className="border-t border-slate-100" data-testid="provision-mentor-row">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{m.name}</td>
                  <td className="px-4 py-2.5 font-mono-data text-slate-600">₹{m.cost_per_hour}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEditMentor(m)} data-testid="edit-provision-mentor-btn">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500 hover:text-red-600" data-testid="delete-provision-mentor-btn">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove “{m.name}” from Provision?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Their future sessions will go back to appearing in the regular Mentor SOW.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteMentor(m.id)}>Remove</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              ))}
              {mentors.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-400">No Provision mentors yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={mentorDialogOpen} onOpenChange={setMentorDialogOpen}>
        <DialogContent data-testid="provision-mentor-dialog">
          <DialogHeader><DialogTitle className="font-display">{editingMentorId ? "Edit Mentor" : "New Provision Mentor"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="label-caps">Name</Label>
              <Input className="mt-1" value={mentorForm.name}
                onChange={(e) => setMentorForm({ ...mentorForm, name: e.target.value })}
                placeholder="Must match the mentor name used in Schedule" data-testid="provision-mentor-name" />
            </div>
            <div>
              <Label className="label-caps">Cost per hour (₹)</Label>
              <Input type="number" className="mt-1 font-mono-data" value={mentorForm.cost_per_hour}
                onChange={(e) => setMentorForm({ ...mentorForm, cost_per_hour: e.target.value })}
                data-testid="provision-mentor-rate" />
            </div>
          </div>
          <DialogFooter>
            <Button className="bg-slate-900 hover:bg-slate-800" onClick={saveMentor} disabled={savingMentor} data-testid="provision-mentor-save-btn">
              {savingMentor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="mb-6 rounded-md border-slate-200 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div>
            <Label className="label-caps">Month</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="mt-2" data-testid="provision-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="label-caps">Year</Label>
            <Input type="number" className="mt-2 font-mono-data" value={year}
              onChange={(e) => setYear(Number(e.target.value))} data-testid="provision-year" />
          </div>
          <div>
            <Label className="label-caps">Mentors</Label>
            <div className="mt-2">
              <MultiSelect options={mentors.map((m) => m.name)} selected={selMentors} onChange={setSelMentors}
                placeholder="All Provision mentors" testid="provision-mentors-filter" />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" className="w-full" onClick={() => setChargeDialogOpen(true)} data-testid="add-charge-btn">
              <PlusCircle className="mr-2 h-4 w-4" /> Service Charge
            </Button>
          </div>
          <div className="flex items-end">
            <Button className="w-full bg-slate-900 hover:bg-slate-800" onClick={generate} disabled={loading} data-testid="provision-generate-btn">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
              Generate
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={chargeDialogOpen} onOpenChange={setChargeDialogOpen}>
        <DialogContent data-testid="provision-charge-dialog">
          <DialogHeader><DialogTitle className="font-display">Add Service Charge — {MONTHS[Number(month) - 1]} {year}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-slate-500">
              For flat monthly charges not tied to any session (e.g. a vendor retainer). Not billed by the hour.
            </p>
            <div>
              <Label className="label-caps">Trainer / Vendor</Label>
              <Input className="mt-1" value={chargeForm.trainer}
                onChange={(e) => setChargeForm({ ...chargeForm, trainer: e.target.value })} data-testid="charge-trainer" />
            </div>
            <div>
              <Label className="label-caps">Description</Label>
              <Input className="mt-1" value={chargeForm.description}
                onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
                placeholder="e.g. Service charges for the month" data-testid="charge-description" />
            </div>
            <div>
              <Label className="label-caps">Total Cost (₹)</Label>
              <Input type="number" className="mt-1 font-mono-data" value={chargeForm.total_cost}
                onChange={(e) => setChargeForm({ ...chargeForm, total_cost: e.target.value })} data-testid="charge-total-cost" />
            </div>
          </div>
          <DialogFooter>
            <Button className="bg-slate-900 hover:bg-slate-800" onClick={saveCharge} disabled={savingCharge} data-testid="charge-save-btn">
              {savingCharge ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Add Charge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!data && (
        <Card className="flex flex-col items-center justify-center rounded-md border-dashed py-20 text-center">
          <ReceiptText className="mb-3 h-10 w-10 text-slate-300" />
          <p className="font-medium text-slate-600">No Provision report generated yet</p>
          <p className="text-sm text-slate-400">Choose a period and click Generate.</p>
        </Card>
      )}

      {data && (
        <Card className="overflow-hidden rounded-md border-slate-200" data-testid="provision-preview">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
            <div>
              <h2 className="font-display text-lg font-bold">Provision — {data.month_label}</h2>
              <p className="text-xs text-slate-500">
                {data.grand_total.hours} hours · ₹{data.grand_total.cost} total
              </p>
            </div>
            <Button variant="outline" onClick={download} disabled={downloading} data-testid="provision-download-btn">
              {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Download Excel
            </Button>
          </div>

          {data.rows.length === 0 && data.charges.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">No provision entries for this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 text-left text-xs uppercase tracking-wider text-white">
                    <th className="px-4 py-2.5 font-semibold">Trainer</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Duration Hours</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Cost / hr</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Total Cost</th>
                    <th className="px-4 py-2.5 font-semibold">Training</th>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold">Session Dates</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Sessions</th>
                    <th className="px-4 py-2.5 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={`${r.mentor}-${r.program_name}-${r.dates}`} className="border-b border-slate-100" data-testid="provision-row">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{r.mentor}</td>
                      <td className="px-4 py-2.5 text-right font-mono-data">{r.total_hours}</td>
                      <td className="px-4 py-2.5 text-right font-mono-data">₹{r.cost_per_hour}</td>
                      <td className="px-4 py-2.5 text-right font-mono-data">₹{r.total_cost}</td>
                      <td className="px-4 py-2.5 text-slate-700">{r.program_name}</td>
                      <td className="px-4 py-2.5 text-slate-700">{r.client}</td>
                      <td className="px-4 py-2.5 font-mono-data text-xs text-slate-600">{r.dates}</td>
                      <td className="px-4 py-2.5 text-right font-mono-data">{r.sessions_conducted}</td>
                      <td className="px-4 py-2.5"></td>
                    </tr>
                  ))}
                  {data.charges.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 bg-slate-50" data-testid="provision-charge-row">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{c.trainer}</td>
                      <td className="px-4 py-2.5 text-right font-mono-data text-slate-400">NA</td>
                      <td className="px-4 py-2.5 text-right font-mono-data text-slate-400">NA</td>
                      <td className="px-4 py-2.5 text-right font-mono-data">₹{c.total_cost}</td>
                      <td className="px-4 py-2.5 text-slate-700" colSpan={4}>{c.description}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                          onClick={() => deleteCharge(c.id)} data-testid="delete-charge-btn">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-amber-100 font-bold text-slate-900" data-testid="provision-grand-total">
                    <td className="px-4 py-3">GRAND TOTAL</td>
                    <td className="px-4 py-3 text-right font-mono-data">{data.grand_total.hours}</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-right font-mono-data">₹{data.grand_total.cost}</td>
                    <td className="px-4 py-3" colSpan={5}></td>
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
