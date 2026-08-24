import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import Programs from "./Programs";

function renderProgramsPage(initialEntries) {
  return render(
    <MemoryRouter initialEntries={initialEntries}><Programs /></MemoryRouter>
  );
}

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn() },
  PROGRAM_COLORS: [{ bg: "#fff", border: "#000", text: "#000" }],
  buildProgramColorMap: () => ({}),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

const PROGRAM = {
  id: "p1", name: "Test Program", client: "Acme", project_code: "P-001",
  team_member: "Owner1", mentors: ["Mentor A"], status: "active",
  session_count: 3, health: { score: 80, color: "green" },
};

function apiError(response) {
  return Object.assign(new Error("mock api error"), { response });
}

function mockDefaultApi(programs = [PROGRAM]) {
  api.get.mockImplementation((url) => {
    if (url === "/programs") return Promise.resolve({ data: programs });
    if (url === "/meta") return Promise.resolve({ data: { mentors: ["Mentor A"], programs: [], team_members: [] } });
    if (url === "/mentor-unavailability") return Promise.resolve({ data: [] });
    return Promise.reject(new Error("unexpected GET " + url));
  });
  api.post.mockImplementation((url) => {
    if (url === "/availability/check") return Promise.resolve({ data: { available: true, conflicts: [] } });
    return Promise.reject(new Error("unexpected POST " + url));
  });
}

async function openProgramsTab() {
  renderProgramsPage();
  await waitFor(() => expect(screen.getByText("Test Program")).toBeInTheDocument());
}

describe("Programs — deep link", () => {
  test("?tab=mentors opens the Mentors tab directly", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/programs") return Promise.resolve({ data: [PROGRAM] });
      if (url === "/meta") return Promise.resolve({ data: { mentors: [], programs: [], team_members: [] } });
      if (url === "/mentors") return Promise.resolve({ data: [] });
      if (url === "/mentor-unavailability") return Promise.resolve({ data: [] });
      return Promise.reject(new Error("unexpected " + url));
    });
    renderProgramsPage(["/programs?tab=mentors"]);
    await waitFor(() => expect(screen.getByTestId("mentors-tab")).toBeInTheDocument());
  });
});

