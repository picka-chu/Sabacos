export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className ?? ""}`} style={style} />;
}

export function SkeletonCard() {
  return (
    <div className="card skeleton-card">
      <Skeleton className="skeleton-title" />
      <Skeleton className="skeleton-value" />
      <Skeleton className="skeleton-text-sm" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      {Array.from({ length: rows }, (_, ri) => (
        <div key={ri} className="skeleton-row" style={{ padding: "12px 14px" }}>
          {Array.from({ length: cols }, (_, ci) => (
            <Skeleton
              key={ci}
              className="skeleton"
              style={{
                height: 14,
                width: ci === 0 ? "30%" : ci === cols - 1 ? "20%" : "25%",
                flex: ci > 0 && ci < cols - 1 ? 1 : undefined,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      {title && <div className="empty-title">{title}</div>}
      {children}
    </div>
  );
}
