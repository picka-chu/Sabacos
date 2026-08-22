export function PageTitle({ title }: { title: string }) {
  return (
    <h1 className="serif" style={{ fontSize: 24, margin: "2px 4px 14px", fontWeight: 700, letterSpacing: "0.01em" }}>
      {title}
    </h1>
  );
}
