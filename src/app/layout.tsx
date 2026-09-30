import type { ReactNode } from "react";

export const metadata = {
  title: "perq",
  description: "Student discounts you're actually likely to qualify for.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
