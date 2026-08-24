import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

function selectionLabel(selected, placeholder) {
  if (selected.length === 0) return placeholder;
  if (selected.length === 1) return selected[0];
  return `${selected.length} selected`;
}

export default function MultiSelect({ options, selected, onChange, placeholder = "Select...", testid }) {
  const [open, setOpen] = React.useState(false);
  const toggle = (val) => {
    if (selected.includes(val)) onChange(selected.filter((s) => s !== val));
    else onChange([...selected, val]);
  };
  const label = selectionLabel(selected, placeholder);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          data-testid={testid}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {options.length === 0 && (
            <div className="px-2 py-2 text-sm text-muted-foreground">No options</div>
          )}
          {options.map((opt) => {
            const val = typeof opt === "string" ? opt : opt.value;
            const text = typeof opt === "string" ? opt : opt.label;
            const isSel = selected.includes(val);
            return (
              <button
                type="button"
                key={val}
                onClick={() => toggle(val)}
                data-testid={`${testid}-option`}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Checkbox checked={isSel} className="pointer-events-none" />
                <span className="truncate">{text}</span>
                {isSel && <Check className="ml-auto h-3.5 w-3.5 text-blue-600" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
