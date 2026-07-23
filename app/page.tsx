import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col antialiased">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        {/* Brand */}
        <div className="mb-12 text-center">
          <span className="text-3xl font-bold tracking-tight text-black">
            ni<span className="text-[#10b981] font-extrabold">x</span>crip
          </span>
          <p className="mt-2 text-sm text-slate-400">Enterprise Operations Platform</p>
        </div>

        {/* Login */}
        <div className="w-full max-w-xs">
          <Link
            href="/auth/login"
            className="block w-full text-center px-6 py-3.5 bg-black hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-all shadow-sm"
          >
            Sign In
          </Link>
          <p className="mt-3 text-center text-xs text-slate-400">
            No account?{" "}
            <Link href="/auth/register" className="text-[#10b981] hover:underline font-medium">
              Register
            </Link>
          </p>
        </div>

        {/* Divider */}
        <div className="w-full max-w-xs mt-10 mb-8 border-t border-slate-200" />

        {/* Documentation */}
        <div className="w-full max-w-xs">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
            Documentation
          </p>
          <a
            href="/claim-manual.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3.5 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-sm transition-all group"
          >
            <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center text-sm shrink-0">
              📋
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 group-hover:text-black truncate">
                Claim Submission Manual
              </p>
              <p className="text-xs text-slate-400">How to submit expense claims</p>
            </div>
            <svg className="ml-auto w-4 h-4 text-slate-300 group-hover:text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>

      <footer className="py-6 text-center text-xs text-slate-400">
        &copy; {new Date().getFullYear()} nixcrip
      </footer>
    </div>
  );
}
