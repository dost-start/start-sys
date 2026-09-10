import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

// Poppins is the brand face (designer's Figma frames, 2026-09-08). next/font self-hosts
// the files under /_next/static, so the CSP's `font-src 'self'` holds and no request
// ever goes to Google at runtime — only at build time, where the fetch happens once.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "START-SYS",
  description: "Centralized Membership Information Management System for START-DOST.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `data-scroll-behavior="smooth"` tells Next the `scroll-behavior: smooth` in
    // globals.css is deliberate, so it stops warning about it on every route transition.
    // Same reason as the emblem above: a clean console is what makes a real error visible.
    <html lang="en" className={poppins.variable} data-scroll-behavior="smooth">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
