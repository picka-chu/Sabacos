import { Minus, Plus } from "lucide-react";
import { haptic } from "../telegram.js";

interface Props {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

export function QuantityStepper({ value, min = 1, max = 99, onChange }: Props) {
  return (
    <div className="qty-stepper">
      <button
        aria-label="Decrease quantity"
        disabled={value <= min}
        onClick={(e) => {
          e.stopPropagation();
          haptic("light");
          onChange(Math.max(min, value - 1));
        }}
      >
        <Minus size={14} />
      </button>
      <span>{value}</span>
      <button
        aria-label="Increase quantity"
        disabled={value >= max}
        onClick={(e) => {
          e.stopPropagation();
          haptic("light");
          onChange(Math.min(max, value + 1));
        }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}