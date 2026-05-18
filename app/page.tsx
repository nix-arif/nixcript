import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-white/80 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo Context (Representing the attached nixcrip logo) */}
          <div className="flex items-center space-x-2">
            <span className="text-2xl font-bold tracking-tight text-black">
              ni<span className="text-[#10b981] font-extrabold">x</span>crip
            </span>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex space-x-8 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-[#10b981] transition">
              Features
            </a>
            <a href="#solutions" className="hover:text-[#10b981] transition">
              Solutions
            </a>
            <a href="#pricing" className="hover:text-[#10b981] transition">
              Pricing
            </a>
          </nav>

          {/* CTA */}
          <div className="flex items-center space-x-4">
            <Link
              href="/auth/register"
              className="bg-black hover:bg-slate-800 text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all duration-200 hover:shadow-md"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-20 pb-24 overflow-hidden bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto">
            {/* Tagline Badge */}
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 mb-6">
              Next-Gen CRM & ERP Platform
            </span>

            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900 mb-6 leading-tight">
              Manage your operations & customers in{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-black to-[#10b981]">
                one single workspace.
              </span>
            </h1>

            <p className="text-lg text-slate-600 mb-10 max-w-2xl mx-auto">
              nixcrip unifies your sales pipeline, inventory management,
              multi-company structures, and department workflows into a
              lightning-fast ecosystem. Stop juggling tools.
            </p>

            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              <Link
                href="/auth/register"
                className="w-full sm:w-auto px-8 py-4 bg-[#10b981] hover:bg-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-100 transition-all text-center"
              >
                Create Free Account
              </Link>
              <a
                href="#features"
                className="w-full sm:w-auto px-8 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-all text-center"
              >
                Explore Features
              </a>
            </div>
          </div>
        </div>

        {/* Decorative Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
      </section>

      {/* Feature Section */}
      <section
        id="features"
        className="py-20 bg-slate-50 border-t border-slate-100"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Engineered for Complex Operations
            </h2>
            <p className="mt-4 text-slate-600">
              Everything you need to scale your enterprise without the typical
              bloat of traditional ERP platforms.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-white p-8 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md transition">
              <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-[#10b981] mb-6 font-bold text-xl">
                ⇄
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                Multi-Context RBAC
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Seamlessly toggle between different companies, departments, and
                specific roles with precise permission matrices all under one
                login profile.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-white p-8 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md transition">
              <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center text-white mb-6 font-bold text-xl">
                📊
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                Unified Pipelines
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Track client leads instantly alongside real-time inventory
                levels, supply chains, and hospital or vendor catalogues.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-white p-8 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md transition">
              <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-[#10b981] mb-6 font-bold text-xl">
                📄
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                Automated Catalogues
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Transform spreadsheets directly into beautifully rendered PDF
                catalogs and regulatory documentation requests in seconds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / Bottom CTA */}
      <section className="bg-slate-900 text-white py-20 relative overflow-hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-6">
            Ready to streamline your entire business hierarchy?
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto mb-10 text-sm sm:text-base">
            Set up your organization settings, invite your department managers,
            and unify your operational workflow today.
          </p>
          <Link
            href="/auth/register"
            className="inline-block px-8 py-4 bg-[#10b981] hover:bg-emerald-600 text-white font-bold rounded-xl transition duration-200 shadow-lg shadow-emerald-900/40"
          >
            Get Started with nixcrip Now
          </Link>
        </div>

        {/* Abstract Background Accent */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
      </section>

      {/* Footer */}
      <footer className="bg-white py-8 border-t border-slate-200 text-center text-xs text-slate-500">
        <p>&copy; {new Date().getFullYear()} nixcrip. All rights reserved.</p>
      </footer>
    </div>
  );
}
