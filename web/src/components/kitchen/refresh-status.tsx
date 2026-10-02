"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTime } from "@/lib/time";
import { KITCHEN_OFFLINE_EVENT, createStampPoller, readStampResponse } from "@/lib/kitchen";

const POLL_MS = 10_000;
const POLL_TIMEOUT_MS = 8_000;

async function fetchStamp(signal: AbortSignal): Promise<string> {
  return readStampResponse(await fetch("/kitchen/stamp", { signal, cache: "no-store" }));
}

// Checks for ticket changes every 10 seconds while the tab is visible, and reloads the page data
// only when something changed. A failed or timed-out check, or a ticket action that failed on the
// network, shows the Offline banner until the next successful check. A check that finds the session
// gone (signed out, expired, or the account deactivated) sends the chef to the sign-in page.
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
    const pollStamp = createStampPoller(fetchStamp, { timeoutMs: POLL_TIMEOUT_MS });
    async function poll() {
      if (document.visibilityState !== "visible") return;
      const result = await pollStamp();
      if (!live || result.kind === "busy") return;
      if (result.kind === "signed_out") {
        live = false;
        router.replace("/login");
        return;
      }
      if (result.kind === "offline") {
        setOffline(true);
        return;
      }
      const at = Date.now();
      setOffline(false);
      setLastOk(at);
      setNow(at);
      if (result.stamp !== known.current) {
        known.current = result.stamp;
        router.refresh();
      }
    }
    function onActionOffline() {
      setOffline(true);
      void poll();
    }
    const timer = setInterval(poll, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener(KITCHEN_OFFLINE_EVENT, onActionOffline);
    return () => {
      live = false;
      clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener(KITCHEN_OFFLINE_EVENT, onActionOffline);
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
