import { useEffect, useState, useCallback } from "react";
import { api, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, ScrollText, Filter } from "lucide-react";

const ALL = "__all__";

function AuditLogBody({ loading, rows }) {
  if (loading) {
    return <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ScrollText className="mb-3 h-9 w-9 text-slate-300" />
        <p className="text-sm text-slate-400">No audit entries match these filters.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-900 text-left text-xs uppercase tracking-wider text-white">
            <th className="px-4 py-2.5">Timestamp</th>
            <th className="px-4 py-2.5">User</th>
            <th className="px-4 py-2.5">Role</th>
            <th className="px-4 py-2.5">Action</th>
            <th className="px-4 py-2.5">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100" data-testid="audit-row">
              <td className="whitespace-nowrap px-4 py-2 font-mono-data text-xs text-slate-500">
                {dayjs(r.timestamp).format("DD MMM YY, HH:mm:ss")}
              </td>
              <td className="px-4 py-2 font-medium text-slate-800">{r.user_name}</td>
              <td className="px-4 py-2"><Badge variant="secondary" className="text-[10px]">{r.role}</Badge></td>
              <td className="px-4 py-2 text-slate-700">{r.action}</td>
              <td className="px-4 py-2 text-xs text-slate-500">{r.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditLog() {
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState({ rows: [], users: [], actions: [] });
  const [loading, setLoading] = useState(true);
  const [fUser, setFUser] = useState(ALL);
  const [fAction, setFAction] = useState(ALL);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  useEffect(() => {
    if (!authLoading && user?.role !== "admin") nav("/");
  }, [authLoading, user, nav]);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (fUser !== ALL) p.set("user_name", fUser);
    if (fAction !== ALL) p.set("action", fAction);
    if (fFrom) p.set("date_from", fFrom);
    if (fTo) p.set("date_to", fTo);
    api.get(`/audit?${p.toString()}`).then((r) => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [fUser, fAction, fFrom, fTo]);

  useEffect(() => { if (user?.role === "admin") load(); }, [load, user]);

  if (user?.role !== "admin") return null;

  return (
    <div data-testid="audit-page">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Audit Log</h1>
          <p className="mt-1 text-sm text-slate-500">Full traceability of every action — ISO compliance.</p>
        </div>
        <a href={`${API}/audit/export`} target="_blank" rel="noreferrer">
          <Button variant="outline" data-testid="audit-export-btn"><Download className="mr-2 h-4 w-4" /> Export CSV</Button>
        </a>
      </header>

      <Card className="mb-4 rounded-md border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1.5 text-slate-400"><Filter className="h-4 w-4" /></div>
          <div>
            <Label className="label-caps">User</Label>
            <Select value={fUser} onValueChange={setFUser}>
              <SelectTrigger className="mt-1 w-44" data-testid="audit-filter-user"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All users</SelectItem>
                {data.users.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="label-caps">Action</Label>
            <Select value={fAction} onValueChange={setFAction}>
              <SelectTrigger className="mt-1 w-52" data-testid="audit-filter-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All actions</SelectItem>
                {data.actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="label-caps">From</Label>
            <Input type="date" className="mt-1 w-40" value={fFrom} onChange={(e) => setFFrom(e.target.value)} data-testid="audit-filter-from" />
          </div>
          <div>
            <Label className="label-caps">To</Label>
            <Input type="date" className="mt-1 w-40" value={fTo} onChange={(e) => setFTo(e.target.value)} data-testid="audit-filter-to" />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden rounded-md border-slate-200">
        <AuditLogBody loading={loading} rows={data.rows} />
      </Card>
    </div>
  );
}
