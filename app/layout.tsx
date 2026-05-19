import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, Inter } from "next/font/google";
import "./globals.css";
import { SiteHeader, SiteFooter } from "@/components/Brand";
import { EcosystemBar } from "@/components/EcosystemBar";

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  variable: "--font-ibm-plex-sans-thai",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Inter — clinical UI workhorse. Industry default for medical software,
// broad numeric weights for DICOM metadata. No display font swap; the page
// IS the tool (see projects/cuvetsmo-labs/01-visual-theme-directions.md).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://imaging.cuvetsmo.com"),
  title: {
    default: "CUVETSMO Imaging — DICOM viewer + AI overlays for vet students",
    template: "%s — CUVETSMO Imaging",
  },
  description:
    "CUVETSMO Imaging Lab — DICOM viewer with AI overlays for vet students at Chulalongkorn. Norberg angle, VHS, image occlusion, all in browser. Part of CUVETSMO Labs.",
  applicationName: "CUVETSMO Imaging",
  keywords: [
    "imaging lab",
    "dicom viewer",
    "norberg angle",
    "vhs",
    "vertebral heart score",
    "vet imaging",
    "veterinary radiology",
    "image occlusion",
    "cuvetsmo",
    "chulalongkorn vet",
  ],
  authors: [{ name: "CUVETSMO Labs" }],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "CUVETSMO Imaging — DICOM viewer + AI overlays for vet students",
    description:
      "CUVETSMO Imaging Lab — DICOM viewer, Norberg angle, VHS, image occlusion, all in browser. By Chula Vet students.",
    type: "website",
    locale: "th_TH",
    alternateLocale: ["en_US"],
    siteName: "CUVETSMO Imaging",
    url: "https://imaging.cuvetsmo.com",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "CUVETSMO Imaging — DICOM + AI overlays for vet students",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CUVETSMO Imaging — DICOM viewer + AI overlays for vet students",
    description: "CUVETSMO Imaging Lab — DICOM viewer, Norberg angle, VHS, image occlusion, all in browser.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
  alternates: { canonical: "https://imaging.cuvetsmo.com" },
};

// Organization schema teaches Google that imaging.cuvetsmo.com is a
// sub-organization of CUVETSMO. The bare-word search "cuvetsmo"
// should pick us up via alternateName + parentOrganization links.
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://imaging.cuvetsmo.com/#org",
  name: "CUVETSMO Imaging",
  alternateName: [
    "CUVETSMO Imaging",
    "cuvetsmo imaging",
    "Imaging Lab CUVETSMO",
    "imaging.cuvetsmo.com",
    "DICOM Viewer CUVETSMO",
    "Norberg Angle Tool CUVETSMO",
    "VHS Score Tool CUVETSMO",
    "CUVETSMO",
    "cuvetsmo",
  ],
  url: "https://imaging.cuvetsmo.com/",
  logo: "https://imaging.cuvetsmo.com/imaging-logo.png",
  image: "https://imaging.cuvetsmo.com/og.png",
  description:
    "DICOM viewer with AI overlays for veterinary students at Chulalongkorn University. Norberg angle, VHS score, image occlusion, runs entirely in browser.",
  parentOrganization: {
    "@type": "Organization",
    "@id": "https://cuvetsmo.com/#smo",
    name: "CUVETSMO",
    url: "https://cuvetsmo.com/",
  },
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "https://imaging.cuvetsmo.com/#website",
  name: "CUVETSMO Imaging",
  alternateName: ["cuvetsmo imaging", "Imaging Lab CUVETSMO"],
  url: "https://imaging.cuvetsmo.com/",
  inLanguage: ["th", "en"],
  publisher: { "@id": "https://imaging.cuvetsmo.com/#org" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${ibmPlexSansThai.variable} ${inter.variable} h-full antialiased`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
        <EcosystemBar current="imaging" />
        <SiteHeader />
        <main className="flex-1 w-full">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
