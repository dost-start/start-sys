import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
