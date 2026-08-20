export function ProductCardSkeleton() {
  return (
    <div className="product-card" aria-hidden>
      <div className="skeleton thumb" />
      <div className="card-body">
        <div className="skeleton" style={{ height: 14, width: "90%" }} />
        <div className="skeleton" style={{ height: 14, width: "40%" }} />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="product-grid">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}