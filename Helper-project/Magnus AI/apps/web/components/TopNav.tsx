import Link from 'next/link';
import { cookies } from 'next/headers';

import { USERNAME_COOKIE, decodeCookieValue } from '../lib/preferences';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/games', label: 'Games' },
  { href: '/insights', label: 'Insights' },
  { href: '/openings', label: 'Openings' },
  { href: '/time', label: 'Time' },
  { href: '/coach', label: 'Coach' },
  { href: '/settings', label: 'Settings' },
];

export function TopNav() {
  const cookieStore = cookies();
  const usernameCookie = cookieStore.get(USERNAME_COOKIE)?.value;
  const username = decodeCookieValue(usernameCookie);
  return (
    <header className="site-header">
      <div className="nav-brand">
        <span className="nav-logo">Magnus AI</span>
        <span className="nav-tag">Post-game only</span>
        {username ? (
          <span className="nav-user">Player: {username}</span>
        ) : (
          <Link className="nav-user nav-user-link" href="/settings">
            Set your username
          </Link>
        )}
      </div>
      <nav className="nav-links">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className="nav-link">
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
