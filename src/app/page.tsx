import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function Home() {
  const current = await getCurrentUser();
  redirect(current ? "/dashboard" : "/login");
}
