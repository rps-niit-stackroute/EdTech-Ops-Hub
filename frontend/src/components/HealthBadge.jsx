import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { HeartPulse } from "lucide-react";

const STYLES = {
  green: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500", label: "Healthy" },
  amber: { bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-500", label: "At Risk" },
  red: { bg: "bg-red-100", text: "text-red-700", dot: "bg-red-500", label: "Critical" },
};

function Bar({ label, value }) {
  const color = value >= 75 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="font-mono-data font-medium text-slate-700">{value}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

export default function HealthBadge({ health, testid }) {
  if (!health) return null;
  const s = STYLES[health.color] || STYLES.red;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-testid={testid}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-transform hover:scale-105 ${s.bg} ${s.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {health.score}%
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end" data-testid={`${testid}-popover`}>
        <div className="mb-3 flex items-center gap-2">
          <HeartPulse className={`h-4 w-4 ${s.text}`} />
          <span className="font-display text-sm font-bold">Health Score</span>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
            {health.score}% · {s.label}
          </span>
        </div>
        <div className="space-y-2.5">
          <Bar label="Attendance %" value={health.attendance} />
          <Bar label="Attentiveness %" value={health.attentiveness} />
          <Bar label="Session Completion" value={health.completion} />
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          Equal weight (33.3% each). {health.conducted}/{health.total_sessions} sessions conducted.
          {!health.has_attendance_data && " No attendance data yet."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
