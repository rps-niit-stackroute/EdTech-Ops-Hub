import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";

export default function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const { refresh } = useAuth();
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) { toast.error("Passwords do not match"); return; }
    if (next.length < 6) { toast.error("New password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      await refresh();
      toast.success("Password changed");
      nav("/");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500">
            <ShieldAlert className="h-7 w-7 text-white" />
          </div>
          <h1 className="font-display text-2xl font-bold text-white">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-400">You must change the default password before continuing.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur" data-testid="change-password-form">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-400">Current Password</Label>
            <Input type="password" className="mt-2 border-white/10 bg-white/5 text-white" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="cp-current" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-400">New Password</Label>
            <Input type="password" className="mt-2 border-white/10 bg-white/5 text-white" value={next} onChange={(e) => setNext(e.target.value)} data-testid="cp-new" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-400">Confirm New Password</Label>
            <Input type="password" className="mt-2 border-white/10 bg-white/5 text-white" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="cp-confirm" />
          </div>
          <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={loading} data-testid="cp-submit">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            Update Password
          </Button>
        </form>
      </div>
    </div>
  );
}
