import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mutual Fund Analyser",
  description:
    "Search any Indian mutual fund, pull its monthly SEBI portfolio disclosure, and get holdings, allocation, deployable cash, month-on-month deltas and an AI interpretation.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
