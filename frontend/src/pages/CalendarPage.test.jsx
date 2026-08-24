import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import dayjs from "dayjs";
import { api } from "@/lib/api";
import CalendarPage from "./CalendarPage";

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
  PROGRAM_COLORS: [{ bg: "#fff", border: "#000", text: "#000" }],
  buildProgramColorMap: (programs) => Object.fromEntries(
    programs.map((p) => [p.id, { bg: "#eee", border: "#111", text: "#222" }])
  ),
}));

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

function renderCalendarPage() {
  return render(<MemoryRouter><CalendarPage /></MemoryRouter>);
}

const TODAY = dayjs().format("YYYY-MM-DD");
const SESSION = {
  id: "s1", program_id: "p1", date: TODAY, start_time: "10:00", end_time: "11:00",
  topic: "Intro", mentor_name: "Mentor A", program_name: "Prog", client: "Acme",
  project_code: "P-1", team_member: "Owner", has_clash: false,
};

function mockDefaultApi({ sessions = [SESSION], clashes = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url.startsWith("/calendar")) return Promise.resolve({ data: { sessions, clashes } });
    if (url === "/meta") {
      return Promise.resolve({
        data: { mentors: ["Mentor A"], team_members: ["Owner"], programs: [{ id: "p1", name: "Prog" }] },
      });
    }
    if (url === "/mentor-unavailability") return Promise.resolve({ data: [] });
    return Promise.reject(new Error("unexpected " + url));
  });
}

describe("CalendarPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("mentor unavailability banner opens a panel with a link to manage it", async () => {
    api.get.mockImplementation((url) => {
      if (url.startsWith("/calendar")) return Promise.resolve({ data: { sessions: [SESSION], clashes: [] } });
      if (url === "/meta") {
        return Promise.resolve({
          data: { mentors: ["Mentor A"], team_members: ["Owner"], programs: [{ id: "p1", name: "Prog" }] },
        });
      }
      if (url === "/mentor-unavailability") {
        return Promise.resolve({
          data: [{ id: "u1", mentor_name: "Mentor A", start_date: TODAY, end_date: TODAY, reason: "Leave" }],
        });
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    renderCalendarPage();

    const banner = await screen.findByTestId("unavailability-banner");
    await user.click(banner);
    await waitFor(() => expect(screen.getByTestId("unavailability-panel")).toBeInTheDocument());
    expect(screen.getByTestId("unavailability-item")).toHaveTextContent("Mentor A");

    await user.click(screen.getByTestId("go-manage-unavailability-btn"));
    expect(mockNavigate).toHaveBeenCalledWith("/programs?tab=mentors");
  });

  test("renders the month grid with a session block", async () => {
    mockDefaultApi();
    renderCalendarPage();
    await waitFor(() => expect(screen.getByTestId("cal-session-block")).toBeInTheDocument());
    expect(screen.getByTestId("calendar-legend")).toBeInTheDocument();
  });

  test("switching to week view shows the agenda", async () => {
    mockDefaultApi();
    const user = userEvent.setup();
    renderCalendarPage();
    await waitFor(() => expect(screen.getByTestId("cal-session-block")).toBeInTheDocument());
    await user.click(screen.getByTestId("view-toggle-week"));
    await waitFor(() => expect(screen.getByTestId("week-agenda")).toBeInTheDocument());
    expect(screen.getByTestId("week-session-row")).toBeInTheDocument();
  });

  test("clash banner appears and opens the clash panel", async () => {
    mockDefaultApi({
      clashes: [{ mentor: "Mentor A", date: TODAY, program_a: "Prog", program_b: "Prog2",
                 time_a: "10:00-11:00", time_b: "10:30-11:30", session_a: "s1", session_b: "s2" }],
    });
    const user = userEvent.setup();
    renderCalendarPage();
    await waitFor(() => expect(screen.getByTestId("clash-banner")).toBeInTheDocument());
    await user.click(screen.getByTestId("clash-banner"));
    await waitFor(() => expect(screen.getByTestId("clash-item")).toBeInTheDocument());
  });

  test("no clashes means no banner", async () => {
    mockDefaultApi();
    renderCalendarPage();
    await waitFor(() => expect(screen.getByTestId("cal-session-block")).toBeInTheDocument());
    expect(screen.queryByTestId("clash-banner")).not.toBeInTheDocument();
  });

  test("clicking a session block opens the detail panel", async () => {
    mockDefaultApi();
    const user = userEvent.setup();
    renderCalendarPage();
    await waitFor(() => expect(screen.getByTestId("cal-session-block")).toBeInTheDocument());
    await user.click(screen.getByTestId("cal-session-block"));
    await waitFor(() => expect(screen.getByTestId("session-detail-panel")).toBeInTheDocument());
    expect(screen.getByText("Intro")).toBeInTheDocument();
  });

  test("navigation buttons change the displayed month", async () => {
    mockDefaultApi();
    const user = userEvent.setup();
    renderCalendarPage();
    await waitFor(() => expect(screen.getByTestId("cal-session-block")).toBeInTheDocument());
    const initialLabel = screen.getByTestId("cal-month-label").textContent;
    await user.click(screen.getByTestId("cal-next-btn"));
    await waitFor(() => expect(screen.getByTestId("cal-month-label").textContent).not.toBe(initialLabel));
    await user.click(screen.getByTestId("cal-prev-btn"));
    await waitFor(() => expect(screen.getByTestId("cal-month-label").textContent).toBe(initialLabel));
    await user.click(screen.getByTestId("cal-today-btn"));
    await waitFor(() => expect(screen.getByTestId("cal-month-label").textContent).toBe(initialLabel));
  });

  test("filtering by mentor hides non-matching sessions", async () => {
    mockDefaultApi({
      sessions: [SESSION, { ...SESSION, id: "s2", mentor_name: "Mentor B", topic: "Other" }],
    });
    const user = userEvent.setup();
    renderCalendarPage();
    await waitFor(() => expect(screen.getAllByTestId("cal-session-block")).toHaveLength(2));

    await user.click(screen.getByTestId("filter-mentor"));
    await user.click(await screen.findByText("Mentor A"));
    await waitFor(() => expect(screen.getAllByTestId("cal-session-block")).toHaveLength(1));
  });

  test("no sessions means no legend", async () => {
    mockDefaultApi({ sessions: [] });
    renderCalendarPage();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId("calendar-legend")).not.toBeInTheDocument();
  });
});
