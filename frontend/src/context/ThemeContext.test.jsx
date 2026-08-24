import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "./ThemeContext";

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

describe("ThemeContext", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
  });

  test("defaults to light when nothing is stored and OS preference is light", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme-value")).toHaveTextContent("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("reads a previously stored theme from localStorage", () => {
    localStorage.setItem("theme", "dark");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme-value")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("toggleTheme flips light <-> dark and persists to localStorage", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme-value")).toHaveTextContent("light");

    await user.click(screen.getByText("toggle"));
    expect(screen.getByTestId("theme-value")).toHaveTextContent("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await user.click(screen.getByText("toggle"));
    expect(screen.getByTestId("theme-value")).toHaveTextContent("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("useTheme outside a provider returns null (no crash)", () => {
    function Standalone() {
      const ctx = useTheme();
      return <span data-testid="ctx">{ctx === null ? "null" : "not-null"}</span>;
    }
    render(<Standalone />);
    expect(screen.getByTestId("ctx")).toHaveTextContent("null");
  });
});
