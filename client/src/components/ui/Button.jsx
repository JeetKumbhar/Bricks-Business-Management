import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../utils/cn";

const variants = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "bg-secondary text-white hover:bg-secondary-hover",
  success: "bg-success text-white hover:bg-success-hover",
  danger: "bg-danger text-white hover:bg-danger-hover",
  outline: "border border-border bg-surface text-fg hover:bg-background",
  ghost: "text-fg-muted hover:bg-background hover:text-fg",
};

const sizes = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-base",
};

/**
 * <Button variant="primary" leftIcon={Plus}>Add Labour</Button>
 * variants: primary | secondary | success | danger | outline | ghost
 * sizes: sm | md | lg
 */
const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    fullWidth = false,
    type = "button",
    disabled,
    className,
    children,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "type-button inline-flex items-center justify-center whitespace-nowrap rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        LeftIcon && <LeftIcon className="h-4 w-4" aria-hidden="true" />
      )}
      {children}
      {!loading && RightIcon && <RightIcon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
});

export default Button;
