export default function Loading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 bg-muted rounded w-48" />
      <div className="h-10 bg-muted rounded w-full" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-16 bg-muted rounded" />
      ))}
    </div>
  );
}
