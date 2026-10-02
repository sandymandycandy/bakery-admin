"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { resolveIssueAction } from "@/app/kitchen/actions";

export function ResolveIssueForm({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Resolve
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          // A thrown error means the request never reached the server (or the session ended), so
          // nothing was saved. Show it here instead of letting it reach the page's error boundary.
          try {
            const result = await resolveIssueAction(issueId, text);
            if (result.ok) {
              setOpen(false);
              router.refresh();
            } else {
              setError(result.message ?? "Could not save.");
            }
          } catch {
            setError("Not saved, check the connection.");
          }
        });
      }}
    >
      <label htmlFor={`resolve-${issueId}`} className="sr-only">
        How it was resolved
      </label>
      <Input id={`resolve-${issueId}`} className="w-64" value={text} onChange={(e) => setText(e.target.value)}
        maxLength={500} placeholder="How it was resolved" autoFocus />
      <Button type="submit" disabled={pending || text.trim().length < 3}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
        Close
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
