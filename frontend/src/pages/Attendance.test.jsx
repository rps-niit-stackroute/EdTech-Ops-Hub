import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { toast } from "sonner";
import Attendance from "./Attendance";

jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

function xlsxFile(name = "tracker.xlsx") {
  return new File(["x"], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function csvFile(name = "teams.csv") {
  return new File(["x"], name, { type: "text/csv" });
}

function apiError(response) {
  return Object.assign(new Error("mock api error"), { response });
}

function blobResponse(info, fname = "updated.xlsx") {
  return {
    data: new Blob(["xlsx"]),
    headers: {
      "x-process-info": encodeURIComponent(JSON.stringify(info)),
      "x-output-filename": encodeURIComponent(fname),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue({ data: { programs: [] } });
  URL.createObjectURL = jest.fn(() => "blob:mock");
  URL.revokeObjectURL = jest.fn();
});

describe("Attendance — Single Session", () => {
  test("processes a session successfully", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update") {
        return Promise.resolve(blobResponse({
          enrolled: 5, present: 4, absent: 1, matched: 5, session_minutes: 90,
          absent_names: ["John"], uncertain: [], unmatched: [],
        }));
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    render(<Attendance />);

    await user.upload(screen.getByTestId("attendance-tracker-input"), xlsxFile());
    await user.upload(screen.getByTestId("attendance-teams-input"), csvFile());
    await waitFor(() => expect(screen.getByTestId("attendance-session-date")).toHaveValue("2026-05-22"));
    await user.type(screen.getByTestId("attendance-session-name"), "Security By Design");
    await user.click(screen.getByTestId("attendance-process-btn"));

    await waitFor(() => expect(screen.getByTestId("attendance-success")).toBeInTheDocument());
    expect(screen.getByTestId("attendance-absent")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Tracker updated successfully.");
  });

  test("date auto-detect failure falls back to manual entry silently", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.reject(new Error("boom"));
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<Attendance />);
    await user.upload(screen.getByTestId("attendance-teams-input"), csvFile());
    await waitFor(() => expect(screen.getByTestId("attendance-teams-input").files[0]).toBeTruthy());
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("no date detected shows an info toast", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: null } });
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<Attendance />);
    await user.upload(screen.getByTestId("attendance-teams-input"), csvFile());
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Couldn't auto-detect date — please pick it manually."));
  });

  test("submit blocked without required fields", async () => {
    const user = userEvent.setup();
    render(<Attendance />);
    expect(screen.getByTestId("attendance-process-btn")).toBeDisabled();
    await user.click(screen.getByTestId("attendance-process-btn"));
    expect(api.post).not.toHaveBeenCalled();
  });

  test("processing failure shows the error card", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update") {
        return Promise.reject(apiError({ data: { text: () => Promise.resolve(JSON.stringify({ detail: "Bad tracker format" })) } }));
      }
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<Attendance />);
    await user.upload(screen.getByTestId("attendance-tracker-input"), xlsxFile());
    await user.upload(screen.getByTestId("attendance-teams-input"), csvFile());
    await waitFor(() => expect(screen.getByTestId("attendance-session-date")).toHaveValue("2026-05-22"));
    await user.type(screen.getByTestId("attendance-session-name"), "S1");
    await user.click(screen.getByTestId("attendance-process-btn"));

    await waitFor(() => expect(screen.getByTestId("attendance-error")).toBeInTheDocument());
    expect(screen.getByText("Bad tracker format")).toBeInTheDocument();
  });

  test("shows a note when session duration was capped by the schedule", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update") {
        return Promise.resolve(blobResponse({
          enrolled: 1, present: 1, absent: 0, matched: 1, session_minutes: 60, capped_by_schedule: true,
        }));
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    render(<Attendance />);
    await user.upload(screen.getByTestId("attendance-tracker-input"), xlsxFile());
    await user.upload(screen.getByTestId("attendance-teams-input"), csvFile());
    await waitFor(() => expect(screen.getByTestId("attendance-session-date")).toHaveValue("2026-05-22"));
    await user.type(screen.getByTestId("attendance-session-name"), "S1");
    await user.click(screen.getByTestId("attendance-process-btn"));

    await waitFor(() => expect(screen.getByTestId("attendance-capped-note")).toBeInTheDocument());
  });

  test("no capped note when duration wasn't capped", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update") {
        return Promise.resolve(blobResponse({
          enrolled: 1, present: 1, absent: 0, matched: 1, session_minutes: 60, capped_by_schedule: false,
        }));
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    render(<Attendance />);
    await user.upload(screen.getByTestId("attendance-tracker-input"), xlsxFile());
    await user.upload(screen.getByTestId("attendance-teams-input"), csvFile());
    await waitFor(() => expect(screen.getByTestId("attendance-session-date")).toHaveValue("2026-05-22"));
    await user.type(screen.getByTestId("attendance-session-name"), "S1");
    await user.click(screen.getByTestId("attendance-process-btn"));

    await waitFor(() => expect(screen.getByTestId("attendance-success")).toBeInTheDocument());
    expect(screen.queryByTestId("attendance-capped-note")).not.toBeInTheDocument();
  });

  test("program select is available and sends program_id when chosen", async () => {
    api.get.mockResolvedValue({ data: { programs: [{ id: "p1", name: "IT Program" }] } });
    let capturedFormData;
    api.post.mockImplementation((url, body) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update") {
        capturedFormData = body;
        return Promise.resolve(blobResponse({ enrolled: 1, present: 1, absent: 0, matched: 1, session_minutes: 60 }));
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    render(<Attendance />);
    await user.upload(screen.getByTestId("attendance-tracker-input"), xlsxFile());
    await user.upload(screen.getByTestId("attendance-teams-input"), csvFile());
    await waitFor(() => expect(screen.getByTestId("attendance-session-date")).toHaveValue("2026-05-22"));
    await user.type(screen.getByTestId("attendance-session-name"), "S1");

    await user.click(screen.getByTestId("attendance-program-select"));
    await user.click(await screen.findByText("IT Program"));

    await user.click(screen.getByTestId("attendance-process-btn"));
    await waitFor(() => expect(screen.getByTestId("attendance-success")).toBeInTheDocument());
    expect(capturedFormData.get("program_id")).toBe("p1");
  });

  test("reset returns to the idle state after a success", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update") {
        return Promise.resolve(blobResponse({ enrolled: 1, present: 1, absent: 0, matched: 1, session_minutes: 60 }));
      }
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<Attendance />);
    await user.upload(screen.getByTestId("attendance-tracker-input"), xlsxFile());
    await user.upload(screen.getByTestId("attendance-teams-input"), csvFile());
    await waitFor(() => expect(screen.getByTestId("attendance-session-date")).toHaveValue("2026-05-22"));
    await user.type(screen.getByTestId("attendance-session-name"), "S1");
    await user.click(screen.getByTestId("attendance-process-btn"));
    await waitFor(() => expect(screen.getByTestId("attendance-success")).toBeInTheDocument());

    await user.click(screen.getByTestId("attendance-reset-btn"));
    expect(screen.getByTestId("attendance-process-btn")).toBeDisabled();
  });
});

