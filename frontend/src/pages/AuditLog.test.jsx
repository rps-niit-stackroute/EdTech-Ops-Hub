import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import AuditLog from "./AuditLog";

jest.mock("@/lib/api", () => ({ api: { get: jest.fn() }, API: "https://backend/api" }));
jest.mock("@/context/AuthContext", () => ({ useAuth: jest.fn() }));

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

const ADMIN = { role: "admin" };
const ROWS = [
  { id: "e1", timestamp: "2026-05-22T10:00:00Z", user_name: "Administrator", role: "admin",
    action: "Program created", details: "Test Program" },
];

describe("AuditLog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("non-admin is redirected away and renders nothing", () => {
    useAuth.mockReturnValue({ user: { role: "viewer" }, loading: false });
    const { container } = render(<AuditLog />);
    expect(mockNavigate).toHaveBeenCalledWith("/");
    expect(container).toBeEmptyDOMElement();
  });

  test("shows a loading state then the fetched rows", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    api.get.mockResolvedValue({ data: { rows: ROWS, users: ["Administrator"], actions: ["Program created"] } });
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByTestId("audit-row")).toBeInTheDocument());
    expect(screen.getByText("Program created")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/audit?");
  });

  test("shows the empty state when there are no matching rows", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    api.get.mockResolvedValue({ data: { rows: [], users: [], actions: [] } });
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText("No audit entries match these filters.")).toBeInTheDocument());
  });

  test("a fetch failure stops loading without throwing", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    api.get.mockRejectedValue(new Error("network down"));
    render(<AuditLog />);
    await waitFor(() => expect(screen.getByText("No audit entries match these filters.")).toBeInTheDocument());
  });

  test("date filters are sent as query params", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    api.get.mockResolvedValue({ data: { rows: [], users: [], actions: [] } });
    const user = userEvent.setup();
    render(<AuditLog />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    await user.type(screen.getByTestId("audit-filter-from"), "2026-05-01");
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("/audit?date_from=2026-05-01"));

    await user.type(screen.getByTestId("audit-filter-to"), "2026-05-31");
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith(
      "/audit?date_from=2026-05-01&date_to=2026-05-31"));
  });

  test("export button links to the CSV export endpoint", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    api.get.mockResolvedValue({ data: { rows: [], users: [], actions: [] } });
    render(<AuditLog />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const link = screen.getByTestId("audit-export-btn").closest("a");
    expect(link).toHaveAttribute("href", "https://backend/api/audit/export");
  });
});
