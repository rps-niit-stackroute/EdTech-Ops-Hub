import { useEffect, useState, useCallback } from "react";
import { api, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Database, Download, UserPlus, Trash2, Loader2, Clock, ShieldCheck, Users as UsersIcon,
} from "lucide-react";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "team_member", label: "Team Member" },
  { value: "viewer", label: "Viewer" },
];

export default function Settings() {
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [users, setUsers] = useState([]);
  const [lastBackup, setLastBackup] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", name: "", role: "team_member" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== "admin")) nav("/");
  }, [authLoading, user, nav]);

  const load = useCallback(() => {
    api.get("/users").then((r) => setUsers(r.data)).catch(() => {});
    api.get("/admin/backup/last").then((r) => setLastBackup(r.data.last_backup)).catch(() => {});
  }, []);
  useEffect(() => { if (user?.role === "admin") load(); }, [load, user]);

  if (!user || user.role !== "admin") return null;

  const downloadBackup = async () => {
    setDownloading(true);
    try {
      const res = await api.get("/admin/backup", { responseType: "blob" });
      const cd = res.headers["content-disposition"] || "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const fname = m ? m[1] : "EdTechOpsHub_Backup.zip";
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
      load();
    } catch (e) {
      toast.error("Backup failed");
    } finally {
      setDownloading(false);
    }
  };

  const createUser = async () => {
    if (!form.username || !form.password) { toast.error("Username and password required"); return; }
    setSaving(true);
    try {
      await api.post("/users", form);
      toast.success("User created");
      setAddOpen(false);
      setForm({ username: "", password: "", name: "", role: "team_member" });
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (id) => {
    try {
      await api.delete(`/users/${id}`);
      toast.success("User deleted");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to delete");
    }
  };

  const changeRole = async (id, role) => {
    try {
      await api.put(`/users/${id}`, { role });
      toast.success("Role updated");
      load();
    } catch (e) {
      toast.error("Failed to update role");
    }
  };

  return (
    <div data-testid="settings-page">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Admin Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage users and back up all system data.</p>
      </header>

      <Card className="mb-6 rounded-md border-slate-200 p-6" data-testid="backup-section">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold">Backup &amp; Export</h2>
              <p className="text-sm text-slate-500">Full ZIP: database, programs, attendance, audit log, SOW records.</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                <Clock className="h-3 w-3" />
                {lastBackup
                  ? `Last backup: ${dayjs(lastBackup.created_at).format("DD MMM YYYY, HH:mm")} by ${lastBackup.generated_by}`
                  : "No backup taken yet"}
              </p>
            </div>
          </div>
          <Button className="bg-slate-900 hover:bg-slate-800" onClick={downloadBackup} disabled={downloading} data-testid="download-backup-btn">
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download Full Backup
          </Button>
        </div>
      </Card>

      <Card className="rounded-md border-slate-200" data-testid="users-section">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-5 w-5 text-slate-600" />
            <h2 className="font-display text-lg font-bold">User Accounts</h2>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="bg-slate-900 hover:bg-slate-800" data-testid="add-user-btn"><UserPlus className="mr-2 h-4 w-4" /> Add User</Button>
            </DialogTrigger>
            <DialogContent data-testid="add-user-dialog">
              <DialogHeader><DialogTitle className="font-display">New User Account</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div><Label className="label-caps">Username</Label><Input className="mt-1" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} data-testid="user-username" /></div>
                <div><Label className="label-caps">Full Name</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="user-name" /></div>
                <div><Label className="label-caps">Password</Label><Input type="password" className="mt-1" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="user-password" /></div>
                <div>
                  <Label className="label-caps">Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                    <SelectTrigger className="mt-1" data-testid="user-role"><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button className="bg-slate-900 hover:bg-slate-800" onClick={createUser} disabled={saving} data-testid="user-save-btn">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create User
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="px-6 py-2.5">Name</th>
                <th className="px-6 py-2.5">Username</th>
                <th className="px-6 py-2.5">Role</th>
                <th className="px-6 py-2.5">Created</th>
                <th className="px-6 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100" data-testid="user-row">
                  <td className="px-6 py-3 font-medium text-slate-800">{u.name}</td>
                  <td className="px-6 py-3 font-mono-data text-xs text-slate-500">{u.username}</td>
                  <td className="px-6 py-3">
                    <Select value={u.role} onValueChange={(v) => changeRole(u.id, v)}>
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-6 py-3 text-xs text-slate-400">{dayjs(u.created_at).format("DD MMM YY")}</td>
                  <td className="px-6 py-3 text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500 hover:text-red-600" data-testid="delete-user-btn">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete user “{u.username}”?</AlertDialogTitle>
                          <AlertDialogDescription>This permanently removes the account.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteUser(u.id)} data-testid="confirm-delete-user-btn">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
