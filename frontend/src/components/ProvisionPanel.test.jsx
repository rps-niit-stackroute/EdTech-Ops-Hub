import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { toast } from "sonner";
import ProvisionPanel from "./ProvisionPanel";

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const MENTORS = [{ id: "m1", name: "Ashutosh", cost_per_hour: 1000 }];

describe("ProvisionPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockImplementation((url) => {
      if (url === "/provision/mentors") return Promise.resolve({ data: MENTORS });
      return Promise.reject(new Error("unexpected " + url));
    });
  });

  test("loads and lists provision mentors", async () => {
    render(<ProvisionPanel />);
    await waitFor(() => expect(screen.getByText("Ashutosh")).toBeInTheDocument());
    expect(screen.getByText((_, node) => node?.textContent === "₹1000")).toBeInTheDocument();
  });

  test("generate report with no entries shows an info toast", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/provision/mentors") return Promise.resolve({ data: MENTORS });
      if (url.startsWith("/provision?")) {
        return Promise.resolve({ data: { rows: [], charges: [], month_label: "May 2026", grand_total: { hours: 0, cost: 0 } } });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<ProvisionPanel />);
    await waitFor(() => expect(screen.getByText("Ashutosh")).toBeInTheDocument());
    await user.click(screen.getByTestId("provision-generate-btn"));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("No provision entries for this period."));
  });

  test("generate report with entries renders the preview table", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/provision/mentors") return Promise.resolve({ data: MENTORS });
      if (url.startsWith("/provision?")) {
        return Promise.resolve({
          data: {
            rows: [{ mentor: "Ashutosh", total_hours: 4, cost_per_hour: 1000, total_cost: 4000,
                     program_name: "Prog", client: "Acme", dates: "1 May", sessions_conducted: 2 }],
            charges: [], month_label: "May 2026", grand_total: { hours: 4, cost: 4000 },
          },
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<ProvisionPanel />);
    await waitFor(() => expect(screen.getByText("Ashutosh")).toBeInTheDocument());
    await user.click(screen.getByTestId("provision-generate-btn"));
    await waitFor(() => expect(screen.getByTestId("provision-preview")).toBeInTheDocument());
    expect(screen.getAllByText("Ashutosh").length).toBeGreaterThan(0);
    expect(screen.getByTestId("provision-grand-total")).toHaveTextContent("4000");
  });

  test("generate report failure shows an error toast", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/provision/mentors") return Promise.resolve({ data: MENTORS });
      if (url.startsWith("/provision?")) return Promise.reject(new Error("boom"));
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<ProvisionPanel />);
    await waitFor(() => expect(screen.getByText("Ashutosh")).toBeInTheDocument());
    await user.click(screen.getByTestId("provision-generate-btn"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to generate Provision report."));
  });

  test("add a provision mentor", async () => {
    api.post.mockResolvedValue({ data: { id: "m2" } });
    const user = userEvent.setup();
    render(<ProvisionPanel />);
    await waitFor(() => expect(screen.getByText("Ashutosh")).toBeInTheDocument());

    await user.click(screen.getByTestId("add-provision-mentor-btn"));
    await user.type(screen.getByTestId("provision-mentor-name"), "New Mentor");
    await user.type(screen.getByTestId("provision-mentor-rate"), "500");
    await user.click(screen.getByTestId("provision-mentor-save-btn"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mentor added"));
    expect(api.post).toHaveBeenCalledWith("/provision/mentors", { name: "New Mentor", cost_per_hour: 500 });
  });

  test("add mentor requires a name", async () => {
    const user = userEvent.setup();
    render(<ProvisionPanel />);
    await waitFor(() => expect(screen.getByText("Ashutosh")).toBeInTheDocument());
    await user.click(screen.getByTestId("add-provision-mentor-btn"));
    await user.click(screen.getByTestId("provision-mentor-save-btn"));
    expect(toast.error).toHaveBeenCalledWith("Mentor name is required");
    expect(api.post).not.toHaveBeenCalled();
  });

  test("delete a provision mentor", async () => {
    api.delete.mockResolvedValue({});
    const user = userEvent.setup();
    render(<ProvisionPanel />);
    await waitFor(() => expect(screen.getByText("Ashutosh")).toBeInTheDocument());

    await user.click(screen.getByTestId("delete-provision-mentor-btn"));
    const confirmBtn = await screen.findByRole("button", { name: "Remove" });
    await user.click(confirmBtn);

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/provision/mentors/m1"));
    expect(toast.success).toHaveBeenCalledWith("Mentor removed");
  });

  test("add a service charge", async () => {
    api.post.mockResolvedValue({ data: { id: "c1" } });
    api.get.mockImplementation((url) => {
      if (url === "/provision/mentors") return Promise.resolve({ data: MENTORS });
      if (url.startsWith("/provision?")) {
        return Promise.resolve({ data: { rows: [], charges: [], month_label: "May 2026", grand_total: { hours: 0, cost: 0 } } });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<ProvisionPanel />);
    await waitFor(() => expect(screen.getByText("Ashutosh")).toBeInTheDocument());

    await user.click(screen.getByTestId("add-charge-btn"));
    await user.type(screen.getByTestId("charge-trainer"), "Vendor X");
    await user.type(screen.getByTestId("charge-total-cost"), "5000");
    await user.click(screen.getByTestId("charge-save-btn"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Service charge added"));
    expect(api.post).toHaveBeenCalledWith("/provision/charges", expect.objectContaining({ trainer: "Vendor X" }));
  });

  test("add charge requires trainer and total cost", async () => {
    const user = userEvent.setup();
    render(<ProvisionPanel />);
    await waitFor(() => expect(screen.getByText("Ashutosh")).toBeInTheDocument());
    await user.click(screen.getByTestId("add-charge-btn"));
    await user.click(screen.getByTestId("charge-save-btn"));
    expect(toast.error).toHaveBeenCalledWith("Trainer/vendor and total cost are required");
  });
});
