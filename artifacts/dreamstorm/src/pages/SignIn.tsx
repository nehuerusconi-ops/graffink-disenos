import { SignIn } from "@clerk/react";

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <SignIn signUpUrl="/sign-up" forceRedirectUrl="/admin" />
    </main>
  );
}
