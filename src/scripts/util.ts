function getJogButtonId(direction: string) {
    return `${direction}-jog-control-btn`;
}

// TODO: Avoid rubber-banding user if they want to scroll up
function updateTextAreaScrollTop(textAreaId: string) {
    const textArea = document.getElementById(textAreaId);
    if (textArea) {
        textArea.scrollTop = textArea.scrollHeight;
    }
}

export { getJogButtonId, updateTextAreaScrollTop };