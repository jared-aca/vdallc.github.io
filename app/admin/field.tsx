"use client";
import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
export default function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const input = isValidElement(children)
    ? cloneElement(
        children as ReactElement<{ id: string; "aria-describedby"?: string }>,
        { id, "aria-describedby": hint ? `${id}-hint` : undefined },
      )
    : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
