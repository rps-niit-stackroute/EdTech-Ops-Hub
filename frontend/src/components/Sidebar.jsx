import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  ClipboardCheck,
  CalendarDays,
  FolderKanban,
  ReceiptText,
  GraduationCap,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, id: "dashboard", end: true },
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck, id: "attendance" },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, id: "calendar" },
  { to: "/programs", label: "Programs", icon: FolderKanban, id: "programs" },
  { to: "/sow", label: "Mentor SOW", icon: ReceiptText, id: "sow" },
];

export default function Sidebar() {
  const loc = useLocation();
  return (
    <aside
      data-testid="sidebar"
      className="fixed left-0 top-0 z-30 flex h-screen w-64 flex-col bg-[#0A0A0A] text-white"
    >
      <div className="flex items-center gap-3 px-6 py-6 border-b border-white/10">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-600">
          <GraduationCap className="h-5 w-5 text-white" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-base font-bold tracking-tight">EdTech Ops Hub</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">NIIT StackRoute</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-5">
        <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.2em] text-slate-600">Operations</p>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.end}
              data-testid={`sidebar-nav-${item.id}`}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-6 py-4">
        <div className="text-[11px] text-slate-500">Internal tool · v1.0</div>
        <div className="text-[11px] text-slate-600">{loc.pathname}</div>
      </div>
    </aside>
  );
}
