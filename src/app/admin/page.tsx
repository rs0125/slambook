import { AdminApp } from "@/components/admin-app";
import { isConfigured } from "@/lib/database";
export const dynamic = "force-dynamic";
export default function AdminPage() {
  return <AdminApp configured={isConfigured()} />;
}
