import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import ExperienceLayer from "@/components/ExperienceLayer";
import SiteChrome from "@/components/SiteChrome";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PRISMA | 17 Anos de Memoria Laboral em Portugal",
  description:
    "Uma experiencia interativa sobre a transformacao do mercado de trabalho portugues entre 2008 e 2024.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt" className="bg-zinc-950" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${playfair.variable} min-h-screen cursor-none bg-zinc-950 text-zinc-100 antialiased [font-family:var(--font-sans)]`}
      >
        <ExperienceLayer />
        <SiteChrome />
        {children}
      </body>
    </html>
  );
}