describe("Programs — Programs tab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("lists programs with health and session count", async () => {
    mockDefaultApi();
    await openProgramsTab();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("3 sessions")).toBeInTheDocument();
  });

  test("empty state when there are no programs at all", async () => {
    mockDefaultApi([]);
    renderProgramsPage();
    await waitFor(() => expect(screen.getByText("No programs yet")).toBeInTheDocument());
  });

  test("status filter empty state", async () => {
    mockDefaultApi([{ ...PROGRAM, status: "completed" }]);
    const user = userEvent.setup();
    renderProgramsPage();
    await waitFor(() => expect(screen.getByTestId("status-tab-active")).toBeInTheDocument());
    // default filter is "active" but the only program is completed
    await waitFor(() => expect(
      screen.getByText((_, node) => node?.textContent === "No active programs")
    ).toBeInTheDocument());
    await user.click(screen.getByTestId("status-tab-completed"));
    await waitFor(() => expect(screen.getByText("Test Program")).toBeInTheDocument());
  });

  test("toggling program status calls the patch endpoint", async () => {
    mockDefaultApi();
    api.patch.mockResolvedValue({});
    const user = userEvent.setup();
    await openProgramsTab();
    await user.click(screen.getByTestId("toggle-status-btn"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/programs/p1/status", { status: "completed" }));
    expect(toast.success).toHaveBeenCalledWith("Program marked complete.");
  });

  test("status toggle failure shows an error toast", async () => {
    mockDefaultApi();
    api.patch.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    await openProgramsTab();
    await user.click(screen.getByTestId("toggle-status-btn"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not update program status."));
  });

  test("deleting a program calls the API after confirmation", async () => {
    mockDefaultApi();
    api.delete.mockResolvedValue({});
    const user = userEvent.setup();
    await openProgramsTab();
    await user.click(screen.getByTestId("delete-program-btn"));
    await user.click(await screen.findByTestId("confirm-delete-btn"));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/programs/p1"));
    expect(toast.success).toHaveBeenCalledWith("Program deleted.");
  });

  test("adding a program without a schedule file", async () => {
    mockDefaultApi();
    api.post.mockImplementation((url) => {
      if (url === "/availability/check") return Promise.resolve({ data: { available: true, conflicts: [] } });
      if (url === "/programs") return Promise.resolve({ data: { id: "p2" } });
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openProgramsTab();

    await user.click(screen.getByTestId("add-program-btn"));
    await user.type(screen.getByTestId("program-name-input"), "New Program");
    await user.type(screen.getByTestId("program-client-input"), "New Client");
    await user.type(screen.getByTestId("program-code-input"), "NP-001");
    await user.type(screen.getByTestId("program-owner-input"), "New Owner");
    await user.click(screen.getByTestId("program-save-btn"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Program created."));
    expect(api.post).toHaveBeenCalledWith("/programs", expect.objectContaining({ name: "New Program" }));
  });

  test("adding a program requires the required fields", async () => {
    mockDefaultApi();
    const user = userEvent.setup();
    await openProgramsTab();
    await user.click(screen.getByTestId("add-program-btn"));
    await user.click(screen.getByTestId("program-save-btn"));
    expect(toast.error).toHaveBeenCalledWith("Name, Client, Project Code and Owner are required.");
  });

  test("mentor tag input adds and removes tags", async () => {
    mockDefaultApi();
    const user = userEvent.setup();
    await openProgramsTab();
    await user.click(screen.getByTestId("add-program-btn"));

    const tagInput = screen.getByTestId("program-mentor-input");
    await user.type(tagInput, "Custom Mentor{enter}");
    expect(screen.getByText("Custom Mentor")).toBeInTheDocument();
  });

  test("create program failure shows the server error", async () => {
    mockDefaultApi();
    api.post.mockImplementation((url) => {
      if (url === "/availability/check") return Promise.resolve({ data: { available: true, conflicts: [] } });
      if (url === "/programs") return Promise.reject(apiError({ data: { detail: "Duplicate project code" } }));
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    await openProgramsTab();
    await user.click(screen.getByTestId("add-program-btn"));
    await user.type(screen.getByTestId("program-name-input"), "X");
    await user.type(screen.getByTestId("program-client-input"), "Y");
    await user.type(screen.getByTestId("program-code-input"), "Z");
    await user.type(screen.getByTestId("program-owner-input"), "W");
    await user.click(screen.getByTestId("program-save-btn"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Duplicate project code"));
  });

  test("editing a program opens the drawer with prefilled data and can save", async () => {
    mockDefaultApi();
    api.get.mockImplementation((url) => {
      if (url === "/programs") return Promise.resolve({ data: [PROGRAM] });
      if (url === "/meta") return Promise.resolve({ data: { mentors: ["Mentor A"], programs: [], team_members: [] } });
      if (url === "/programs/p1") return Promise.resolve({ data: { ...PROGRAM, sessions: [] } });
      return Promise.reject(new Error("unexpected " + url));
    });
    api.put.mockResolvedValue({});
    const user = userEvent.setup();
    await openProgramsTab();

    await user.click(screen.getByTestId("edit-program-btn"));
    const drawer = await screen.findByTestId("program-edit-drawer");
    await waitFor(() => expect(within(drawer).getByTestId("program-name-input")).toHaveValue("Test Program"));

    await user.click(within(drawer).getByTestId("program-save-btn"));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/programs/p1", expect.objectContaining({ name: "Test Program" })));
    expect(toast.success).toHaveBeenCalledWith("Program updated.");
  });

  test("adding a session from the edit drawer", async () => {
    mockDefaultApi();
    api.get.mockImplementation((url) => {
      if (url === "/programs") return Promise.resolve({ data: [PROGRAM] });
      if (url === "/meta") return Promise.resolve({ data: { mentors: ["Mentor A"], programs: [], team_members: [] } });
      if (url === "/programs/p1") return Promise.resolve({ data: { ...PROGRAM, sessions: [] } });
      return Promise.reject(new Error("unexpected " + url));
    });
    api.post.mockImplementation((url) => {
      if (url === "/availability/check") return Promise.resolve({ data: { available: true, conflicts: [] } });
      if (url === "/sessions") return Promise.resolve({ data: { id: "s1", date: "2026-05-22", start_time: "10:00", end_time: "12:00", topic: "New Session", mentor_name: "Mentor A" } });
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openProgramsTab();
    await user.click(screen.getByTestId("edit-program-btn"));
    const drawer = await screen.findByTestId("program-edit-drawer");
    await waitFor(() => expect(within(drawer).getByTestId("program-name-input")).toHaveValue("Test Program"));

    await user.click(within(drawer).getByTestId("add-session-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/sessions", expect.objectContaining({ program_id: "p1" })));
  });

  test("re-uploading a schedule with clean rows replaces sessions and auto-commits", async () => {
    mockDefaultApi();
    api.get.mockImplementation((url) => {
      if (url === "/programs") return Promise.resolve({ data: [PROGRAM] });
      if (url === "/meta") return Promise.resolve({ data: { mentors: ["Mentor A"], programs: [], team_members: [] } });
      if (url === "/programs/p1") return Promise.resolve({ data: { ...PROGRAM, sessions: [{ id: "s1", date: "2026-01-01", start_time: "09:00", end_time: "10:00", topic: "Old", mentor_name: "Mentor A" }] } });
      return Promise.reject(new Error("unexpected " + url));
    });
    api.post.mockImplementation((url) => {
      if (url === "/availability/check") return Promise.resolve({ data: { available: true, conflicts: [] } });
      if (url === "/programs/p1/schedule/replace") return Promise.resolve({ data: { clean: [{ date: "2026-06-01" }], conflicts: [], removed_count: 1 } });
      if (url === "/programs/p1/sessions/bulk") return Promise.resolve({ data: { inserted: 1, skipped: [] } });
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openProgramsTab();
    await user.click(screen.getByTestId("edit-program-btn"));
    const drawer = await screen.findByTestId("program-edit-drawer");
    await waitFor(() => expect(within(drawer).getByTestId("program-name-input")).toHaveValue("Test Program"));

    const file = new File(["a,b"], "new_schedule.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await user.upload(within(drawer).getByTestId("reupload-schedule-input"), file);
    await user.click(within(drawer).getByTestId("reupload-schedule-btn"));
    await user.click(await screen.findByTestId("confirm-reupload-btn"));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/programs/p1/schedule/replace", expect.any(FormData)));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/programs/p1/sessions/bulk", { sessions: [{ date: "2026-06-01" }] }));
    expect(toast.success).toHaveBeenCalledWith("Schedule replaced · 1 old session(s) removed, 1 imported.");
  });

  test("re-uploading a schedule with conflicts opens the resolver", async () => {
    mockDefaultApi();
    api.get.mockImplementation((url) => {
      if (url === "/programs") return Promise.resolve({ data: [PROGRAM] });
      if (url === "/meta") return Promise.resolve({ data: { mentors: ["Mentor A"], programs: [], team_members: [] } });
      if (url === "/programs/p1") return Promise.resolve({ data: { ...PROGRAM, sessions: [{ id: "s1", date: "2026-01-01", start_time: "09:00", end_time: "10:00", topic: "Old", mentor_name: "Mentor A" }] } });
      return Promise.reject(new Error("unexpected " + url));
    });
    api.post.mockImplementation((url) => {
      if (url === "/availability/check") return Promise.resolve({ data: { available: true, conflicts: [] } });
      if (url === "/programs/p1/schedule/replace") {
        return Promise.resolve({
          data: {
            clean: [],
            conflicts: [{
              session: { date: "2026-06-02", start_time: "10:00", end_time: "11:00", topic: "X", mentor_name: "Mentor A" },
              conflicts: [{ program_name: "Other", start: "10:00", end: "11:00" }],
            }],
            removed_count: 1,
          },
        });
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openProgramsTab();
    await user.click(screen.getByTestId("edit-program-btn"));
    const drawer = await screen.findByTestId("program-edit-drawer");
    await waitFor(() => expect(within(drawer).getByTestId("program-name-input")).toHaveValue("Test Program"));

    const file = new File(["a,b"], "new_schedule.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await user.upload(within(drawer).getByTestId("reupload-schedule-input"), file);
    await user.click(within(drawer).getByTestId("reupload-schedule-btn"));
    await user.click(await screen.findByTestId("confirm-reupload-btn"));

    await waitFor(() => expect(screen.getByTestId("schedule-resolver")).toBeInTheDocument());
    expect(screen.getByTestId("conflict-row")).toBeInTheDocument();
  });

  test("schedule upload with clean rows auto-commits", async () => {
    mockDefaultApi();
    api.post.mockImplementation((url) => {
      if (url === "/availability/check") return Promise.resolve({ data: { available: true, conflicts: [] } });
      if (url === "/programs") return Promise.resolve({ data: { id: "p2" } });
      if (url === "/programs/p2/schedule") return Promise.resolve({ data: { clean: [{ date: "2026-05-22" }], conflicts: [] } });
      if (url === "/programs/p2/sessions/bulk") return Promise.resolve({ data: { inserted: 1, skipped: [] } });
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openProgramsTab();

    await user.click(screen.getByTestId("add-program-btn"));
    await user.type(screen.getByTestId("program-name-input"), "Sched Program");
    await user.type(screen.getByTestId("program-client-input"), "C");
    await user.type(screen.getByTestId("program-code-input"), "SC-1");
    await user.type(screen.getByTestId("program-owner-input"), "O");
    const file = new File(["a,b"], "schedule.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await user.upload(screen.getByTestId("program-schedule-input"), file);
    await user.click(screen.getByTestId("program-save-btn"));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/programs/p2/sessions/bulk", { sessions: [{ date: "2026-05-22" }] }));
    expect(toast.success).toHaveBeenCalledWith("Program created · 1 sessions imported.");
  });

  test("schedule upload with conflicts opens the resolver", async () => {
    mockDefaultApi();
    api.post.mockImplementation((url) => {
      if (url === "/availability/check") return Promise.resolve({ data: { available: true, conflicts: [] } });
      if (url === "/programs") return Promise.resolve({ data: { id: "p3" } });
      if (url === "/programs/p3/schedule") {
        return Promise.resolve({
          data: {
            clean: [],
            conflicts: [{
              session: { date: "2026-05-22", start_time: "10:00", end_time: "11:00", topic: "X", mentor_name: "Mentor A" },
              conflicts: [{ program_name: "Other", start: "10:00", end: "11:00" }],
            }],
          },
        });
      }
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    await openProgramsTab();

    await user.click(screen.getByTestId("add-program-btn"));
    await user.type(screen.getByTestId("program-name-input"), "Conflict Program");
    await user.type(screen.getByTestId("program-client-input"), "C");
    await user.type(screen.getByTestId("program-code-input"), "CP-1");
    await user.type(screen.getByTestId("program-owner-input"), "O");
    const file = new File(["a,b"], "schedule.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await user.upload(screen.getByTestId("program-schedule-input"), file);
    await user.click(screen.getByTestId("program-save-btn"));

    await waitFor(() => expect(screen.getByTestId("schedule-resolver")).toBeInTheDocument());
    expect(screen.getByTestId("conflict-row")).toBeInTheDocument();
  });
});

describe("Programs — Mentors tab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const DIRECTORY_MENTOR = {
    id: "m1", name: "Directory Mentor", email: "d@x.com", phone: "123",
    status: "active", sessions_count: 5, programs: ["Test Program"],
  };
  const SCHEDULE_ONLY_MENTOR = {
    id: null, name: "Schedule Only", email: "", phone: "",
    status: "active", sessions_count: 2, programs: [],
  };

  async function openMentorsTab(mentors = [DIRECTORY_MENTOR]) {
    mockDefaultApi();
    api.get.mockImplementation((url) => {
      if (url === "/programs") return Promise.resolve({ data: [PROGRAM] });
      if (url === "/meta") return Promise.resolve({ data: { mentors: [], programs: [], team_members: [] } });
      if (url === "/mentors") return Promise.resolve({ data: mentors });
      if (url === "/mentor-unavailability") return Promise.resolve({ data: [] });
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    renderProgramsPage();
    await user.click(screen.getByTestId("programs-tab-mentors"));
    await waitFor(() => expect(screen.getByText(mentors[0].name)).toBeInTheDocument());
    return user;
  }

  test("lists directory mentors", async () => {
    await openMentorsTab();
    expect(screen.getByText("Directory Mentor")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  test("Manage link opens the unavailability dialog for that mentor", async () => {
    const user = await openMentorsTab();
    await user.click(screen.getByTestId("manage-unavailability-btn"));
    const dialog = await screen.findByTestId("unavailability-dialog");
    expect(dialog).toHaveTextContent("Directory Mentor");
  });

  test("marking a mentor unavailable posts the period and refreshes the list", async () => {
    const user = await openMentorsTab();
    api.post.mockImplementation((url) => {
      if (url === "/mentor-unavailability") return Promise.resolve({ data: {} });
      return Promise.reject(new Error("unexpected " + url));
    });
    await user.click(screen.getByTestId("manage-unavailability-btn"));
    await screen.findByTestId("unavailability-dialog");
    await user.type(screen.getByTestId("unavailability-start-input"), "2026-09-01");
    await user.type(screen.getByTestId("unavailability-end-input"), "2026-09-05");
    await user.click(screen.getByTestId("unavailability-save-btn"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/mentor-unavailability", expect.objectContaining({
      mentor_name: "Directory Mentor", start_date: "2026-09-01", end_date: "2026-09-05",
    })));
  });

  test("empty state when there are no mentors", async () => {
    mockDefaultApi();
    api.get.mockImplementation((url) => {
      if (url === "/programs") return Promise.resolve({ data: [] });
      if (url === "/meta") return Promise.resolve({ data: { mentors: [], programs: [], team_members: [] } });
      if (url === "/mentors") return Promise.resolve({ data: [] });
      if (url === "/mentor-unavailability") return Promise.resolve({ data: [] });
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    renderProgramsPage();
    await user.click(screen.getByTestId("programs-tab-mentors"));
    await waitFor(() => expect(screen.getByText("No mentors yet")).toBeInTheDocument());
  });

  test("search filters the mentor list", async () => {
    const user = await openMentorsTab([DIRECTORY_MENTOR, { ...SCHEDULE_ONLY_MENTOR, name: "Zzz Other" }]);
    await user.type(screen.getByTestId("mentor-search"), "Directory");
    await waitFor(() => expect(screen.queryByText("Zzz Other")).not.toBeInTheDocument());
    expect(screen.getByText("Directory Mentor")).toBeInTheDocument();
  });

  test("search with no matches shows a message", async () => {
    const user = await openMentorsTab();
    await user.type(screen.getByTestId("mentor-search"), "nonexistent");
    await waitFor(() => expect(screen.getByText("No mentors match your search")).toBeInTheDocument());
  });

  test("formalize a schedule-only mentor prefills the add dialog", async () => {
    const user = await openMentorsTab([SCHEDULE_ONLY_MENTOR]);
    await user.click(screen.getByTestId("formalize-mentor-btn"));
    await waitFor(() => expect(screen.getByTestId("mentor-name-input")).toHaveValue("Schedule Only"));
  });

  test("add a new mentor", async () => {
    const user = await openMentorsTab();
    api.post.mockImplementation((url) => {
      if (url === "/mentors") return Promise.resolve({ data: { id: "m2" } });
      return Promise.reject(new Error("unexpected " + url));
    });
    await user.click(screen.getByTestId("add-mentor-btn"));
    await user.type(screen.getByTestId("mentor-name-input"), "Fresh Mentor");
    await user.click(screen.getByTestId("mentor-save-btn"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mentor added."));
  });

  test("add mentor requires a name", async () => {
    const user = await openMentorsTab();
    await user.click(screen.getByTestId("add-mentor-btn"));
    await user.click(screen.getByTestId("mentor-save-btn"));
    expect(toast.error).toHaveBeenCalledWith("Name is required");
  });

  test("edit an existing mentor", async () => {
    const user = await openMentorsTab();
    api.put.mockResolvedValue({});
    await user.click(screen.getByTestId("edit-mentor-btn"));
    await waitFor(() => expect(screen.getByTestId("mentor-name-input")).toHaveValue("Directory Mentor"));
    await user.clear(screen.getByTestId("mentor-notes-input"));
    await user.type(screen.getByTestId("mentor-notes-input"), "Updated notes");
    await user.click(screen.getByTestId("mentor-save-btn"));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/mentors/m1", expect.objectContaining({ notes: "Updated notes" })));
    expect(toast.success).toHaveBeenCalledWith("Mentor updated.");
  });

  test("toggle mentor active status", async () => {
    const user = await openMentorsTab();
    api.put.mockResolvedValue({});
    await user.click(screen.getByTestId("mentor-status-toggle"));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/mentors/m1", { status: "inactive" }));
  });

  test("remove a mentor from the directory", async () => {
    const user = await openMentorsTab();
    api.delete.mockResolvedValue({});
    await user.click(screen.getByTestId("delete-mentor-btn"));
    await user.click(await screen.findByTestId("confirm-delete-mentor-btn"));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/mentors/m1"));
    expect(toast.success).toHaveBeenCalledWith("Mentor removed from directory.");
  });
});
