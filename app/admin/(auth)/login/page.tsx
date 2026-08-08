import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StaffLoginForm } from "./login-form";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="w-full max-w-sm">
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Staff sign in</CardTitle>
          <CardDescription>Sign in to your clinic&apos;s admin dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <StaffLoginForm next={next} />
        </CardContent>
      </Card>
    </div>
  );
}
