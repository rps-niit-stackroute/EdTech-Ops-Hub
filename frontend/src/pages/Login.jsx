import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GraduationCap, Loader2, Lock } from "lucide-react";

export default function Login({ viewer = false }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await login(username, password, viewer);
      toast.success(`Welcome, ${u.name}`);
      if (u.must_change_password) nav("/change-password");
      else nav(viewer ? "/" : "/");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0A0A] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600">
            <GraduationCap className="h-7 w-7 text-white" />
          </div>
          <h1 className="font-display text-2xl font-bold text-white">EdTech Ops Hub</h1>
          <p className="mt-1 text-sm text-slate-400">
            {viewer ? "Stakeholder / Viewer access" : "Sign in to your workspace"}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur"
          data-testid="login-form"
        >
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-400">Username</Label>
            <Input
              className="mt-2 border-white/10 bg-white/5 text-white placeholder:text-slate-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={viewer ? "client username" : "admin"}
              data-testid="login-username"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-400">Password</Label>
            <Input
              type="password"
              className="mt-2 border-white/10 bg-white/5 text-white placeholder:text-slate-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              data-testid="login-password"
            />
          </div>
          <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={loading} data-testid="login-submit">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
            Sign In
          </Button>

          <div className="pt-2 text-center text-xs text-slate-500">
            {viewer ? (
              <Link to="/login" className="hover:text-slate-300">← Team / Admin login</Link>
            ) : (
              <>
                <Link to="/" className="hover:text-slate-300">Continue without login →</Link>
                <span className="mx-2">·</span>
                <Link to="/viewer" className="hover:text-slate-300">Viewer login</Link>
              </>
            )}
          </div>
        </form>
        <p className="mt-6 text-center text-xs text-slate-600">Engineered by Arya Ghai</p>
      </div>
    </div>
  );
}
