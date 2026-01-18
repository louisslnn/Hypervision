import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export function Button({ variant = "primary", children, ...props }: ButtonProps) {
  const className =
    variant === "primary"
      ? "px-4 py-2 rounded-md bg-black text-white"
      : "px-4 py-2 rounded-md border border-black text-black";
  return (
    <button className={className} {...props}>
      {children}
    </button>
  );
}
