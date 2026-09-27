import { EmptyState, PageHeader } from "@/components/ui";

export function ComingSoon({ title, phase, children }: { title: string; phase: string; children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title={`Planned for ${phase}`}>{children}</EmptyState>
    </>
  );
}
