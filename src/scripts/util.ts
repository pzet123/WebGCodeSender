import { Direction } from "./types";

function getJogButtonId(direction: Direction): string {
    switch (direction) {
        case Direction.UP:
            return "up-jog-control-btn";
        case Direction.DOWN:
            return "down-jog-control-btn";
        case Direction.LEFT:
            return "left-jog-control-btn";
        case Direction.RIGHT:
            return "right-jog-control-btn";
    }
}

// TODO: Avoid rubber-banding user if they want to scroll up
function updateTextAreaScrollTop(textAreaId: string) {
    const textArea = document.getElementById(textAreaId);
    if (textArea) {
        textArea.scrollTop = textArea.scrollHeight;
    }
}

export { getJogButtonId, updateTextAreaScrollTop };