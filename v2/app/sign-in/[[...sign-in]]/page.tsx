import { Suspense } from 'react';
import { SignIn } from '@clerk/nextjs';

/**
 * The one page a signed-out reader sees, so it does the explaining the
 * masthead normally would: what this thing estimates, and on what evidence.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      <section className="border-border flex flex-[1.15] flex-col justify-between gap-12 px-8 py-14 lg:border-r lg:px-[60px] lg:py-14">
        <div className="font-serif text-[22px] font-bold">
          Tusk{' '}
          <span className="text-muted-foreground text-[20px] font-normal italic">
            catalogue fundamentals
          </span>
        </div>

        <div>
          <h1 className="max-w-[20ch] font-serif text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] lg:text-[40px]">
            What will the music line print this quarter?
          </h1>
          <p className="mt-5 max-w-[52ch] text-[15px] leading-[1.65] text-[#4A463A]">
            A revenue nowcast for Tips Music and Saregama, built from measured catalogue reach and
            scored against every result as it prints.
          </p>

          <dl className="border-border mt-7 flex flex-wrap gap-10 border-t pt-[18px]">
            <Fact figure="38" label="owned channels tracked" />
            <Fact figure="3.5yr" label="daily history" />
            <Fact figure="2" label="companies, one comparable line" />
          </dl>
        </div>

        <p className="text-muted-foreground text-[11.5px]">
          Internal research tool · not investment advice · Tusk Invest
        </p>
      </section>

      <section className="flex flex-1 flex-col justify-center px-8 py-14 lg:px-[60px]">
        <h2 className="font-serif text-2xl font-semibold">Sign in</h2>
        <p className="text-muted-foreground mt-1.5 text-[13px]">
          Restricted to tuskinvest.com accounts.
        </p>
        <div className="mt-7">
          <Suspense fallback={<div className="border-border h-96 animate-pulse border" />}>
            <SignIn
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  card: 'shadow-none border border-border bg-card rounded-none',
                  headerTitle: 'hidden',
                  headerSubtitle: 'hidden',
                },
              }}
            />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

function Fact({ figure, label }: { figure: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd>
        <span data-figure className="font-serif text-[22px] font-semibold">
          {figure}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-[11px]">{label}</span>
      </dd>
    </div>
  );
}
