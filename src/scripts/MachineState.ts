import { parseCommand } from "./gcodeParser";
import { MotionMode, DistanceMode, UnitMode } from "./types";

const STATUS_REPORT_POS_REGEX = /-?[0-9]+\.[0-9]+,-?[0-9]+\.[0-9]+,=?[0-9]+\.[0-9]+/;

class MachineState {

    pos: {x: number, y: number, z: number};
    feedRate: number; // TODO: Implement feed rate
    distanceMode: DistanceMode;
    unitMode: UnitMode;
    motionMode: MotionMode;
    commandQueue: string[];

    constructor() {
        this.pos = { x: 0, y: 0, z: 0 };
        this.distanceMode = DistanceMode.Abs;
        this.motionMode = MotionMode.Linear;
        this.unitMode = UnitMode.Milimeter;
    }

    // Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface#status-reporting
    registerStatusReport(statusReport: string) {
        const coordinates = STATUS_REPORT_POS_REGEX.exec(statusReport)?.[0].split(",");
        if (coordinates) {
            this.pos.x = parseFloat(coordinates[0]);
            this.pos.y = parseFloat(coordinates[1]);
            this.pos.z = parseFloat(coordinates[2]);
        }
        STATUS_REPORT_POS_REGEX.lastIndex = 0;
    }

    // Reference: https://machmotion.com/downloads/GCode/Mach4-G-and-M-Code-Reference-Manual.pdf
    registerCommand(command: string) {
        if (command.startsWith("$")) {
            this.#registerSystemCommand(command);
        } else {
            try {
                const commandWords = parseCommand(command);
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
                console.error(`Command "${command}" not registered: ${e}`);
            }
        }
    }

    // Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands
    #registerSystemCommand(command: string) {
        if (command.startsWith("$J=")) {
            this.#registerJogCommand(command.substring(3));
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
            console.log(e);
        }
    }
}

export { MachineState };