import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import Sow from "./SOW";

jest.mock("@/lib/api", () => ({ api: { get: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));
jest.mock("@/context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("@/components/ProvisionPanel", () => () => <div data-testid="provision-panel-stub" />);

const META = { mentors: ["Mentor A"], programs: [{ id: "p1", name: "Prog" }] };
const SOW_DATA = {
  grouped: [{
    mentor: "Mentor A",
    rows: [{ month: "May", mentor: "Mentor A", total_hours: 5, program_name: "Prog",
             start_date: "1 May 2026", end_date: "5 May 2026", client: "Acme",
             project_code: "P-1", project_manager: "Santosh", dates: "1 May, 5 May",
             sessions_conducted: 2 }],
    subtotal_sessions: 2, subtotal_hours: 5,
  }],
  grand_total: { sessions: 2, hours: 5 },
  month_label: "May 2026",
  changes: [],
};

function mockApi({ sow = SOW_DATA, history = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url === "/meta") return Promise.resolve({ data: META });
    if (url.startsWith("/sow?")) return Promise.resolve({ data: sow });
    if (url === "/sow/history") return Promise.resolve({ data: { history } });
    return Promise.reject(new Error("unexpected " + url));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { role: "team_member" } });
  URL.createObjectURL = jest.fn(() => "blob:mock");
  URL.revokeObjectURL = jest.fn();
});

