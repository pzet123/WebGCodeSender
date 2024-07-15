import { parseCommand } from "./gcodeParser";
import * as GRBL from "./grbl";
import { Vec2, Vec3 } from "./types";
import { arcAngle, arcLength, circumference } from "./mathUtil";

const SIMULATION_UPDATE_INTERVAL_MS = 25;

class MachineState {

    pos: Vec3;
    feedrate: number;
    distanceMode: GRBL.DistanceMode;
    arcCenterDistanceMode : GRBL.DistanceMode;
    unitMode: GRBL.UnitMode;
    motionMode: GRBL.MotionMode;
    state: GRBL.State;
    #bufferLineCharCounts: number[];
    #numOfCharsInBuffer: number;
    #simulationTimeoutId: number | undefined;
    #jogSimulationTimeoutId: number | undefined;
    #motionSimulationEnabled: boolean;
    #inMotion: boolean;
    #motionCommandQueue: Uint8Array[];

    // Default GCode modes: https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md#g---view-gcode-parser-state
    constructor() {
        this.pos = { x: 0, y: 0, z: 0 };
        this.distanceMode = GRBL.DistanceMode.Abs;
        this.arcCenterDistanceMode = GRBL.DistanceMode.Inc;
        this.motionMode = GRBL.MotionMode.Linear;
        this.unitMode = GRBL.UnitMode.Milimeter;
        this.state = GRBL.State.Idle;
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
        } else if (GRBL.STATUS_REPORT_REGEX.test(message)) {
            this.#registerStatusReport(message);
        }
    }

    // Reference: https://machmotion.com/downloads/GCode/Mach4-G-and-M-Code-Reference-Manual.pdf
    registerCommand(command: Uint8Array) {
        const textDecoder = new TextDecoder();
        const commandText = textDecoder.decode(command);
        const motionVec: Partial<Vec3> = {};
        let isMotionCommand = false;
        let arcRadius: number | undefined;
        let arcCenter: Partial<Vec2> = {};
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
                        case "R":
                            arcRadius = word[1];
                            break;
                        case "I":
                            arcCenter.x = word[1];
                            break;
                        case "J":
                            arcCenter.y = word[1];
                            break;
                        case "F":
                            this.feedrate = word[1];
                            break;
                    }
                });
                if (isMotionCommand && this.#motionSimulationEnabled) {
                    if (this.#inMotion) {
                        this.#motionCommandQueue.push(command);
                    } else {
                        this.#registerMotion(motionVec, arcRadius, arcCenter);
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
            this.#simulationTimeoutId = undefined;
            this.#jogSimulationTimeoutId = undefined;
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

        // Reference: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L476
        const stateMessage = GRBL.STATUS_REPORT_STATE_REGEX.exec(statusReport)?.[0];
        switch (stateMessage) {
            case "Idle":
                this.state = GRBL.State.Idle;
                break;
            case "Run":
                this.state = GRBL.State.Cycle;
                break;
            case "Hold":
                this.state = GRBL.State.Hold;
                break;
            case "Jog":
                this.state = GRBL.State.Jog;
                break;
            case "Home":
                this.state = GRBL.State.Homing;
                break;
            case "Alarm":
                this.state = GRBL.State.Alarm;
                break;
            case "Check":
                this.state = GRBL.State.CheckMode;
                break;
            case "Door":
                this.state = GRBL.State.SafetyDoor;
                break;
            case "Sleep":
                this.state = GRBL.State.Sleep;
                break;
        }
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
                if (this.#jogSimulationTimeoutId != null) {
                    this.#inMotion = false;
                    clearTimeout(this.#jogSimulationTimeoutId); // Cancel jog simulation upon cancelling jog
                    this.#jogSimulationTimeoutId = undefined;
                }
                this.#clearQueuedJogCommands();
                break;
        }
    }

    // TODO: Handle all g codes
    #registerGCode(gCode: string) {
        switch (gCode) {
            case "G0":
            case "G00":
                this.motionMode = GRBL.MotionMode.Rapid;
                break
            case "G1":
            case "G01":
                this.motionMode = GRBL.MotionMode.Linear;
                break;
            case "G2":
            case "G02":
                this.motionMode = GRBL.MotionMode.ClockwiseArc;
                break;
            case "G3":
            case "G03":
                this.motionMode = GRBL.MotionMode.CounterClockwiseArc;
                break;
        }
    }

    // TODO: Simulate acceleraton to avoid the tool visualiser rubber-banding at the beginning and end of the motion.
    #registerMotion(motionVec: Partial<Vec3>, arcRadius?: number, arcCenter?: Partial<Vec2>) {
        this.#inMotion = true;
        switch (this.motionMode) {
            case GRBL.MotionMode.Rapid:
                //TODO: Implement
                break;
            case GRBL.MotionMode.Linear:
                this.#beginLinearMotionSimulation(motionVec);
                break;
            case GRBL.MotionMode.ClockwiseArc:
                this.#beginArcMotionSimulation(motionVec, true, arcRadius, arcCenter);
                break;
            case GRBL.MotionMode.CounterClockwiseArc:
                this.#beginArcMotionSimulation(motionVec, false, arcRadius, arcCenter);
                break;
        }
    }

    #beginArcMotionSimulation(positionVec: Partial<Vec3>, isClockwise: boolean, arcRadius?: number, arcCenter?: Partial<Vec2>) {
        if (positionVec.x != null && positionVec.y != null) {
            if (this.distanceMode === GRBL.DistanceMode.Inc) {
                positionVec.x += this.pos.x;
                positionVec.y += this.pos.y;
            }
            if (arcRadius != null) {
                this.#beginRadiusArcMotionSimulation(positionVec as Vec3, isClockwise, arcRadius);
            } else if (arcCenter?.x != null && arcCenter?.y != null) {
                if (this.arcCenterDistanceMode === GRBL.DistanceMode.Inc) {
                    arcCenter.x += this.pos.x;
                    arcCenter.y += this.pos.y;
                }
                this.#beginCenterArcMotionSimulation(positionVec as Vec3, isClockwise, <Vec2> arcCenter);
            }
        }
    }

    // Reference implementation: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L696
    #beginRadiusArcMotionSimulation(targetPosVec: Vec3, isClockwise: boolean, arcRadius: number) {
        if (!(targetPosVec.x === this.pos.x && targetPosVec.y === this.pos.y)) {
            const targetVector = { x: targetPosVec.x - this.pos.x, y: targetPosVec.y - this.pos.y };
            const centerDispSquared = 4.0 * arcRadius ** 2 - targetVector.x ** 2 - targetVector.y ** 2;
            if (centerDispSquared >= 0) {
                let centerDispScaleFactor = -Math.sqrt(centerDispSquared) / Math.sqrt(targetVector.x ** 2 + targetVector.y ** 2);
                if (!isClockwise) {
                    centerDispScaleFactor = -centerDispScaleFactor;
                }
                if (arcRadius < 0) { // A negative radius in G Code is used to denote, out of the two possible arcs, pick the arc with angle > 180.
                    centerDispScaleFactor = -centerDispScaleFactor;
                }
                const centerX = this.pos.x + 0.5 * (targetVector.x - targetVector.y * centerDispScaleFactor);
                const centerY = this.pos.y + 0.5 * (targetVector.y + targetVector.x * centerDispScaleFactor);
                this.#beginCenterArcMotionSimulation(targetPosVec, isClockwise, { x: centerX, y: centerY });
            }
        }
    }

    #beginCenterArcMotionSimulation(targetPosVec: Vec3, isClockwise: boolean, arcCenter: Vec2) {
        const radius = Math.sqrt((targetPosVec.x - arcCenter.x) ** 2 + (targetPosVec.y - arcCenter.y) ** 2);
        const circum = circumference(radius);
        let totalDistance = arcLength({ x: this.pos.x, y: this.pos.y }, { x: targetPosVec.x, y: targetPosVec.y }, arcCenter);
        if (!isClockwise) {
            totalDistance = circum - totalDistance;
        }
        const arcStepLength = SIMULATION_UPDATE_INTERVAL_MS * (this.feedrate / 60000);
        const angleOfRotation = (Math.PI * 2 * arcStepLength) / circum;
        this.#simulateArcMotion({ x: this.pos.x, y: this.pos.y }, totalDistance, 0, isClockwise, arcCenter, angleOfRotation, arcStepLength);
    }

    #simulateArcMotion(currentPosVec: Vec2, totalDistance: number, distanceTravelled: number, isClockwise: boolean, arcCenter: Vec2, angleOfRotation: number, arcStepLength: number) {
        const xOffset = this.pos.x - arcCenter.x;
        const yOffset = this.pos.y - arcCenter.y;
        // Convert to polar coordinates for simpler rotation
        let angle = Math.atan2(yOffset, xOffset);
        const mag = Math.sqrt(xOffset ** 2 + yOffset ** 2);
        angle += isClockwise ? -angleOfRotation : angleOfRotation;
        // Convert back to planar coordinates
        const xInc = Math.cos(angle) * mag;
        const yInc = Math.sin(angle) * mag;
        this.pos.x = arcCenter.x + xInc;
        this.pos.y = arcCenter.y + yInc;
        distanceTravelled += arcStepLength;
        if (this.#motionSimulationEnabled) {
            if (distanceTravelled <= (totalDistance - arcStepLength)) {
                this.#simulationTimeoutId = setTimeout(
                    () => this.#simulateArcMotion(currentPosVec, totalDistance, distanceTravelled, isClockwise, arcCenter, angleOfRotation, arcStepLength),
                    SIMULATION_UPDATE_INTERVAL_MS);
            } else {
                this.#endMotion();
            }
        }
    }

    #beginLinearMotionSimulation(motionVec: Partial<Vec3>, isJog = false, feedrate?: number, distanceMode?: GRBL.DistanceMode) {
        feedrate ??= this.feedrate;
        distanceMode ??= this.distanceMode;
        if (distanceMode === GRBL.DistanceMode.Abs) {
            motionVec.x = motionVec.x != null ? motionVec.x - this.pos.x : 0;
            motionVec.y = motionVec.y != null ? motionVec.y - this.pos.y : 0;
            motionVec.z = motionVec.z != null ? motionVec.z - this.pos.z : 0;
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
            this.#simulateLinearMotion({ ...this.pos }, stepVec, stepDistance, totalDistance, isJog);
        }
    }

    #simulateLinearMotion(startVec: Vec3, stepVec: Vec3, stepDistance: number, totalDistance: number, isJog: boolean) {
        this.pos.x += stepVec.x;
        this.pos.y += stepVec.y;
        this.pos.z += stepVec.z;
        const distanceTravelled = Math.sqrt((this.pos.x - startVec.x) ** 2 + (this.pos.y - startVec.y) ** 2 + (this.pos.z - startVec.z) ** 2);
        if (this.#motionSimulationEnabled) {
            if (distanceTravelled < (totalDistance - stepDistance)) {
                const timeoutId = setTimeout(() =>
                    this.#simulateLinearMotion(startVec, stepVec, stepDistance, totalDistance, isJog),
                    SIMULATION_UPDATE_INTERVAL_MS);
                this.#setSimulationTimeoutId(timeoutId, isJog);
            } else {
                this.#endMotion();
            }
        }
    }

    #setSimulationTimeoutId(timeoutId: number, isJog = false) {
        if (isJog) {
            this.#jogSimulationTimeoutId = timeoutId;
        } else {
            this.#simulationTimeoutId = timeoutId;
        }
    }

    // Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging
    #registerJogCommand(command: Uint8Array) {
        const commandText = new TextDecoder().decode(command);
        let jogDistanceMode = this.distanceMode;
        let jogUnitMode = this.unitMode;
        let jogFeedrate = this.feedrate;
        let jogMotionVec: Partial<Vec3> = {};
        try {
            const commandWords = parseCommand(commandText.substring(3));
            commandWords.forEach((word) => {
                switch (word[0]) {
                    case "G":
                        const gCode = word.join("");
                        if (gCode === "G20") {
                            jogUnitMode = GRBL.UnitMode.Inch;
                        } else if (gCode === "G21") {
                            jogUnitMode = GRBL.UnitMode.Milimeter;
                        } else if (gCode === "G90") {
                            jogDistanceMode = GRBL.DistanceMode.Abs;
                        } else if (gCode === "G91") {
                            jogDistanceMode = GRBL.DistanceMode.Inc;
                        }
                        break;
                    case "X": case "Y": case "Z":
                        jogMotionVec[word[0].toLowerCase()] = word[1];
                        break;
                    case "F":
                        jogFeedrate = word[1];
                        break;
                }
            });
            if (this.#motionSimulationEnabled) {
                if (this.#inMotion) {
                    this.#motionCommandQueue.push(command);
                } else {
                    this.#inMotion = true;
                    this.#beginLinearMotionSimulation(jogMotionVec, true, jogFeedrate, jogDistanceMode);
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

    #endMotion() {
        this.#inMotion = false;
        if (this.#motionCommandQueue.length > 0) {
            this.registerCommand(this.#motionCommandQueue.shift()!);
        }
        this.#simulationTimeoutId = undefined;
        this.#jogSimulationTimeoutId = undefined;
    }
}

export { MachineState };