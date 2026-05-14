import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-xl font-semibold">
          Tusk · request access
        </h1>
        <SignUp appearance={{ elements: { card: 'shadow-none border border-border' } }} />
        <p className="text-muted-foreground mt-4 text-center text-xs">
          Access is limited to @tuskinvest.com accounts.
        </p>
      </div>
    </main>
  );
}