describe("Attendance — Consolidate Multiple Days", () => {
  async function openBatchTab(user) {
    render(<Attendance />);
    await user.click(screen.getByTestId("attendance-tab-batch"));
  }

  test("adding files auto-detects each day's date", async () => {
    api.get.mockResolvedValue({ data: { programs: [] } });
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    await openBatchTab(user);

    await user.upload(screen.getByTestId("batch-teams-input"), [csvFile("d1.csv")]);
    await waitFor(() => expect(screen.getAllByTestId("batch-day-date")[0]).toHaveValue("2026-05-22"));
  });

  test("batch process succeeds and shows per-day summaries", async () => {
    api.get.mockResolvedValue({ data: { programs: [{ id: "p1", name: "Prog" }] } });
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update-batch") {
        return Promise.resolve(blobResponse({
          sessions_processed: 1,
          days: [{ session_name: "Day 1", session_date: "2026-05-22", enrolled: 3, present: 2, absent: 1 }],
        }));
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openBatchTab(user);

    await user.upload(screen.getByTestId("batch-teams-input"), [csvFile("d1.csv")]);
    await waitFor(() => expect(screen.getAllByTestId("batch-day-date")[0]).toHaveValue("2026-05-22"));
    await user.type(screen.getAllByTestId("batch-day-name")[0], "Day 1");
    await user.upload(screen.getByTestId("batch-tracker-input"), xlsxFile());
    await user.click(screen.getByTestId("batch-process-btn"));

    await waitFor(() => expect(screen.getByTestId("batch-success")).toBeInTheDocument());
    expect(screen.getByTestId("batch-day-summary")).toBeInTheDocument();
  });

  test("shows a per-day note when that day's duration was capped by the schedule", async () => {
    api.get.mockResolvedValue({ data: { programs: [{ id: "p1", name: "Prog" }] } });
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update-batch") {
        return Promise.resolve(blobResponse({
          sessions_processed: 1,
          days: [{ session_name: "Day 1", session_date: "2026-05-22", enrolled: 3, present: 2, absent: 1,
                  capped_by_schedule: true }],
        }));
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openBatchTab(user);
    await user.upload(screen.getByTestId("batch-teams-input"), [csvFile("d1.csv")]);
    await waitFor(() => expect(screen.getAllByTestId("batch-day-date")[0]).toHaveValue("2026-05-22"));
    await user.type(screen.getAllByTestId("batch-day-name")[0], "Day 1");
    await user.upload(screen.getByTestId("batch-tracker-input"), xlsxFile());
    await user.click(screen.getByTestId("batch-process-btn"));

    await waitFor(() => expect(screen.getByTestId("batch-day-capped-note")).toBeInTheDocument());
  });

  test("removing a day updates validity", async () => {
    api.get.mockResolvedValue({ data: { programs: [] } });
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    await openBatchTab(user);
    await user.upload(screen.getByTestId("batch-teams-input"), [csvFile("d1.csv")]);
    await waitFor(() => expect(screen.getByTestId("batch-day-row")).toBeInTheDocument());
    await user.click(screen.getByTestId("batch-day-remove"));
    expect(screen.queryByTestId("batch-day-row")).not.toBeInTheDocument();
  });

  test("feedback without a program selected keeps the submit button disabled", async () => {
    api.get.mockResolvedValue({ data: { programs: [{ id: "p1", name: "Prog" }] } });
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    await openBatchTab(user);
    await user.upload(screen.getByTestId("batch-teams-input"), [csvFile("d1.csv")]);
    await waitFor(() => expect(screen.getAllByTestId("batch-day-date")[0]).toHaveValue("2026-05-22"));
    await user.type(screen.getAllByTestId("batch-day-name")[0], "Day 1");
    await user.upload(screen.getByTestId("batch-tracker-input"), xlsxFile());
    await user.upload(screen.getByTestId("batch-feedback-input"), xlsxFile("feedback.xlsx"));

    // Everything else is filled in, but no program is selected for the feedback
    // to match against — the button stays disabled rather than letting submit fire.
    expect(screen.getByTestId("batch-process-btn")).toBeDisabled();
    expect(api.post).not.toHaveBeenCalledWith("/attendance/update-batch", expect.anything(), expect.anything());
  });

  test("incomplete batch keeps the submit button disabled", async () => {
    api.get.mockResolvedValue({ data: { programs: [] } });
    const user = userEvent.setup();
    await openBatchTab(user);
    expect(screen.getByTestId("batch-process-btn")).toBeDisabled();
    await user.click(screen.getByTestId("batch-process-btn"));
    expect(api.post).not.toHaveBeenCalled();
  });

  test("batch processing failure shows the error card", async () => {
    api.get.mockResolvedValue({ data: { programs: [] } });
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update-batch") {
        return Promise.reject(apiError({ data: { text: () => Promise.resolve(JSON.stringify({ detail: "Bad batch" })) } }));
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openBatchTab(user);
    await user.upload(screen.getByTestId("batch-teams-input"), [csvFile("d1.csv")]);
    await waitFor(() => expect(screen.getAllByTestId("batch-day-date")[0]).toHaveValue("2026-05-22"));
    await user.type(screen.getAllByTestId("batch-day-name")[0], "Day 1");
    await user.upload(screen.getByTestId("batch-tracker-input"), xlsxFile());
    await user.click(screen.getByTestId("batch-process-btn"));

    await waitFor(() => expect(screen.getByTestId("batch-error")).toBeInTheDocument());
  });

  test("feedback summary variants render for the batch success screen", async () => {
    api.get.mockResolvedValue({ data: { programs: [{ id: "p1", name: "Prog" }] } });
    api.post.mockImplementation((url) => {
      if (url === "/attendance/detect-date") return Promise.resolve({ data: { session_date: "2026-05-22" } });
      if (url === "/attendance/update-batch") {
        return Promise.resolve(blobResponse({
          sessions_processed: 1,
          days: [{ session_name: "Day 1", session_date: "2026-05-22", enrolled: 3, present: 2, absent: 1 }],
          feedback: { sheet_found: true, added: 2, skipped_existing_dates: 1, unmatched_rows: 1, unmatched_dates: ["2026-05-23"] },
        }));
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openBatchTab(user);
    await user.upload(screen.getByTestId("batch-teams-input"), [csvFile("d1.csv")]);
    await waitFor(() => expect(screen.getAllByTestId("batch-day-date")[0]).toHaveValue("2026-05-22"));
    await user.type(screen.getAllByTestId("batch-day-name")[0], "Day 1");
    await user.upload(screen.getByTestId("batch-tracker-input"), xlsxFile());
    await user.upload(screen.getByTestId("batch-feedback-input"), xlsxFile("feedback.xlsx"));

    const trigger = screen.getByTestId("batch-program-select");
    await user.click(trigger);
    await user.click(await screen.findByText("Prog"));

    await user.click(screen.getByTestId("batch-process-btn"));
    await waitFor(() => expect(screen.getByTestId("batch-feedback-summary")).toBeInTheDocument());
    expect(screen.getByText(/No schedule found for/)).toBeInTheDocument();
  });
});
