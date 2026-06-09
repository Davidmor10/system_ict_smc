import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearance } from "./lib/clerkAppearance";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "ONYX TRADING",
  description: "Institutional-grade SMC / ICT futures analytics for ES and NQ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // ClerkProvider only mounts once a publishable key is present — until then the
  // app renders normally (no auth), so adding Clerk never breaks the workspace.
  const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} antialiased`}>
      <body className="flex flex-col bg-[#050505]">
        {clerkEnabled
          ? <ClerkProvider appearance={clerkAppearance} afterSignOutUrl="/">{children}</ClerkProvider>
          : children}
      </body>
    </html>
  );
}
