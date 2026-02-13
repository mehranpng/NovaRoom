import { useState, useEffect, createContext, useContext } from 'react';
import { App } from './App';
import { AIChat } from './AIChat';

type Route = '/' | '/aichat';

interface NavigationContextType {
    navigate: (path: Route) => void;
    currentPath: Route;
}

const NavigationContext = createContext<NavigationContextType>({
    navigate: () => {},
    currentPath: '/',
});

export const useNavigation = () => useContext(NavigationContext);

export function AppRouter() {
    const [currentPath, setCurrentPath] = useState<Route>(() => {
        const path = window.location.pathname;
        return path === '/aichat' ? '/aichat' : '/';
    });

    useEffect(() => {
        const handlePopState = () => {
            const path = window.location.pathname;
            setCurrentPath(path === '/aichat' ? '/aichat' : '/');
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const navigate = (path: Route) => {
        if (path === currentPath) return;
        window.history.pushState({}, '', path);
        setCurrentPath(path);
    };

    const contextValue: NavigationContextType = {
        navigate,
        currentPath,
    };

    return (
        <NavigationContext.Provider value={contextValue}>
            {currentPath === '/aichat' ? (
                <AIChat onBack={() => navigate('/')} />
            ) : (
                <App />
            )}
        </NavigationContext.Provider>
    );
}
