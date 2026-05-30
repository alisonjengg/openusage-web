import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "openusage",
  description: "Personal usage dashboard for Claude & Codex subscriptions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
