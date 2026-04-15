import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import Link from "next/link";
import Image from "next/image";

export const metadata: Metadata = {
  title: "ZettaStream — Web3's Agentic Kernel",
  description:
    "TEE-native intent firewall + EIP-7702 batch executor + x402 reusable data sessions. Built for the OKX Onchain OS Hackathon.",
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
                className="flex items-center gap-2.5 text-xl font-semibold tracking-tight"
              >
                <Image
                  src="/interhub.png"
                  alt="ZettaStream logo"
                  width={32}
                  height={32}
                  priority
                  className="rounded-sm"
                />
                <span>
                  <span className="text-[rgb(var(--accent))]">Intent</span>Hub
                </span>
              </Link>
              <nav className="flex gap-6 text-sm text-[rgb(var(--muted))]">
                <Link href="/" className="hover:text-white">
                  Home
                </Link>
                <Link href="/firewall" className="hover:text-white">
                  Firewall
                </Link>
                <Link href="/positions" className="hover:text-white">
                  Routes
                </Link>
                <Link href="/audit" className="hover:text-white">
                  Audit
                </Link>
              </nav>
            </div>
          </header>
          <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
          <footer className="max-w-6xl mx-auto px-6 py-6 text-xs text-[rgb(var(--muted))] border-t border-[rgb(var(--card-border))] mt-12">
            ZettaStream · Built for OKX Onchain OS Hackathon · Audit contract on X Layer (196)
          </footer>
        </Providers>
      </body>
    </html>
  );
}
