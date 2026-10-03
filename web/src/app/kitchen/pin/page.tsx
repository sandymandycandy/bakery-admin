import type { Metadata } from "next";
import Link from "next/link";
import { currentTablet, pinSignInAvailable } from "@/lib/kitchen-device";
import { Alert } from "@/components/ui";
import { PinPad } from "./pin-pad";

export const metadata: Metadata = { title: "Chef sign-in" };
export const dynamic = "force-dynamic";

// The chef picker on a registered kitchen tablet. Reachable while signed out (see src/proxy.ts).
export default async function PinPage() {
  const tablet = pinSignInAvailable() ? await currentTablet() : null;

  return (
    <main className="flex min-h-screen flex-col items-center px-5 py-10">
      <div className="w-full max-w-3xl">
        <p className="text-center text-sm font-medium uppercase tracking-widest text-brand">Auri Bakery · Kitchen</p>
        {!pinSignInAvailable() ? (
          <Alert tone="danger" title="PIN sign-in is not set up on this server">
            An admin needs to add the server&apos;s secret key. Until then, sign in with email and password.
          </Alert>
        ) : !tablet ? (
          <div className="mt-6">
            <Alert title="This is not a registered kitchen tablet">
              An admin can register it in Staff &amp; Kitchens → Kitchen tablets, on this device. If it was registered before, it may have been
              revoked.
            </Alert>
          </div>
        ) : (
          <>
            <h1 className="mt-2 text-center text-3xl font-semibold">{tablet.kitchen.name}</h1>
            <p className="mt-1 text-center text-lg text-muted">Tap your name, then type your PIN.</p>
            <PinPad chefs={tablet.chefs} />
          </>
        )}
        <p className="mt-10 text-center text-sm">
          <Link href="/login?email=1" className="text-brand hover:underline">
            Sign in with email instead
          </Link>
        </p>
      </div>
    </main>
  );
}
