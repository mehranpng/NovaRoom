import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { AIChat } from "./AIChat";

function Router() {
    const [currentPath, setCurrentPath] = useState(window.location.pathname);

    useEffect(() => {
        const handlePopState = () => {
            setCurrentPath(window.location.pathname);
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const navigate = (path: string) => {
        window.history.pushState({}, '', path);
        setCurrentPath(path);
    };

    if (currentPath === '/aichat') {
        return <AIChat onBack={() => navigate('/')} />;
    }

    return <App />;
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Router />
    </StrictMode>
);
