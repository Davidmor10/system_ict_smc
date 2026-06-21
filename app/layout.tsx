import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display, Frank_Ruhl_Libre, Heebo } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearance } from "./lib/clerkAppearance";
import { LanguageProvider } from "./hooks/useLanguage";
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
  weight: ["600", "700", "800", "900"],
  style: ["normal", "italic"],
});

const frankRuhl = Frank_Ruhl_Libre({
  variable: "--font-frank",
  subsets: ["hebrew", "latin"],
  weight: ["500", "700", "900"],
});

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "ONYX TRADING",
  description: "Institutional-grade SMC / ICT futures analytics for ES and NQ",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${frankRuhl.variable} ${heebo.variable} antialiased`}>
      <body className="flex flex-col bg-[#050505]">
        {/* One language context for the whole app, so the Header toggle and the
            Sidebar toggle drive the same state across every route. */}
        <LanguageProvider>
          {clerkEnabled
            ? <ClerkProvider appearance={clerkAppearance} afterSignOutUrl="/">{children}</ClerkProvider>
            : children}
        </LanguageProvider>
      </body>
    </html>
  );
}
