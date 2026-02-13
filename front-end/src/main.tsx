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

    if (currentPath === '/aichat') {
        return <AIChat />;
    }

    return <App />;
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Router />
    </StrictMode>
);
