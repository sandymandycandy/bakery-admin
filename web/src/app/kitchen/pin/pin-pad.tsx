"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/components/ui";
import { pinSignIn } from "./actions";

type Chef = { user_id: string; full_name: string; has_pin: boolean };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

// Large touch targets for a kitchen tablet: tap a name, then type the PIN on the keypad.
export function PinPad({ chefs }: { chefs: Chef[] }) {
  const [chef, setChef] = useState<Chef | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function press(key: (typeof KEYS)[number]) {
    setError(null);
    if (key === "clear") setPin("");
    else if (key === "back") setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < 6 ? p + key : p));
  }

  function submit() {
    if (!chef || pin.length < 4) return;
    start(async () => {
      try {
        const result = await pinSignIn(chef.user_id, pin);
        if (result.ok) {
          router.replace("/kitchen");
          return;
        }
        setError(result.message ?? "PIN not accepted.");
        setPin("");
      } catch {
        setError("Not signed in, check the connection.");
      }
    });
  }

  if (chefs.length === 0) {
    return <p className="mt-8 text-center text-lg">No chefs are assigned to this kitchen yet. Ask an admin.</p>;
  }

  if (!chef) {
    return (
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {chefs.map((c) => (
          <button
            key={c.user_id}
            type="button"
            disabled={!c.has_pin}
            onClick={() => {
              setChef(c);
              setPin("");
              setError(null);
            }}
            className="rounded-2xl border-2 border-line bg-surface px-6 py-8 text-left text-2xl font-semibold hover:border-brand disabled:opacity-50"
          >
            {c.full_name}
            {!c.has_pin && <span className="mt-1 block text-sm font-normal text-muted">No PIN yet. Ask an admin.</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <div className="flex items-center justify-between">
        <p className="text-2xl font-semibold">{chef.full_name}</p>
        <button type="button" onClick={() => setChef(null)} className="rounded-lg border border-line px-4 py-2 text-base hover:bg-brand-soft">
          Not you?
        </button>
      </div>
      <div aria-live="polite" className="mt-6 flex justify-center gap-3" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={cx("h-5 w-5 rounded-full border-2 border-ink", i < pin.length && "bg-ink")} />
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-4 text-center text-base font-medium text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={pending}
            onClick={() => press(k)}
            aria-label={k === "clear" ? "Clear" : k === "back" ? "Delete last digit" : k}
            className="rounded-2xl border border-line bg-surface py-5 text-3xl font-semibold tabular-nums hover:bg-brand-soft disabled:opacity-60"
          >
            {k === "clear" ? <span className="text-lg">Clear</span> : k === "back" ? "⌫" : k}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={pending || pin.length < 4}
        onClick={submit}
        className="mt-4 w-full rounded-2xl bg-brand py-5 text-2xl font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </div>
  );
}
