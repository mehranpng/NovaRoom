import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { App } from "./App";
import { COMMON_IOS_EMOJIS_TO_PRELOAD, preloadIosEmojiAssets } from "./components/IosEmoji";

void preloadIosEmojiAssets(COMMON_IOS_EMOJIS_TO_PRELOAD);

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </StrictMode>
);
