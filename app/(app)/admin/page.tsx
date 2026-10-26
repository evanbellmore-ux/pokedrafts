import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createRpc } from "@/app/lib/rpc";
import { createServerSupabase } from "@/app/lib/supabase/server";
import WatchReviewClient from "./WatchReviewClient";

export const metadata: Metadata = {
  title: "Watch listings",
};

/**
 * Site admins only (docs/release-architecture.md section 16): every public
 * league and its place on /watch, to approve or unlist. The check runs on the
 * server, so anyone else gets the 404 page as if there were no such page; the
 * list itself loads in the browser like the other signed-in pages.
 */
export default async function AdminPage() {
  const { data } = await createRpc(await createServerSupabase()).siteAdminStatus();
  if (!data?.admin) notFound();
  return <WatchReviewClient />;
}
