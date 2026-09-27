import { redirect } from "next/navigation";
import { getStaff, homePathFor } from "@/lib/auth";

// The public website is not part of this phase; send visitors to the staff area.
export default async function Home() {
  const staff = await getStaff();
  redirect(staff ? homePathFor(staff.role) : "/login");
}
