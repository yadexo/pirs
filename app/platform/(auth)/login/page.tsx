import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PlatformLoginForm } from "./login-form";

export default function PlatformLoginPage() {
  return (
    <div className="w-full max-w-sm">
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Platform admin sign in</CardTitle>
          <CardDescription>Manage tenants and platform-wide settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <PlatformLoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
