export default function ScanLoading() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-4 sm:max-w-lg" aria-busy="true">
      <div className="tl-skeleton h-6 w-40 rounded-md" />
      <div className="grid grid-cols-2 gap-2">
        <div className="tl-skeleton h-14 rounded-md" />
        <div className="tl-skeleton h-14 rounded-md" />
      </div>
      <div className="tl-skeleton min-h-[min(52vh,22rem)] rounded-xl" />
      <p className="text-center text-sm text-[color:var(--muted)]">Starter scanner…</p>
    </div>
  );
}
