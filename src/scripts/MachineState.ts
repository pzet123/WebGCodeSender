import { parseCommand } from "./gcodeParser";
import * as GRBL from "./grbl";
import { MotionMode, DistanceMode, UnitMode, Vec3 } from "./types";

const SIMULATION_UPDATE_INTERVAL_MS = 25;

class MachineState {

    pos: Vec3;
    feedRate: number;
    distanceMode: DistanceMode;
    unitMode: UnitMode;
    motionMode: MotionMode;
    #bufferLineCharCounts: number[];
    #numOfCharsInBuffer: number;
    #simulationTimeoutId: number;
    #motionSimulationEnabled: boolean;
    #inMotion: boolean;
    #motionCommandQueue: Uint8Array[];

    constructor() {
        this.pos = { x: 0, y: 0, z: 0 };
        this.distanceMode = DistanceMode.Abs;
        this.motionMode = MotionMode.Linear;
        this.unitMode = UnitMode.Milimeter;
        this.#bufferLineCharCounts = [];
        this.#numOfCharsInBuffer = 0;
        this.#motionSimulationEnabled = false;
        this.#inMotion = false;
        this.#motionCommandQueue = [];
    }

    commandWillOverflowBuffer(command: Uint8Array) {
        return !this.#isRealtimeCommand(command) && (this.#numOfCharsInBuffer + command.length) >= GRBL.CHAR_BUFFER_LIMIT;
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
        const motionVec: Partial<Vec3> = {};
        let isMotionCommand = false;
        if (commandText.startsWith("$")) {
            this.#pushBufferLine(command);
            this.#registerSystemCommand(command);
        } else if (this.#isRealtimeCommand(command)) {
            // Do not place in buffer - "Realtime commands are intercepted when they are received and never placed in a buffer to be parsed by Grbl"
            this.#registerRealtimeCommand(command[0]); // Realtime commands are always a single character
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
                            motionVec[word[0].toLowerCase()] = word[1];
                            isMotionCommand = true;
                            break;
                        case "F":
                            this.feedRate = word[1];
                            break;
                    }
                });
                if (isMotionCommand && this.#motionSimulationEnabled) {
                    if (this.#inMotion) {
                        this.#motionCommandQueue.push(command);
                    } else {
                        this.#registerMotion(motionVec);
                    }
                }
            } catch (e) {
                console.error(`Command "${commandText}" not registered: ${e}`);
            }
        }
    }

    toggleMotionSimulation () {
        if (this.#motionSimulationEnabled) {
            this.#inMotion = false;
            this.#motionCommandQueue.length = 0;
        }
        this.#motionSimulationEnabled = !this.#motionSimulationEnabled;
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
    #registerSystemCommand(command: Uint8Array) {
        const commandText = new TextDecoder().decode(command);
        if (commandText.startsWith(GRBL.JOG_COMMAND_PREFIX)) {
            this.#registerJogCommand(command);
        }
    }

    #registerRealtimeCommand(command: number) {
        switch (command) {
            case GRBL.CANCEL_JOG_COMMAND:
                this.#inMotion = false;
                clearTimeout(this.#simulationTimeoutId); // Cancel simulation upon cancelling jog
                this.#clearQueuedJogCommands();
                break;
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

    // TODO: Simulate acceleraton to avoid the tool visualiser rubber-banding at the beginning and end of the motion.
    #registerMotion(motionVec: Partial<Vec3>) {
        switch (this.motionMode) {
            case MotionMode.Rapid:
                //TODO: Implement
                break;
            case MotionMode.Linear:
                this.#beginLinearMotionSimulation(motionVec);
                break;
            case MotionMode.ClockwiseArc:
                //TODO: Implement
                break;
            case MotionMode.CounterClockwiseArc:
                //TODO: Implement
                break;
        }
    }

    #beginLinearMotionSimulation(motionVec: Partial<Vec3>, feedrate?: number, distanceMode?: DistanceMode) {
        this.#inMotion = true;
        feedrate ??= this.feedRate;
        distanceMode ??= this.distanceMode;
        if (distanceMode === DistanceMode.Abs) {
            motionVec.x = motionVec.x !== undefined ? motionVec.x - this.pos.x : 0;
            motionVec.y = motionVec.y !== undefined ? motionVec.y - this.pos.y : 0;
            motionVec.z = motionVec.z !== undefined ? motionVec.z - this.pos.z : 0;
        } else {
            motionVec.x ??= 0;
            motionVec.y ??= 0;
            motionVec.z ??= 0;
        }
        const totalDistance = Math.sqrt(motionVec.x ** 2 + motionVec.y ** 2 + motionVec.z ** 2);
        if (totalDistance > 0) {
            const feedratePerMs = feedrate / 60000; // Convert from per minute to per millisecond
            const axesFeedrate = { x: (motionVec.x / totalDistance) * feedratePerMs, y: (motionVec.y / totalDistance) * feedratePerMs, z: (motionVec.z / totalDistance) * feedratePerMs };
            const stepVec = { x: axesFeedrate.x * SIMULATION_UPDATE_INTERVAL_MS, y: axesFeedrate.y * SIMULATION_UPDATE_INTERVAL_MS, z: axesFeedrate.z * SIMULATION_UPDATE_INTERVAL_MS };
            const stepDistance = Math.sqrt(stepVec.x ** 2 + stepVec.y ** 2 + stepVec.z ** 2);
            this.#simulateLinearMotion({ ...this.pos }, stepVec, stepDistance, totalDistance, 0);
        }
    }

    #simulateLinearMotion(startVec: Vec3, stepVec: Vec3, stepDistance: number, totalDistance: number, distanceTravelled: number) {
        this.#simulationTimeoutId = setTimeout(() => {
            this.pos.x += stepVec.x;
            this.pos.y += stepVec.y;
            this.pos.z += stepVec.z;
            distanceTravelled = Math.sqrt((this.pos.x - startVec.x) ** 2 + (this.pos.y - startVec.y) ** 2 + (this.pos.z - startVec.z) ** 2);
            if (this.#motionSimulationEnabled) {
                if (distanceTravelled < (totalDistance - stepDistance)) {
                    this.#simulateLinearMotion(startVec, stepVec, stepDistance, totalDistance, distanceTravelled);
                } else {
                    this.#inMotion = false;
                    if (this.#motionCommandQueue.length > 0) {
                        this.registerCommand(this.#motionCommandQueue.shift()!);
                    }
                }
            }
        }, SIMULATION_UPDATE_INTERVAL_MS);
    }

    // Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging
    #registerJogCommand(command: Uint8Array) {
        const commandText = new TextDecoder().decode(command);
        let jogDistanceMode = this.distanceMode;
        let jogUnitMode = this.unitMode;
        let jogFeedRate = this.feedRate;
        let jogMotionVec: Partial<Vec3> = {};
        try {
            const commandWords = parseCommand(commandText.substring(3));
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
                        break;
                    case "X": case "Y": case "Z":
                        jogMotionVec[word[0].toLowerCase()] = word[1];
                        break;
                    case "F":
                        jogFeedRate = word[1];
                        break;
                }
            });
            if (this.#motionSimulationEnabled) {
                if (this.#inMotion) {
                    this.#motionCommandQueue.push(command);
                } else {
                    this.#beginLinearMotionSimulation(jogMotionVec, jogFeedRate, jogDistanceMode);
                }
            }
        } catch (e) {
            console.error(`Invalid jog command: ${command}`);
        }
    }

    #isRealtimeCommand(command: Uint8Array) {
        return command.length === 1 && GRBL.REALTIME_COMMANDS.has(command[0]);
    }

    // Removes all queued jog commands from motion command queue
    #clearQueuedJogCommands() {
        const textDecoder = new TextDecoder();
        this.#motionCommandQueue = this.#motionCommandQueue.filter((command) =>
            !textDecoder.decode(command).startsWith(GRBL.JOG_COMMAND_PREFIX));
    }
}

export { MachineState };