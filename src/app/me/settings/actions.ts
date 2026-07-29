"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { run } from "@/lib/db";

export async function updateProfileAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  run(
    `UPDATE users SET display_name = ?, bio = ?, home_city = ?, is_private = ?
      WHERE id = ?`,
    String(formData.get("display_name") ?? "").trim().slice(0, 80) || user.handle,
    String(formData.get("bio") ?? "").trim().slice(0, 500),
    String(formData.get("home_city") ?? "").trim().slice(0, 80) || null,
    formData.get("is_private") === "on" ? 1 : 0,
    user.id,
  );

  revalidatePath("/me/settings");
  revalidatePath(`/u/${user.handle}`);
}
