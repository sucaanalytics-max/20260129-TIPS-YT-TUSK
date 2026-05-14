import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-xl font-semibold">
          Tusk · TIPS YT × Stock
        </h1>
        <SignIn appearance={{ elements: { card: 'shadow-none border border-border' } }} />
      </div>
    </main>
  );
}
