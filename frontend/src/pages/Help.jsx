import { Card } from "@/components/ui/card";
import {
  CalendarDays,
  ReceiptText,
  BookOpen,
  FileSpreadsheet,
  ShieldCheck,
} from "lucide-react";

function Section({ icon: Icon, title, children, testid }) {
  return (
    <Card className="rounded-md border-slate-200 p-6" data-testid={testid}>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-white">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <h2 className="font-display text-lg font-bold text-slate-900">{title}</h2>
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </Card>
  );
}

function Code({ children }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono-data text-[0.85em] text-slate-800">
      {children}
    </code>
  );
}

export default function Help() {
  return (
    <div data-testid="help-page">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">Help &amp; Guidelines</h1>
        <p className="mt-1 text-sm text-slate-500">
          What this tool does, and the file formats it expects so your uploads go through without errors.
        </p>
      </header>

      <div className="space-y-6">
        <Section icon={BookOpen} title="What's in this tool" testid="help-overview">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><b>Dashboard</b> — a live snapshot: active programs, sessions this week, mentor clashes, program health scores, and a rolling 7-day list of any schedule edits that may affect billing.</li>
            <li><b>Attendance</b> — append one Teams session at a time, or consolidate several days (and optionally a feedback-form export) into one tracker in a single pass. Attendance/Attentiveness columns are appended automatically, matching the tracker's existing formatting and highlighting rows that need attention.</li>
            <li><b>Calendar</b> — upload a program's schedule (or add sessions one at a time) to see everything on a calendar, with mentor double-booking conflicts flagged automatically.</li>
            <li><b>Programs</b> — create and manage client programs, their mentors, and their session lists.</li>
            <li><b>Mentor SOW</b> — generate and download a monthly billing statement per mentor/program, with any schedule drift since it was last downloaded called out automatically. Admins also have a <b>Provision</b> sub-tab for mentors billed separately from the regular SOW.</li>
          </ul>
          <p>
            Everything you do is tied to your account, and admins can see it in the Audit Log. If you don't have
            access to a page you expect to, an admin can grant it from <b>Settings</b>.
          </p>
        </Section>

        <Section icon={CalendarDays} title="Uploading a program schedule" testid="help-schedule-format">
          <p>Upload an Excel workbook (the tool reads the first/active sheet). It looks for a header row within the first 15 rows containing a date-like column plus at least one other schedule-related column, and understands these column headers (case-insensitive, partial match):</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><Code>Date</Code> — required. Accepts most common formats: <Code>2026-07-19</Code>, <Code>19-Jul-2026</Code>, <Code>19/07/2026</Code>, <Code>07/19/2026</Code>, or "19th July 2026". Rows without a readable date are skipped.</li>
            <li><Code>Start</Code> / <Code>End</Code> — separate time columns, <b>or</b> a single <Code>Session Time</Code>/<Code>Time</Code> column with a range like <Code>10:00 AM - 11:00 AM</Code>.</li>
            <li><Code>Topic</Code> / <Code>Session Name</Code> / <Code>Course Module</Code> / <Code>Module</Code> — the session title (optional).</li>
            <li><Code>Duration</Code> / <Code>Hours</Code> / <Code>Session Duration</Code> — optional; accepts a plain number of hours or a duration like <Code>1h 30m</Code>. If left out, duration is calculated from start/end time.</li>
            <li><Code>Mentor</Code> / <Code>Trainer</Code> / <Code>Faculty</Code> — one or more columns (e.g. <Code>Mentor 1</Code>, <Code>Mentor 2</Code>). A cell can list multiple mentors separated by a comma or slash — one session gets created per mentor.</li>
          </ul>
          <p>
            After upload, the tool shows which sessions are clean and which conflict with an existing booking for
            that mentor — you resolve conflicts before anything is committed to the calendar.
          </p>
        </Section>

        <Section icon={FileSpreadsheet} title="Processing attendance" testid="help-attendance-format">
          <p><b>Existing tracker Excel</b> — the master tracker you already maintain per program. It needs three sheets, matched by name (case-insensitive, partial match — name them clearly to avoid the tool guessing wrong):</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>A sheet with <Code>consolidated</Code> or <Code>report</Code> in its name — the per-session Attendance + Attentiveness columns.</li>
            <li>A sheet with <Code>overall</Code> or <Code>attendance %</Code> in its name — the one-column-per-session rollup.</li>
            <li>A sheet with <Code>login</Code> in its name — raw join/leave times and duration.</li>
            <li>A sheet with <Code>feedback</Code> in its name (optional) — only needed if you also consolidate a feedback export.</li>
          </ul>
          <p>
            Each of the first two sheets needs a <Code>Name</Code> column, and sub-header labels
            ("Attendance" / "Attentiveness" / "Overall") consistently on the <b>same row</b> across every existing
            session — row 2 or row 3 both work, as long as it's not mixed within one sheet. New columns copy their
            formatting from the most recent existing session, and the day header only gets merged across the
            Attendance + Attentiveness columns if that's how this tracker's own existing day-headers are already
            set up — so the output matches whatever convention this specific tracker already uses.
          </p>
          <p><b>Teams attendance export</b> — the raw <Code>.csv</Code> or <Code>.xlsx</Code> file Teams generates. It needs a "Meeting Duration" line in the summary section, and a participants table with <Code>Name</Code> and a duration column (<Code>First Join</Code> / <Code>Last Leave</Code> / <Code>Attentiveness</Code> are used if present).</p>
          <p>
            <b>Attendance threshold</b> — a participant is marked <b>Present</b> if their in-meeting minutes ÷ session
            minutes is at least the threshold you set (50% by default). Attentiveness is calculated separately as
            each participant's duration relative to whoever stayed longest.
          </p>
          <p>
            After processing, you'll see who's present/absent against your enrolled list, plus anyone who showed up
            in the Teams recording but isn't on the enrolled list at all (e.g. a guest sitting in).
          </p>
          <p>
            <b>Highlighting</b> — a row is flagged (Attendance and Attentiveness cells both) whenever a participant
            is absent, <i>or</i> present but 50% or less attentive, so a barely-engaged "Yes" stands out just like an
            outright "No". If this tracker already has its own established highlight color, that same color is
            reused; otherwise a default pink/red is applied. Each new session is colored purely on its own numbers —
            a flag from an earlier day never carries forward onto a later one.
          </p>
          <p>
            <b>Single Session</b> tab processes one Teams export against one tracker at a time — the classic flow.{" "}
            <b>Consolidate Multiple Days</b> tab lets you upload a tracker once with several Teams exports together
            (each gets its own auto-detected, editable date and session name); they're appended in chronological
            order regardless of upload order, and you get back one tracker with every day already in it — no more
            re-uploading the previous output as the next tracker.
          </p>
          <p>
            <b>Feedback Export</b> (optional, inside Consolidate Multiple Days) — consolidates a raw feedback-form
            export (one row per submission, no Date/Module/Mentor columns of its own) into the tracker's Feedback
            sheet. Pick the <b>Program</b> the feedback belongs to; each submission's date is matched against that
            program's schedule to fill in the session's Module Name and Faculty, and any date already captured in
            the Feedback sheet is skipped automatically — so re-running with an overlapping export never duplicates
            rows. A submission whose date has no matching session is reported as unmatched instead of guessed at.
          </p>
        </Section>

        <Section icon={ReceiptText} title="Mentor SOW &amp; schedule-change alerts" testid="help-sow">
          <p>
            Generating an SOW previews the mentor/program hours for a month; downloading it locks that in as the
            reference point. If the schedule for that program changes afterward (a session added, removed, or its
            hours changed) and you generate the SOW again, the tool calls out exactly what changed — before vs. after.
          </p>
          <p>
            The exported Excel columns are: <Code>Month</Code>, <Code>Trainer</Code>, <Code>Duration Hours</Code>,{" "}
            <Code>Training</Code>, <Code>Training Start date of Sow</Code>, <Code>Training End date of Sow</Code>,{" "}
            <Code>Customer</Code>, <Code>Project Code</Code>, <Code>Project Manager</Code> (always "Santosh"),{" "}
            <Code>Session Dates</Code>, <Code>Session Count</Code>, and a blank <Code>Remarks</Code> column for
            manual notes.
          </p>
          <p>
            Separately, any date/time/duration edit to a session shows up on the <b>Dashboard</b> as a reminder for
            7 days, so you don't have to remember which programs need their SOW re-checked — it clears itself
            automatically after a week so it doesn't pile up.
          </p>
          <p>
            <b>Provision</b> (admin only) — a small roster of mentors billed separately from the regular Mentor SOW;
            their sessions are automatically excluded from the regular SOW to avoid double billing. Admins manage
            the roster (name + cost/hour, editable any time) and can also add ad-hoc flat service charges (e.g. a
            monthly vendor retainer) that aren't tied to any session at all. The exported Excel adds{" "}
            <Code>Cost per hr</Code> and <Code>Total Cost</Code> columns, with flat charges shown as <Code>NA</Code> for
            hours/rate.
          </p>
        </Section>

        <Section icon={ShieldCheck} title="Roles" testid="help-roles">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><b>Admin</b> — everything, plus user management, the audit log, data backups, and the Provision sub-tab under Mentor SOW.</li>
            <li><b>Team member</b> — day-to-day use: programs, attendance, calendar, SOW.</li>
            <li><b>Viewer</b> — read-only dashboard access for external stakeholders.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
