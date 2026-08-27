import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import Dashboard from "./Dashboard";

jest.mock("@/lib/api", () => ({ api: { get: jest.fn() } }));

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

const BASE_DASHBOARD = {
  total_programs: 4, sessions_this_week: 7, active_mentors: 5, clashes_detected: 0,
  avg_health_score: 82, hours_this_month: 40, avg_attendance_pct: 91,
  sessions_trend: [{ label: "W1", sessions: 2 }], health_distribution: { green: 3, amber: 1, red: 0 },
  mentor_workload: [], programs: [],
};

function mockApi({ dashboard = BASE_DASHBOARD, changes = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url === "/dashboard") return Promise.resolve({ data: dashboard });
    if (url === "/schedule-changes/recent") return Promise.resolve({ data: { changes } });
    return Promise.reject(new Error("unexpected " + url));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("renders the KPI metrics from the dashboard endpoint", async () => {
  mockApi();
  render(<Dashboard />);
  await waitFor(() => expect(screen.getByTestId("metric-programs-value")).toHaveTextContent("4"));
  expect(screen.getByTestId("metric-sessions-value")).toHaveTextContent("7");
  expect(screen.getByTestId("metric-mentors-value")).toHaveTextContent("5");
  expect(screen.getByTestId("metric-avg-attendance-value")).toHaveTextContent("91%");
});

test("schedule-change banner is not shown when there are no recent changes", async () => {
  mockApi({ changes: [] });
  render(<Dashboard />);
  await waitFor(() => expect(screen.getByTestId("metric-programs-value")).toBeInTheDocument());
  expect(screen.queryByTestId("dashboard-schedule-changes")).not.toBeInTheDocument();
});

test("schedule-change banner appears above the KPI cards and lists each change", async () => {
  mockApi({
    changes: [
      {
        id: "c1", program_name: "Delivery Batch 1", topic: "Intro to SQL", changed_by: "Divya",
        changed_at: new Date().toISOString(), change_type: "rescheduled",
        before: { date: "2026-08-10", start_time: "10:00", end_time: "11:00", duration: null },
        after: { date: "2026-08-12", start_time: "14:00", end_time: "15:00", duration: null },
      },
    ],
  });
  render(<Dashboard />);

  const banner = await screen.findByTestId("dashboard-schedule-changes");
  expect(banner).toHaveTextContent("1 schedule change in the last 7 days");
  expect(screen.getByTestId("schedule-change-row")).toHaveTextContent("Delivery Batch 1");
  expect(screen.getByTestId("schedule-change-row")).toHaveTextContent("10 Aug");
  expect(screen.getByTestId("schedule-change-row")).toHaveTextContent("12 Aug");

  // Banner must render before the KPI metric grid, not after it (near the header).
  const metrics = screen.getByTestId("metric-programs");
  expect(banner.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("clicking 'Review SOW impact' navigates to the Mentor SOW page", async () => {
  mockApi({
    changes: [{
      id: "c1", program_name: "Prog", topic: "", changed_by: "Divya", changed_at: new Date().toISOString(),
      change_type: "rescheduled",
      before: { date: "2026-08-10", start_time: "10:00", end_time: "11:00", duration: null },
      after: { date: "2026-08-11", start_time: "10:00", end_time: "11:00", duration: null },
    }],
  });
  const user = userEvent.setup();
  render(<Dashboard />);
  await screen.findByTestId("dashboard-schedule-changes");
  await user.click(screen.getByText("Review SOW impact"));
  expect(mockNavigate).toHaveBeenCalledWith("/sow");
});

test("a removed session is described without an arrow to a new date", async () => {
  mockApi({
    changes: [{
      id: "c1", program_name: "Prog", topic: "Removed Topic", changed_by: "Divya",
      changed_at: new Date().toISOString(), change_type: "removed",
      before: { date: "2026-08-10", start_time: "10:00", end_time: "11:00", duration: null },
      after: null,
    }],
  });
  render(<Dashboard />);
  const row = await screen.findByTestId("schedule-change-row");
  expect(row).toHaveTextContent("Session removed");
  expect(row).toHaveTextContent("10 Aug");
});

test("a cancelled session gets its own banner, separate from other schedule changes", async () => {
  mockApi({
    changes: [
      {
        id: "c1", program_name: "Cancelled Program", topic: "Cancelled Topic", changed_by: "Divya",
        changed_at: new Date().toISOString(), change_type: "cancelled",
        before: { date: "2026-08-10", start_time: "10:00", end_time: "11:00", duration: null },
        after: null,
      },
      {
        id: "c2", program_name: "Rescheduled Program", topic: "Other Topic", changed_by: "Divya",
        changed_at: new Date().toISOString(), change_type: "rescheduled",
        before: { date: "2026-08-10", start_time: "10:00", end_time: "11:00", duration: null },
        after: { date: "2026-08-12", start_time: "10:00", end_time: "11:00", duration: null },
      },
    ],
  });
  render(<Dashboard />);

  const cancelBanner = await screen.findByTestId("dashboard-cancellations");
  expect(cancelBanner).toHaveTextContent("1 session cancelled in the last 7 days");
  expect(screen.getByTestId("cancellation-row")).toHaveTextContent("Cancelled Program");
  expect(screen.getByTestId("cancellation-row")).toHaveTextContent("Session cancelled");

  const otherBanner = screen.getByTestId("dashboard-schedule-changes");
  expect(otherBanner).toHaveTextContent("1 schedule change in the last 7 days");
  expect(screen.getByTestId("schedule-change-row")).toHaveTextContent("Rescheduled Program");
  // The cancellation must not also show up in the general changes list.
  expect(otherBanner).not.toHaveTextContent("Cancelled Program");
});

test("no cancellations means no cancellation banner", async () => {
  mockApi({
    changes: [{
      id: "c1", program_name: "Prog", topic: "", changed_by: "Divya", changed_at: new Date().toISOString(),
      change_type: "rescheduled",
      before: { date: "2026-08-10", start_time: "10:00", end_time: "11:00", duration: null },
      after: { date: "2026-08-11", start_time: "10:00", end_time: "11:00", duration: null },
    }],
  });
  render(<Dashboard />);
  await screen.findByTestId("dashboard-schedule-changes");
  expect(screen.queryByTestId("dashboard-cancellations")).not.toBeInTheDocument();
});

test("quick action buttons navigate to the right page", async () => {
  mockApi();
  const user = userEvent.setup();
  render(<Dashboard />);
  await waitFor(() => expect(screen.getByTestId("metric-programs-value")).toBeInTheDocument());
  await user.click(screen.getByTestId("quick-action-attendance"));
  expect(mockNavigate).toHaveBeenCalledWith("/attendance");
});
