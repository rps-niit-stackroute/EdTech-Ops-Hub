import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import Settings from "./Settings";

jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock("@/context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

const ADMIN = { role: "admin", name: "Administrator" };
const USERS = [
  { id: "u1", name: "Administrator", username: "admin", role: "admin", created_at: "2026-01-01T00:00:00Z" },
];

function mockDefaultApi() {
  api.get.mockImplementation((url) => {
    if (url === "/users") return Promise.resolve({ data: USERS });
    if (url === "/admin/backup/last") return Promise.resolve({ data: { last_backup: null } });
    return Promise.reject(new Error("unexpected url " + url));
  });
}

describe("Settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    URL.createObjectURL = jest.fn(() => "blob:mock");
    URL.revokeObjectURL = jest.fn();
  });

  test("non-admin is redirected away", () => {
    useAuth.mockReturnValue({ user: { role: "team_member" }, loading: false });
    render(<Settings />);
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  test("renders nothing while auth is still loading", () => {
    useAuth.mockReturnValue({ user: null, loading: true });
    const { container } = render(<Settings />);
    expect(container).toBeEmptyDOMElement();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("admin sees the user list and backup section", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    mockDefaultApi();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());
    expect(screen.getByText("No backup taken yet")).toBeInTheDocument();
  });

  test("shows the last backup metadata when present", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    api.get.mockImplementation((url) => {
      if (url === "/users") return Promise.resolve({ data: USERS });
      if (url === "/admin/backup/last") {
        return Promise.resolve({
          data: { last_backup: { created_at: "2026-05-22T10:00:00Z", generated_by: "Administrator" } },
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText(/Last backup:/)).toBeInTheDocument());
  });

  test("downloading the backup triggers a file download", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    mockDefaultApi();
    api.get.mockImplementation((url, opts) => {
      if (url === "/admin/backup") {
        return Promise.resolve({
          data: new Blob(["zip"]), headers: { "content-disposition": 'attachment; filename="backup.zip"' },
        });
      }
      if (url === "/users") return Promise.resolve({ data: USERS });
      if (url === "/admin/backup/last") return Promise.resolve({ data: { last_backup: null } });
      return Promise.reject(new Error("unexpected " + url));
    });
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());

    await user.click(screen.getByTestId("download-backup-btn"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Backup downloaded"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  test("backup download failure shows an error toast", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    mockDefaultApi();
    api.get.mockImplementation((url) => {
      if (url === "/admin/backup") return Promise.reject(new Error("boom"));
      if (url === "/users") return Promise.resolve({ data: USERS });
      if (url === "/admin/backup/last") return Promise.resolve({ data: { last_backup: null } });
      return Promise.reject(new Error("unexpected"));
    });
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());
    await user.click(screen.getByTestId("download-backup-btn"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Backup failed"));
  });

  test("creating a user requires username and password", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    mockDefaultApi();
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());

    await user.click(screen.getByTestId("add-user-btn"));
    await user.click(screen.getByTestId("user-save-btn"));
    expect(toast.error).toHaveBeenCalledWith("Username and password required");
    expect(api.post).not.toHaveBeenCalled();
  });

  test("creates a user successfully and reloads the list", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    mockDefaultApi();
    api.post.mockResolvedValue({ data: { id: "u2" } });
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());

    await user.click(screen.getByTestId("add-user-btn"));
    await user.type(screen.getByTestId("user-username"), "newuser");
    await user.type(screen.getByTestId("user-password"), "secret123");
    await user.click(screen.getByTestId("user-save-btn"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("User created"));
    expect(api.post).toHaveBeenCalledWith("/users", expect.objectContaining({ username: "newuser" }));
  });

  test("create user failure shows the server's error detail", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    mockDefaultApi();
    api.post.mockRejectedValue({ response: { data: { detail: "Username already exists" } } });
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());

    await user.click(screen.getByTestId("add-user-btn"));
    await user.type(screen.getByTestId("user-username"), "dupe");
    await user.type(screen.getByTestId("user-password"), "secret123");
    await user.click(screen.getByTestId("user-save-btn"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Username already exists"));
  });

  test("deleting a user calls the API and reloads", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    mockDefaultApi();
    api.delete.mockResolvedValue({});
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());

    await user.click(screen.getByTestId("delete-user-btn"));
    await user.click(screen.getByTestId("confirm-delete-user-btn"));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/users/u1"));
    expect(toast.success).toHaveBeenCalledWith("User deleted");
  });

  test("delete failure shows the server's error detail", async () => {
    useAuth.mockReturnValue({ user: ADMIN, loading: false });
    mockDefaultApi();
    api.delete.mockRejectedValue({ response: { data: { detail: "Cannot delete the last admin" } } });
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());

    await user.click(screen.getByTestId("delete-user-btn"));
    await user.click(screen.getByTestId("confirm-delete-user-btn"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cannot delete the last admin"));
  });
});
