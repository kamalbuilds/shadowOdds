"use client";

export function PrivacyFlow() {
  const steps = [
    {
      title: "Hidden Bet",
      desc: "Your YES/NO direction is hashed on-chain via commit-reveal. No one sees which side you chose.",
      tag: "Commit-Reveal",
      visible: "Amount: $500",
      hidden: "Direction: ████",
    },
    {
      title: "Oracle Resolution",
      desc: "Pyth price feeds resolve markets in under a second. Anyone can trigger resolution permissionlessly.",
      tag: "Pyth Oracle",
      visible: "Price: $2,547",
      hidden: "Threshold check",
    },
    {
      title: "Shield Winnings",
      desc: "After claiming, shield USDC into a ZK privacy pool. Withdraw to any address — no link to your wallet.",
      tag: "Unlink ZK",
      visible: "Deposit TX",
      hidden: "Recipient: ████",
    },
  ];

  return (
    <section className="max-w-6xl mx-auto px-5 py-16">
      <h2 className="text-white text-xl font-semibold mb-2">How it works</h2>
      <p className="text-zinc-500 text-sm mb-8 max-w-lg">
        Three layers of privacy — from bet placement to collecting winnings.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {steps.map((step, i) => (
          <div key={i} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-zinc-600 text-xs font-mono">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-xs text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800/80">{step.tag}</span>
            </div>

            <h3 className="text-white font-semibold text-[15px] mb-2">{step.title}</h3>
            <p className="text-zinc-500 text-sm leading-relaxed flex-1 mb-4">{step.desc}</p>

            <div className="rounded-lg bg-zinc-900 border border-zinc-800/40 p-3 text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-zinc-600">Visible</span>
                <span className="text-zinc-400">{step.visible}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-600">Hidden</span>
                <span className="text-[#00e87b]">{step.hidden}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
