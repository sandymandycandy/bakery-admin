// Creates (or promotes) a staff admin login. Needs SUPABASE_SECRET_KEY in web/.env.local.
// Usage: npm run create-admin -- --email you@example.com --name "Your Name"
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !secret) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in web/.env.local first.");
  process.exit(1);
}
if (!values.email || !values.name) {
  console.error('Usage: npm run create-admin -- --email you@example.com --name "Your Name"');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = process.env.ADMIN_PASSWORD ?? (await rl.question("Password (min 10 characters): "));
rl.close();
if (password.length < 10) {
  console.error("Password must be at least 10 characters.");
  process.exit(1);
}

const supabase = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const email = values.email.trim().toLowerCase();

let userId;
const { data: created, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  if (error.code !== "email_exists") {
    console.error(`Could not create login: ${error.message}`);
    process.exit(1);
  }
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email === email);
  if (!existing) {
    console.error("Login exists but could not be found.");
    process.exit(1);
  }
  userId = existing.id;
  await supabase.auth.admin.updateUserById(userId, { password, ban_duration: "none" });
  console.log("Login already existed; password updated.");
} else {
  userId = created.user.id;
}

const { error: profileError } = await supabase
  .from("staff_profiles")
  .upsert({ user_id: userId, full_name: values.name.trim(), role: "admin", is_active: true });
if (profileError) {
  console.error(`Could not save staff profile: ${profileError.message}`);
  process.exit(1);
}

console.log(`Admin ready: ${email}. Sign in at /login.`);
