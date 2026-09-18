import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  inputMode?: "text" | "tel" | "numeric" | "email" | "url";
  type?: "text" | "password";
  rows?: number;
  suffix?: ReactNode;
}

export function FormField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  hint,
  minLength,
  maxLength,
  required,
  inputMode,
  type = "text",
  rows,
  suffix,
}: FormFieldProps) {
  const len = value.length;
  const showError = !!error;
  const showCounter = maxLength != null && maxLength <= 500;

  const counterColor =
    showError ? "var(--danger, #d32f2f)"
    : maxLength != null && len > maxLength * 0.9 ? "var(--warning, #e65100)"
    : "var(--muted)";

  const inputProps = {
    value,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onBlur,
    "aria-invalid": showError || undefined,
    style: showError ? { borderColor: "var(--danger, #d32f2f)" } : undefined,
    ...(inputMode ? { inputMode } : {}),
    ...(type !== "text" ? { type } : {}),
  };

  return (
    <div className="field">
      <label>
        {label}
        {required && <span style={{ color: "var(--danger, #d32f2f)", marginLeft: 2 }}>*</span>}
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {rows ? (
            <textarea
              {...inputProps}
              rows={rows}
              style={{ ...inputProps.style, resize: "vertical" }}
            />
          ) : (
            <input {...inputProps} />
          )}
          <div style={{ display: "flex", justifyContent: "space-between", minHeight: 16 }}>
            {hint && !showError ? (
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{hint}</span>
            ) : showError ? (
              <span style={{ fontSize: 11.5, color: "var(--danger, #d32f2f)", fontWeight: 500 }}>{error}</span>
            ) : (
              <span />
            )}
            {showCounter && (
              <span style={{ fontSize: 11.5, color: counterColor, fontVariantNumeric: "tabular-nums" }}>
                {len}/{maxLength}
              </span>
            )}
          </div>
        </div>
        {suffix}
      </div>
    </div>
  );
}
