import { SignUp } from "@clerk/react";

export default function SignUpPage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <SignUp signInUrl="/sign-in" forceRedirectUrl="/admin" />
    </main>
  );
}
