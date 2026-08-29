import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Ruko Guardian',
  description:
    'A trusted person’s control surface for a critical Ruko payment alert. Review the evidence, then keep the payment blocked or release it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
