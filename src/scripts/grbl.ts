// Reference: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.h#L76
export enum State {
    Idle,
    Alarm,
    CheckMode,
    Homing,
    Cycle,
    Hold,
    Jog,
    SafetyDoor,
    Sleep
}

export enum DistanceMode {
    Abs,
    Inc
}

export enum MotionMode {
    Rapid,
    Linear,
    ClockwiseArc,
    CounterClockwiseArc
}

export enum UnitMode {
    Inch,
    Milimeter
}

// Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands
export const CANCEL_JOG_COMMAND = 0x85;
export const STATUS_REPORT_QUERY_COMMAND = 0x3F;

export const REALTIME_COMMANDS = new Set([STATUS_REPORT_QUERY_COMMAND, CANCEL_JOG_COMMAND]);

export const STATUS_REPORT_REGEX = /<[A-Z][a-z]+.*>/;
export const STATUS_REPORT_POS_REGEX = /-?[0-9]+\.[0-9]+,-?[0-9]+\.[0-9]+,-?[0-9]+\.[0-9]+/;
export const STATUS_REPORT_STATE_REGEX = /[A-Z][a-z]+/

export const CHAR_BUFFER_LIMIT = 128;

export const OK_MESSAGE = "ok";
export const ERROR_MESSAGE = "error";

export const STATUS_REPORT_MASK_SETTING = "$10";

export const JOG_COMMAND_PREFIX = "$J=";

export async function readBuffer(reader): Promise<string[] | undefined> {
    const textDecoder = new TextDecoder();
    const dataBuffer: any[] = [];
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        dataBuffer.push(...value);
        if (dataBuffer[dataBuffer.length - 1] == "\n".charCodeAt(0)) {
            const output = textDecoder.decode(new Uint8Array(dataBuffer));
            return output.split("\n");
        }
    }
}

export async function writeCommand(port, command: Uint8Array) {
    while (port.writable.locked) {
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    const writer = port.writable.getWriter();
    await writer.write(command);
    writer.releaseLock();
}