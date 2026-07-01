import { ArrowRight, Eye, Lock, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

function ViaLogo() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded bg-[#004b87] shadow-sm">
        <span className="text-2xl font-bold leading-none text-white">v</span>
      </div>
      <div>
        <p className="text-lg font-bold leading-tight text-slate-950">VIA Int</p>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          CV Generation
        </p>
      </div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    let result;
    if (isRegistering) {
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      result = await register({ name: fullName, email, password });
    } else {
      result = await login(email, password);
    }
    if (!result.success) {
      setError(result.error || "Unable to sign in.");
      return;
    }
    const pendingDriveReviews = await api.getPendingDriveReviews().catch(() => []);
    navigate(pendingDriveReviews.length ? "/experts" : "/dashboard");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eef4f9] px-4 py-8 text-slate-950">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,75,135,0.12),rgba(255,255,255,0)_45%),radial-gradient(circle_at_82%_18%,rgba(37,99,235,0.16),transparent_32%),radial-gradient(circle_at_18%_84%,rgba(14,165,233,0.16),transparent_30%)]" />
      <div className="absolute left-0 top-0 h-1.5 w-full bg-[#004b87]" />

      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-lg border border-white/80 bg-white shadow-2xl shadow-slate-900/10 lg:grid-cols-[1fr_0.92fr]">
        <div className="relative hidden min-h-[620px] overflow-hidden bg-[#004b87] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-12">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),rgba(255,255,255,0)_42%),radial-gradient(circle_at_28%_24%,rgba(125,211,252,0.28),transparent_34%)]" />
          <div className="absolute -bottom-20 -right-20 h-72 w-72 rounded-full border border-white/20" />
          <div className="absolute bottom-20 right-16 h-36 w-36 rounded-full border border-cyan-200/30" />

          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded bg-white shadow-sm">
                <span className="text-3xl font-bold leading-none text-[#004b87]">v</span>
              </div>
              <div>
                <p className="text-xl font-bold leading-tight">VIA Int</p>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
                  CV Generation
                </p>
              </div>
            </div>
          </div>

          <div className="relative z-10 max-w-md">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-100">
              Tender CV Platform
            </p>
            <h1 className="mt-5 text-5xl font-bold leading-tight">
              VIA CV Generation
            </h1>
            <p className="mt-5 text-base leading-7 text-blue-50">
              Extract, review, adapt, and generate branded expert CVs for tender submissions.
            </p>
          </div>

          <div className="relative z-10 grid grid-cols-3 gap-3">
            {["Extract", "Review", "Generate"].map((item) => (
              <div key={item} className="border border-white/20 bg-white/10 p-4 backdrop-blur">
                <p className="text-sm font-bold">{item}</p>
                <div className="mt-3 h-1 rounded-full bg-cyan-200" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-h-[620px] items-center justify-center p-8 sm:p-10">
          <div className="w-full max-w-sm">
            <div className="flex justify-center lg:hidden">
              <ViaLogo />
            </div>

            <div className="mt-9 text-center lg:mt-0 lg:text-left">
              <h2 className="text-3xl font-bold tracking-tight text-slate-950">
                {isRegistering ? "Create account" : "Sign in"}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {isRegistering
                  ? "Create your own private login for VIA CV Generation."
                  : "Enter your credentials to access your workspace."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {isRegistering && (
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Full name</span>
                  <div className="mt-2 flex h-12 items-center gap-3 rounded-md border border-slate-300 bg-white px-3 shadow-sm transition focus-within:border-[#004b87] focus-within:ring-4 focus-within:ring-blue-100">
                    <input
                      type="text"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      placeholder="Your full name"
                    />
                  </div>
                </label>
              )}

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Email address</span>
                <div className="mt-2 flex h-12 items-center gap-3 rounded-md border border-slate-300 bg-white px-3 shadow-sm transition focus-within:border-[#004b87] focus-within:ring-4 focus-within:ring-blue-100">
                  <Mail size={17} className="text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    placeholder="name@company.com"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Password</span>
                <div className="mt-2 flex h-12 items-center gap-3 rounded-md border border-slate-300 bg-white px-3 shadow-sm transition focus-within:border-[#004b87] focus-within:ring-4 focus-within:ring-blue-100">
                  <Lock size={17} className="text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <Eye size={17} />
                  </button>
                </div>
              </label>

              {isRegistering && (
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Confirm password</span>
                  <div className="mt-2 flex h-12 items-center gap-3 rounded-md border border-slate-300 bg-white px-3 shadow-sm transition focus-within:border-[#004b87] focus-within:ring-4 focus-within:ring-blue-100">
                    <Lock size={17} className="text-slate-400" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      placeholder="Confirm password"
                    />
                  </div>
                </label>
              )}

              {!isRegistering && (
              <div className="flex items-center justify-between gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-[#004b87] focus:ring-[#004b87]"
                    defaultChecked
                  />
                  Remember me
                </label>
                <button type="button" className="text-sm font-semibold text-[#004b87] hover:text-[#003b6c]">
                  Forgot password?
                </button>
              </div>
              )}

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#004b87] px-5 text-sm font-bold text-white shadow-lg shadow-blue-950/20 transition hover:bg-[#003b6c]"
              >
                {isRegistering ? "Create Account" : "Sign In"}
                <ArrowRight size={17} />
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-slate-600">
              {isRegistering ? "Already have an account?" : "Need an account?"}
              <button
                type="button"
                onClick={() => {
                  setIsRegistering((value) => !value);
                  setError("");
                }}
                className="ml-2 font-bold text-[#004b87] hover:text-[#003b6c]"
              >
                {isRegistering ? "Sign in" : "Create account"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
