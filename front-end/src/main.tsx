import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { App } from "./App";
import { installScrollbarAutohide } from "./utils/scrollbarAutohide";
import { initEmojiFont } from "./utils/emojiFont";

installScrollbarAutohide();
void initEmojiFont();

if (typeof window !== "undefined") {
    const preventPinchZoom = (e: Event) => {
        if ("touches" in e && (e as TouchEvent).touches.length > 1) {
            e.preventDefault();
        } else if (!("touches" in e)) {
            e.preventDefault();
        }
    };
    document.addEventListener("gesturestart", preventPinchZoom, { passive: false });
    document.addEventListener("gesturechange", preventPinchZoom, { passive: false });
    document.addEventListener("gestureend", preventPinchZoom, { passive: false });
    document.addEventListener("touchmove", preventPinchZoom, { passive: false });
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </StrictMode>
);
