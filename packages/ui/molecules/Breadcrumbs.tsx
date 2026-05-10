import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const pathnames = pathname.split('/').filter((x) => x);

  if (pathnames.length === 0) return null;

  return (
    <nav className="flex items-center gap-1.5 text-sm text-zinc-400 font-medium">
      <Link 
        to="/dashboard" 
        className="flex items-center hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      
      {pathnames.map((name, index) => {
        const routeTo = `/${pathnames.slice(0, index + 1).join('/')}`;
        const isLast = index === pathnames.length - 1;
        
        // Capitalise and clean up name
        const displayName = name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');

        return (
          <div key={name} className="flex items-center gap-1.5">
            <ChevronRight className="h-3 w-3 shrink-0" />
            {isLast ? (
              <span className="text-zinc-900 dark:text-white font-semibold truncate max-w-[120px] sm:max-w-none">
                {displayName}
              </span>
            ) : (
              <Link
                to={routeTo}
                className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors truncate max-w-[100px] sm:max-w-none"
              >
                {displayName}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
