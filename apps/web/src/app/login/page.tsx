import { Suspense } from "react";
import LoginPage from "./login-form";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-zinc-400">Laster…</div>}>
      <LoginPage />
    </Suspense>
  );
}
