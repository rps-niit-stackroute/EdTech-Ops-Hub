import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { AuthProvider, useAuth } from "./AuthContext";

jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

function Probe() {
  const { user, loading, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.username : "none"}</span>
      <button onClick={() => login("admin", "secret")}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("loads the current session on mount", async () => {
    api.get.mockResolvedValueOnce({ data: { username: "admin", role: "admin" } });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("admin");
    expect(api.get).toHaveBeenCalledWith("/auth/me");
  });

  test("a failed session check clears the user and stops loading", async () => {
    api.get.mockRejectedValueOnce(new Error("network down"));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  test("a null session response leaves the user unset", async () => {
    api.get.mockResolvedValueOnce({ data: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  test("login posts credentials and stores the returned user", async () => {
    api.get.mockResolvedValueOnce({ data: null });
    api.post.mockResolvedValueOnce({ data: { username: "admin", role: "admin" } });
    const user = userEvent.setup();
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await user.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));
    expect(api.post).toHaveBeenCalledWith("/auth/login", { username: "admin", password: "secret" });
  });

  test("logout clears the user", async () => {
    api.get.mockResolvedValueOnce({ data: { username: "admin", role: "admin" } });
    api.post.mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("admin"));

    await user.click(screen.getByText("logout"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(api.post).toHaveBeenCalledWith("/auth/logout");
  });

  test("useAuth outside a provider returns null", () => {
    function Standalone() {
      const ctx = useAuth();
      return <span data-testid="ctx">{ctx === null ? "null" : "not-null"}</span>;
    }
    render(<Standalone />);
    expect(screen.getByTestId("ctx")).toHaveTextContent("null");
  });
});
