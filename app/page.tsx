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
      </div>

      <footer className="py-6 text-center text-xs text-slate-400">
        &copy; {new Date().getFullYear()} nixcrip
      </footer>
    </div>
  );
}
