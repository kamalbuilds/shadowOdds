"use client";

/**
 * Visual pipeline showing ShadowOdds' 3-layer privacy model.
 * Used on the home page to explain the innovation to judges.
 */
export function PrivacyFlow() {
  const steps = [
    {
      num: "01",
      title: "Place Hidden Bet",
      subtitle: "Commit-Reveal",
      desc: "Your YES/NO direction is hashed on-chain. No one — not MEV bots, not other traders — can see which side you chose.",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
      color: "#00FF94",
      visible: "Amount: $500 USDC",
      hidden: "Direction: ████████",
    },
    {
      num: "02",
      title: "Trustless Resolution",
      subtitle: "Pyth Oracle",
      desc: "400ms price feeds resolve markets automatically. No admin key needed. Anyone can trigger resolution by submitting the latest Pyth proof.",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      ),
      color: "#7C3AED",
      visible: "Price: $2,547.30",
      hidden: "Threshold: $2,000",
    },
    {
      num: "03",
      title: "Shield Winnings",
      subtitle: "Unlink ZK Pool",
      desc: "After claiming, shield your USDC into a zero-knowledge privacy pool. Withdraw to ANY address — breaking the link between your win and your wallet.",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
      color: "#00FF94",
      visible: "Deposit TX: 0x3f2a...",
      hidden: "Recipient: ████████",
    },
  ];

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-black text-white mb-3">
          Three Layers of <span className="gradient-text">Privacy</span>
        </h2>
        <p className="text-gray-500 text-base max-w-2xl mx-auto">
          The first prediction market that hides your positions, resolves trustlessly, and lets you break the link between your win and your wallet.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {steps.map((step, i) => (
          <div key={i} className="relative group">
            {/* Connector line */}
            {i < steps.length - 1 && (
              <div className="hidden md:block absolute top-12 -right-3 w-6 h-0.5 bg-gradient-to-r from-gray-700 to-gray-800 z-10" />
            )}

            <div className="rounded-2xl border border-gray-800 bg-[#111] p-6 h-full flex flex-col card-hover">
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center border"
                  style={{
                    borderColor: `${step.color}40`,
                    backgroundColor: `${step.color}10`,
                    color: step.color,
                  }}
                >
                  {step.icon}
                </div>
                <div>
                  <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Step {step.num}</p>
                  <h3 className="text-white font-bold text-sm">{step.title}</h3>
                </div>
              </div>

              {/* Subtitle badge */}
              <span
                className="inline-flex self-start items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold border mb-3"
                style={{
                  color: step.color,
                  borderColor: `${step.color}40`,
                  backgroundColor: `${step.color}08`,
                }}
              >
                {step.subtitle}
              </span>

              {/* Description */}
              <p className="text-gray-400 text-xs leading-relaxed flex-1 mb-4">{step.desc}</p>

              {/* On-chain visibility */}
              <div className="rounded-lg border border-gray-800/60 bg-[#0A0A0A] p-3 text-xs font-mono space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-600">Visible</span>
                  <span className="text-gray-400">{step.visible}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Hidden</span>
                  <span className="text-[#00FF94]">{step.hidden}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
