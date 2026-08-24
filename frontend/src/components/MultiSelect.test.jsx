import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MultiSelect from "./MultiSelect";

describe("MultiSelect", () => {
  test("shows the placeholder when nothing is selected", () => {
    render(<MultiSelect options={["A", "B"]} selected={[]} onChange={jest.fn()}
      placeholder="All mentors" testid="ms" />);
    expect(screen.getByTestId("ms")).toHaveTextContent("All mentors");
  });

  test("shows the single selected value directly", () => {
    render(<MultiSelect options={["A", "B"]} selected={["A"]} onChange={jest.fn()} testid="ms" />);
    expect(screen.getByTestId("ms")).toHaveTextContent("A");
  });

  test("shows a count once more than one is selected", () => {
    render(<MultiSelect options={["A", "B", "C"]} selected={["A", "B"]} onChange={jest.fn()} testid="ms" />);
    expect(screen.getByTestId("ms")).toHaveTextContent("2 selected");
  });

  test("opening shows every option", async () => {
    const user = userEvent.setup();
    render(<MultiSelect options={["A", "B"]} selected={[]} onChange={jest.fn()} testid="ms" />);
    await user.click(screen.getByTestId("ms"));
    const opts = await screen.findAllByTestId("ms-option");
    expect(opts).toHaveLength(2);
  });

  test("clicking an unselected option adds it via onChange", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<MultiSelect options={["A", "B"]} selected={["A"]} onChange={onChange} testid="ms" />);
    await user.click(screen.getByTestId("ms"));
    const opts = await screen.findAllByTestId("ms-option");
    await user.click(opts[1]); // "B"
    expect(onChange).toHaveBeenCalledWith(["A", "B"]);
  });

  test("clicking a selected option removes it via onChange", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<MultiSelect options={["A", "B"]} selected={["A", "B"]} onChange={onChange} testid="ms" />);
    await user.click(screen.getByTestId("ms"));
    const opts = await screen.findAllByTestId("ms-option");
    await user.click(opts[0]); // "A"
    expect(onChange).toHaveBeenCalledWith(["B"]);
  });

  test("supports {value,label} option objects", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect
        options={[{ value: "p1", label: "Program One" }]}
        selected={[]}
        onChange={jest.fn()}
        testid="ms"
      />
    );
    await user.click(screen.getByTestId("ms"));
    expect(await screen.findByText("Program One")).toBeInTheDocument();
  });

  test("shows a no-options message for an empty list", async () => {
    const user = userEvent.setup();
    render(<MultiSelect options={[]} selected={[]} onChange={jest.fn()} testid="ms" />);
    await user.click(screen.getByTestId("ms"));
    expect(await screen.findByText("No options")).toBeInTheDocument();
  });
});
