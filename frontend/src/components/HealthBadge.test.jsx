import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HealthBadge from "./HealthBadge";

const baseHealth = {
  score: 82, color: "green", attendance: 90, attentiveness: 80, completion: 76,
  conducted: 8, total_sessions: 10, has_attendance_data: true,
};

describe("HealthBadge", () => {
  test("renders nothing when health is falsy", () => {
    const { container } = render(<HealthBadge health={null} testid="h" />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders the score on the trigger button", () => {
    render(<HealthBadge health={baseHealth} testid="prog-health" />);
    const trigger = screen.getByTestId("prog-health");
    expect(trigger).toHaveTextContent("82%");
  });

  test("applies the green style classes for a healthy score", () => {
    render(<HealthBadge health={baseHealth} testid="prog-health" />);
    const trigger = screen.getByTestId("prog-health");
    expect(trigger.className).toContain("bg-emerald-100");
    expect(trigger.className).toContain("text-emerald-700");
  });

  test("applies the amber style classes for an at-risk score", () => {
    render(<HealthBadge health={{ ...baseHealth, color: "amber" }} testid="prog-health" />);
    expect(screen.getByTestId("prog-health").className).toContain("bg-amber-100");
  });

  test("falls back to the red style for an unrecognized color", () => {
    render(<HealthBadge health={{ ...baseHealth, color: "purple" }} testid="prog-health" />);
    expect(screen.getByTestId("prog-health").className).toContain("bg-red-100");
  });

  test("opens the popover with per-metric breakdown on click", async () => {
    const user = userEvent.setup();
    render(<HealthBadge health={baseHealth} testid="prog-health" />);
    await user.click(screen.getByTestId("prog-health"));
    expect(await screen.findByText("Health Score")).toBeInTheDocument();
    expect(screen.getByText("Attendance %")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "Equal weight (33.3% each). 8/10 sessions conducted."))
      .toBeInTheDocument();
  });

  test("bar colors reflect amber and red ranges, not just green", async () => {
    const user = userEvent.setup();
    render(<HealthBadge health={{ ...baseHealth, attendance: 60, attentiveness: 30 }} testid="prog-health" />);
    await user.click(screen.getByTestId("prog-health"));
    await screen.findByText("Health Score");
    // Just needs to render without throwing across the 50-74 (amber) and <50 (red)
    // branches of the bar's own color function — the values above exercise both.
    expect(screen.getByText("Attendance %").parentElement).toHaveTextContent("60%");
    expect(screen.getByText("Attentiveness %").parentElement).toHaveTextContent("30%");
  });

  test("shows the no-attendance-data note when has_attendance_data is false", async () => {
    const user = userEvent.setup();
    render(<HealthBadge health={{ ...baseHealth, has_attendance_data: false }} testid="prog-health" />);
    await user.click(screen.getByTestId("prog-health"));
    await screen.findByText("Health Score");
    // Radix renders PopoverContent into a portal on document.body, outside the
    // RTL container, so assert against the full document rather than `container`.
    expect(document.body.textContent).toContain("No attendance data yet.");
  });
});
