import { Link, useLocation } from 'react-router-dom';
import { Calculator as CalculatorIcon, CircleUser, Info, NotebookPen, Users } from 'lucide-react';
import { backendEnabled } from '../config/platform';

// `within` lists the screens reached from a tab, so the tab stays lit while you are on them.
const CALCULATE = { to: '/', label: 'Calculate', Icon: CalculatorIcon };
const MY_YIELDS = { to: '/manage-data', label: 'My yields', Icon: NotebookPen };

const TABS = backendEnabled
  ? [
      CALCULATE,
      MY_YIELDS,
      { to: '/community-data', label: 'Community', Icon: Users },
      {
        to: '/account',
        label: 'Account',
        Icon: CircleUser,
        within: ['/login', '/profile', '/upload', '/data-sources', '/about'],
      },
    ]
  : [
      // No API to talk to (the store build): nothing to sign in to and no community yields
      CALCULATE,
      MY_YIELDS,
      { to: '/about', label: 'About', Icon: Info, within: ['/account', '/upload', '/data-sources'] },
    ];

function currentFor(tab, pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === tab.to) return 'page';
  return tab.within?.includes(path) ? 'true' : undefined;
}

/**
 * The whole of the app's navigation: Calculate · My yields · Community · Account.
 * One <nav>, drawn by `.tabbar` as a bar on the bottom edge of a phone (icon over label) and as
 * a row of text in the top bar from 768px. Render it inside the app header.
 */
export default function TabBar() {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Main" className="tabbar">
      {TABS.map((tab) => {
        const current = currentFor(tab, pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className="tab"
            aria-current={current}
            // Tapping the tab you are on takes you back to the top of it
            onClick={current === 'page' ? () => window.scrollTo(0, 0) : undefined}
          >
            <tab.Icon aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