describe("SOW — Mentor SOW tab", () => {
  test("generating a SOW shows the preview table", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-generate-btn"));
    await waitFor(() => expect(screen.getByTestId("sow-preview")).toBeInTheDocument());
    expect(screen.getByTestId("sow-row")).toBeInTheDocument();
    expect(screen.getByTestId("sow-subtotal")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("SOW generated.");
  });

  test("zero sessions shows an info toast and empty preview", async () => {
    mockApi({ sow: { ...SOW_DATA, grouped: [], grand_total: { sessions: 0, hours: 0 } } });
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-generate-btn"));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("No sessions match these filters."));
    expect(screen.getByText("No matching sessions for this period.")).toBeInTheDocument();
  });

  test("schedule changes show a warning and the change list", async () => {
    mockApi({
      sow: {
        ...SOW_DATA,
        changes: [{
          program_id: "p1", program_name: "Prog", project_code: "P-1", mentor: "Mentor A",
          prev_sessions: 1, prev_hours: 2.5, new_sessions: 2, new_hours: 5,
          prev_dates: "1 May", new_dates: "1 May, 5 May", last_generated_at: "2026-05-01T00:00:00Z",
          removed: false,
        }],
      },
    });
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-generate-btn"));
    await waitFor(() => expect(screen.getByTestId("sow-changes-alert")).toBeInTheDocument());
    expect(toast.warning).toHaveBeenCalledWith("1 program(s) have schedule changes since the last SOW — see below.");
    expect(screen.getByTestId("sow-change-row")).toBeInTheDocument();
  });

  test("a removed schedule change shows the removed-specific message", async () => {
    mockApi({
      sow: {
        ...SOW_DATA,
        changes: [{
          program_id: "p1", program_name: "Prog", project_code: "P-1", mentor: "Mentor A",
          prev_sessions: 2, prev_hours: 5, new_sessions: 0, new_hours: 0,
          prev_dates: "1 May, 5 May", new_dates: "", last_generated_at: "2026-05-01T00:00:00Z",
          removed: true,
        }],
      },
    });
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-generate-btn"));
    await waitFor(() => expect(screen.getByText(/schedule may have been cleared or moved/)).toBeInTheDocument());
  });

  test("generate failure shows an error toast", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/meta") return Promise.resolve({ data: META });
      if (url.startsWith("/sow?")) return Promise.reject(new Error("boom"));
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-generate-btn"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to generate SOW."));
  });

  test("downloading the SOW triggers a file download", async () => {
    mockApi();
    api.get.mockImplementation((url) => {
      if (url === "/meta") return Promise.resolve({ data: META });
      if (url.startsWith("/sow?")) return Promise.resolve({ data: SOW_DATA });
      if (url.startsWith("/sow/download")) return Promise.resolve({ data: new Blob(["xlsx"]) });
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-generate-btn"));
    await waitFor(() => expect(screen.getByTestId("sow-download-btn")).toBeInTheDocument());
    await user.click(screen.getByTestId("sow-download-btn"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Excel downloaded."));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  test("download failure shows an error toast", async () => {
    mockApi();
    api.get.mockImplementation((url) => {
      if (url === "/meta") return Promise.resolve({ data: META });
      if (url.startsWith("/sow?")) return Promise.resolve({ data: SOW_DATA });
      if (url.startsWith("/sow/download")) return Promise.reject(new Error("boom"));
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-generate-btn"));
    await waitFor(() => expect(screen.getByTestId("sow-download-btn")).toBeInTheDocument());
    await user.click(screen.getByTestId("sow-download-btn"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Download failed."));
  });

  test("mentor/program multiselect filters are sent as query params", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-mentors"));
    await user.click(await screen.findByText("Mentor A"));
    await user.click(screen.getByTestId("sow-generate-btn"));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining("mentors=Mentor+A")));
  });
});

describe("SOW — SOW History tab", () => {
  async function openHistoryTab(history = []) {
    mockApi({ history });
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-tab-history"));
    return user;
  }

  test("empty state when nothing has been downloaded", async () => {
    await openHistoryTab([]);
    await waitFor(() => expect(screen.getByText("No SOWs downloaded yet")).toBeInTheDocument());
  });

  test("lists history rows and re-downloads", async () => {
    const HIST = [{
      id: "h1", month: "5", month_label: "May 2026", downloaded_by: "Administrator",
      downloaded_at: "2026-05-22T10:00:00Z", mentors: "", programs: "",
      total_sessions: 10, total_hours: 20, filename: "SOW_May_2026.xlsx",
    }];
    api.get.mockImplementation((url) => {
      if (url === "/meta") return Promise.resolve({ data: META });
      if (url === "/sow/history") return Promise.resolve({ data: { history: HIST } });
      if (url.startsWith("/sow/download")) return Promise.resolve({ data: new Blob(["xlsx"]) });
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-tab-history"));
    await waitFor(() => expect(screen.getByTestId("sow-history-row")).toBeInTheDocument());

    await user.click(screen.getByTestId("sow-history-download-btn"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Excel downloaded."));
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining("/sow/download?month=5&year=undefined"), expect.anything()
    );
  });

  test("re-download failure shows an error toast", async () => {
    const HIST = [{
      id: "h1", month: "5", month_label: "May 2026", downloaded_by: "Administrator",
      downloaded_at: "2026-05-22T10:00:00Z", mentors: "Mentor A", programs: "p1",
      total_sessions: 10, total_hours: 20, filename: "SOW_May_2026.xlsx",
    }];
    api.get.mockImplementation((url) => {
      if (url === "/meta") return Promise.resolve({ data: META });
      if (url === "/sow/history") return Promise.resolve({ data: { history: HIST } });
      if (url.startsWith("/sow/download")) return Promise.reject(new Error("boom"));
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    render(<Sow />);
    await user.click(screen.getByTestId("sow-tab-history"));
    await waitFor(() => expect(screen.getByTestId("sow-history-row")).toBeInTheDocument());
    await user.click(screen.getByTestId("sow-history-download-btn"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Download failed."));
  });
});

describe("SOW — admin-only Provision tab", () => {
  test("non-admin does not see the Provision tab", async () => {
    useAuth.mockReturnValue({ user: { role: "team_member" } });
    mockApi();
    render(<Sow />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/meta"));
    expect(screen.queryByTestId("sow-tab-provision")).not.toBeInTheDocument();
  });

  test("admin sees and can open the Provision tab", async () => {
    useAuth.mockReturnValue({ user: { role: "admin" } });
    mockApi();
    const user = userEvent.setup();
    render(<Sow />);
    await waitFor(() => expect(screen.getByTestId("sow-tab-provision")).toBeInTheDocument());
    await user.click(screen.getByTestId("sow-tab-provision"));
    expect(screen.getByTestId("provision-panel-stub")).toBeInTheDocument();
  });
});
