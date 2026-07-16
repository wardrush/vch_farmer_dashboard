import { Link } from "react-router-dom";

export function Header({ section }: { section: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-sand-300/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-700 text-sm font-bold text-white">
            VCH
          </span>
          <span>
            <span className="block text-[10px] font-semibold uppercase tracking-widest text-sand-500">
              Veteran&rsquo;s Carbon Holdings
            </span>
            <span className="block text-sm font-bold text-sand-950">{section}</span>
          </span>
        </Link>
        <nav className="flex gap-4 text-sm font-semibold text-sand-700">
          <Link to="/" className="hover:text-gold-800">
            Growers
          </Link>
          <Link to="/analyst" className="hover:text-gold-800">
            Analyst
          </Link>
          <Link to="/admin" className="hover:text-gold-800">
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}
