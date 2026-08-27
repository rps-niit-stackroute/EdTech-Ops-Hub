import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { toast } from "sonner";
import {
  LayoutDashboard,
  ClipboardCheck,
  CalendarDays,
  FolderKanban,
  ReceiptText,
  HelpCircle,
  ScrollText,
  Settings as SettingsIcon,
  LogOut,
  LogIn,
  Sun,
  Moon,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, id: "dashboard", end: true },
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck, id: "attendance" },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, id: "calendar" },
  { to: "/programs", label: "Programs", icon: FolderKanban, id: "programs" },
  { to: "/sow", label: "Mentor SOW", icon: ReceiptText, id: "sow" },
  { to: "/help", label: "Help & Guidelines", icon: HelpCircle, id: "help" },
];

const ADMIN_NAV = [
  { to: "/audit", label: "Audit Log", icon: ScrollText, id: "audit" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, id: "settings" },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const nav = useNavigate();
  const isAdmin = user?.role === "admin";

  const doLogout = async () => {
    await logout();
    toast.success("Signed out");
    nav("/login");
  };

  const renderItem = (item) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.id}
        to={item.to}
        end={item.end}
        data-testid={`sidebar-nav-${item.id}`}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
          }`
        }
      >
        <Icon className="h-[18px] w-[18px]" />
        {item.label}
      </NavLink>
    );
  };

  // viewers only see dashboard
  const mainNav = user?.role === "viewer" ? NAV.filter((n) => n.id === "dashboard") : NAV;

  return (
    <aside data-testid="sidebar" className="fixed left-0 top-0 z-30 flex h-screen w-64 flex-col bg-[#0A0A0A] text-white">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-white/10">
        <div className="flex h-10 items-center justify-center rounded-md bg-white px-2 py-1.5">
          <img src="/stackroute-rps-logo.png" alt="StackRoute | RPS" className="h-full w-auto object-contain" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-base font-bold tracking-tight">Delivery Automation</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">NIIT StackRoute</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
        <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.2em] text-slate-600">Operations</p>
        {mainNav.map(renderItem)}
        {isAdmin && (
          <>
            <p className="px-3 pb-2 pt-4 text-[10px] uppercase tracking-[0.2em] text-slate-600">Administration</p>
            {ADMIN_NAV.map(renderItem)}
          </>
        )}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <button
          onClick={toggleTheme}
          data-testid="theme-toggle-btn"
          className="mb-3 flex w-full items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        {user ? (
          <div className="mb-3 flex items-center gap-2.5" data-testid="sidebar-user">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-bold uppercase">
              {(user.name || user.username || "?").slice(0, 1)}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium text-white">{user.name}</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{user.role.replace("_", " ")}</div>
            </div>
          </div>
        ) : null}
        {user ? (
          <button
            onClick={doLogout}
            data-testid="logout-btn"
            className="mb-3 flex w-full items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        ) : (
          <button
            onClick={() => nav("/login")}
            data-testid="login-link-btn"
            className="mb-3 flex w-full items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogIn className="h-4 w-4" /> Login
          </button>
        )}
      </div>
    </aside>
  );
}
