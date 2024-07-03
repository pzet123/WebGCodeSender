import { parseCommand } from "./gcodeParser";
import * as GRBL from "./grbl";
import { MotionMode, DistanceMode, UnitMode } from "./types";

class MachineState {

    pos: {x: number, y: number, z: number};
    feedRate: number; // TODO: Implement feed rate
    distanceMode: DistanceMode;
    unitMode: UnitMode;
    motionMode: MotionMode;
    #bufferLineCharCounts: number[];
    #numOfCharsInBuffer: number

    constructor() {
        this.pos = { x: 0, y: 0, z: 0 };
        this.distanceMode = DistanceMode.Abs;
        this.motionMode = MotionMode.Linear;
        this.unitMode = UnitMode.Milimeter;
        this.#bufferLineCharCounts = [];
        this.#numOfCharsInBuffer = 0;
    }

    commandWillOverflowBuffer(command: Uint8Array) {
        return !GRBL.REALTIME_COMMANDS.has(command) && (this.#numOfCharsInBuffer + command.length) >= GRBL.CHAR_BUFFER_LIMIT;
    }

    registerMessage(message: string) {
        if (message.startsWith(GRBL.OK_MESSAGE) || message.startsWith(GRBL.ERROR_MESSAGE)) {
            this.#popBufferLine();
        } else if (message.indexOf("MPos:") != -1) {
            this.#registerStatusReport(message);
        }
    }

    // Reference: https://machmotion.com/downloads/GCode/Mach4-G-and-M-Code-Reference-Manual.pdf
    registerCommand(command: Uint8Array) {
        const textDecoder = new TextDecoder();
        const commandText = textDecoder.decode(command);
        if (commandText.startsWith("$")) {
            this.#pushBufferLine(command);
            this.#registerSystemCommand(commandText);
        } else if (GRBL.REALTIME_COMMANDS.has(command)) {
            // Do not place in buffer - "Realtime commands are intercepted when they are received and never placed in a buffer to be parsed by Grbl"
            // TODO: Handle registering realtime commands
        } else {
            this.#pushBufferLine(command);
            try {
                const commandWords = parseCommand(commandText);
                commandWords.forEach((word) => {
                    switch (word[0]) {
                        case "G":
                            this.#registerGCode(word.join(""));
                            break
                        case "X": case "Y": case "Z":
                            this.#registerMotion(word[0], word[1]);
                            break;
                        case "F":
                            this.feedRate = word[1];
                            break;
                    }
                });
            } catch (e) {
                console.error(`Command "${commandText}" not registered: ${e}`);
            }
        }
    }

    #pushBufferLine(command: Uint8Array) {
        this.#numOfCharsInBuffer += command.length;
        this.#bufferLineCharCounts.push(command.length);
    }

    #popBufferLine() {
        this.#numOfCharsInBuffer -= this.#bufferLineCharCounts.pop() ?? 0;
    }

    // Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface#status-reporting
    #registerStatusReport(statusReport: string) {
        const coordinates = GRBL.STATUS_REPORT_POS_REGEX.exec(statusReport)?.[0].split(",");
        if (coordinates) {
            this.pos.x = parseFloat(coordinates[0]);
            this.pos.y = parseFloat(coordinates[1]);
            this.pos.z = parseFloat(coordinates[2]);
        }
        GRBL.STATUS_REPORT_POS_REGEX.lastIndex = 0;
    }

    // Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands
    #registerSystemCommand(commandText: string) {
        if (commandText.startsWith("$J=")) {
            this.#registerJogCommand(commandText.substring(3));
        }
    }

    // TODO: Handle all g codes
    #registerGCode(gCode: string) {
        switch (gCode) {
            case "G0": case "G00":
                this.motionMode = MotionMode.Rapid;
                break
            case "G1": case "G01":
                this.motionMode = MotionMode.Linear;
                break;
        }
    }

    // TODO: Use motion commands to improve on the accuracy of the current tool position
    #registerMotion(axis: string, magnitude: number) {

    }

    // Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging
    #registerJogCommand(command: string) {
        let jogDistanceMode = this.distanceMode;
        let jogUnitMode = this.unitMode;
        let jogFeedRate = this.feedRate;
        try {
            const commandWords = parseCommand(command.substring(3));
            commandWords.forEach((word) => {
                switch (word[0]) {
                    case "G":
                        const gCode = word.join("");
                        if (gCode === "G20") {
                            jogUnitMode = UnitMode.Inch;
                        } else if (gCode === "G21") {
                            jogUnitMode = UnitMode.Milimeter;
                        } else if (gCode === "G90") {
                            jogDistanceMode = DistanceMode.Abs;
                        } else if (gCode === "G91") {
                            jogDistanceMode = DistanceMode.Inc;
                        }
                        break
                    case "X": case "Y": case "Z":
                            // TODO: Use jog commands to improve on the accuracy of the current tool position
                        break;
                    case "F":
                        jogFeedRate = word[1];
                        break;
                }
            });
        } catch (e) {
            console.error(`Invalid jog command: ${command}`);
        }
    }
}

export { MachineState };