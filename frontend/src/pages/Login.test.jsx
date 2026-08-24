import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import Login from "./Login";

jest.mock("@/context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

function renderLogin(viewer = false) {
  return render(<MemoryRouter><Login viewer={viewer} /></MemoryRouter>);
}

describe("Login", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("successful login navigates to the dashboard", async () => {
    const login = jest.fn().mockResolvedValue({ name: "Administrator", must_change_password: false });
    useAuth.mockReturnValue({ login });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId("login-username"), "admin");
    await user.type(screen.getByTestId("login-password"), "secret123");
    await user.click(screen.getByTestId("login-submit"));

    await waitFor(() => expect(login).toHaveBeenCalledWith("admin", "secret123", false));
    expect(toast.success).toHaveBeenCalledWith("Welcome, Administrator");
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  test("must_change_password redirects there instead", async () => {
    const login = jest.fn().mockResolvedValue({ name: "New User", must_change_password: true });
    useAuth.mockReturnValue({ login });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId("login-username"), "newuser");
    await user.type(screen.getByTestId("login-password"), "secret123");
    await user.click(screen.getByTestId("login-submit"));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/change-password"));
  });

  test("failed login shows the server's error message", async () => {
    const login = jest.fn().mockRejectedValue({ response: { data: { detail: "Invalid username or password" } } });
    useAuth.mockReturnValue({ login });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId("login-username"), "admin");
    await user.type(screen.getByTestId("login-password"), "wrong");
    await user.click(screen.getByTestId("login-submit"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Invalid username or password"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("failed login without a server detail falls back to a generic message", async () => {
    const login = jest.fn().mockRejectedValue(new Error("network down"));
    useAuth.mockReturnValue({ login });
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Login failed"));
  });

  test("viewer mode passes viewer=true and shows viewer copy", async () => {
    const login = jest.fn().mockResolvedValue({ name: "Client", must_change_password: false });
    useAuth.mockReturnValue({ login });
    const user = userEvent.setup();
    renderLogin(true);

    expect(screen.getByText("Stakeholder / Viewer access")).toBeInTheDocument();
    await user.type(screen.getByTestId("login-username"), "client1");
    await user.type(screen.getByTestId("login-password"), "secret123");
    await user.click(screen.getByTestId("login-submit"));

    await waitFor(() => expect(login).toHaveBeenCalledWith("client1", "secret123", true));
  });
});
