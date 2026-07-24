import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import NextTopLoader from "nextjs-toploader";
import Script from "next/script";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "niXcriP",
  description: "Comprehensive CRM System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.className} ${geistMono.variable} h-full antialiased`}>
      <body className="font-sans min-h-full flex flex-col">
        {GA_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="ga-init" strategy="afterInteractive">{`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_ID}');
            `}</Script>
          </>
        )}
        <Providers>
          <NextTopLoader
            color="var(--foreground)"
            shadow={false}
            showSpinner={false}
            height={2}
          />
          <TooltipProvider>
            {children}
            <Toaster richColors />
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
