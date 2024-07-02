const GCODE_COMMENT_REGEX = /\(.*\)|;.*/g;

function parseCommand(command: string): [string, number][] {
    command = removeCommandComments(command);
    const commandWords = command.split(" ");
    return commandWords.map((commandWord) => tokenizeWord(commandWord));
}

function tokenizeWord(commandWord: string): [string, number] {
    let argument: number;
    let argumentStr = commandWord.substring(1);
    if (argumentStr.indexOf(".") === -1) {
        argument = parseInt(commandWord.substring(1));
    } else {
        argument = parseFloat(commandWord.substring(1));
    }
    return [commandWord.substring(0, 1), argument];
}

function removeCommandComments(command: string) {
    return command.replace(GCODE_COMMENT_REGEX, "");
}

export { parseCommand };