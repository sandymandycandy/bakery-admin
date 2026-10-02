"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTime } from "@/lib/time";
import { kitchenStampAction } from "@/app/kitchen/actions";

const POLL_MS = 10_000;

// Checks for ticket changes every 10 seconds while the tab is visible, and reloads the page data
// only when something changed. A failed check shows the Offline banner until the next success.
export function RefreshStatus({ stamp, tz, loadedAt }: { stamp: string; tz: string; loadedAt: string }) {
  const router = useRouter();
  const known = useRef(stamp);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    known.current = stamp;
  }, [stamp]);

  useEffect(() => {
    let live = true;
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await kitchenStampAction();
        if (!live) return;
        const at = Date.now();
        setOffline(false);
        setLastOk(at);
        setNow(at);
        if (next !== known.current) {
          known.current = next;
          router.refresh();
        }
      } catch {
        if (live) setOffline(true);
      }
    }
    const timer = setInterval(poll, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      live = false;
      clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [router]);

  if (offline) {
    return (
      <p role="alert" className="rounded-lg bg-danger px-3 py-2 text-base font-semibold text-white">
        Offline, showing data from {formatTime(new Date(lastOk ?? Date.parse(loadedAt)), tz)}
      </p>
    );
  }
  const seconds = lastOk !== null && now !== null ? Math.max(0, Math.round((now - lastOk) / 1000)) : null;
  return (
    <p className="text-sm text-muted" aria-live="polite">
      {seconds === null ? "Live · checks every 10 s" : `Updated ${seconds} s ago`}
    </p>
  );
}
