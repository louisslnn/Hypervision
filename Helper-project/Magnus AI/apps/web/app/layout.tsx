import './globals.css';
import { TopNav } from '../components/TopNav';

export const metadata = {
  title: 'Magnus AI',
  description: 'Local-first post-game chess coaching',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <p>Not affiliated with Chess.com. Post-game analysis only.</p>
        </footer>
      </body>
    </html>
  );
}
