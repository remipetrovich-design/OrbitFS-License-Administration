import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'License Manager', description: 'Independent licensing, authority, deployment and release control plane' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
