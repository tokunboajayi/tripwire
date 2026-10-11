/** Vantrel mark: the price line (green) runs up to the wire (amber) and never crosses it. */
export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <rect width="64" height="64" rx="15" fill="#0B1220" />
      <rect x=".5" y=".5" width="63" height="63" rx="14.5" stroke="#fff" strokeOpacity=".08" />
      <path d="M13 19h38" stroke="#F5B841" strokeWidth="5" strokeLinecap="round" />
      <path d="M13 47l11-11 8 6 14-15" stroke="#34D399" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 28, onClick }: { size?: number; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2.5 rounded-lg text-white" aria-label="Vantrel home">
      <Mark size={size} />
      <span className="text-[1.15rem] font-bold tracking-tight">Vantrel</span>
    </button>
  );
}
