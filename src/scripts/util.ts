import { Direction } from "./types";

export function getJogButtonId(direction: Direction): string {
    switch (direction) {
        case Direction.Up:
            return "up-jog-control-btn";
        case Direction.Down:
            return "down-jog-control-btn";
        case Direction.Left:
            return "left-jog-control-btn";
        case Direction.Right:
            return "right-jog-control-btn";
    }
}

// TODO: Avoid rubber-banding user if they want to scroll up
export function updateTextAreaScrollTop(textAreaId: string) {
    const textArea = document.getElementById(textAreaId);
    if (textArea) {
        textArea.scrollTop = textArea.scrollHeight;
    }
}
