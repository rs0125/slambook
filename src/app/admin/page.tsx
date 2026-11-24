import { AdminApp } from "@/components/admin-app";
import { isConfigured } from "@/lib/supabase/service";
export const dynamic = "force-dynamic";
export default function AdminPage() {
  return <AdminApp configured={isConfigured()} />;
}
