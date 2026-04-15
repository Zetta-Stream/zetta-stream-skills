import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Zetta-Stream — Self-driving yield for the agent economy",
  description:
    "AI agent rotates USDC between Aave V3 and Uniswap V4 — driven by x402 V2 yield signals, EIP-7702 batches, TEE-gated firewall. Audit on X Layer, exec on Arbitrum. Built for the OKX Onchain OS Hackathon.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="border-b border-[rgb(var(--card-border))]">
            <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-2.5 font-mono text-base tracking-[0.2em]"
              >
                <span className="text-[rgb(var(--accent))]">ZETTA</span>
                <span className="text-[rgb(var(--muted))]">·</span>
                <span>STREAM</span>
              </Link>
              <nav className="flex gap-6 text-sm text-[rgb(var(--muted))] font-mono uppercase tracking-wider">
                <Link href="/" className="hover:text-white">Home</Link>
                <Link href="/audit" className="hover:text-white">Rotations</Link>
                <Link href="/medals" className="hover:text-white">Medals</Link>
                <a
                  href="https://github.com"
                  className="hover:text-white"
                  target="_blank"
                  rel="noopener noreferrer"
                >Code</a>
              </nav>
            </div>
          </header>
          <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
          <footer className="max-w-6xl mx-auto px-6 py-6 text-xs text-[rgb(var(--muted))] border-t border-[rgb(var(--card-border))] mt-12 font-mono">
            ZETTA-STREAM · OKX Onchain OS Hackathon · audit on X Layer (196) · exec on Arbitrum (42161)
          </footer>
        </Providers>
      </body>
    </html>
  );
}
