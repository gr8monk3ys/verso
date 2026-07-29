import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";

export default async function MePage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  redirect(`/u/${user.handle}`);
}
