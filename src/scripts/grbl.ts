// Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands
export const CANCEL_JOG_COMMAND = 0x85;
export const STATUS_REPORT_QUERY_COMMAND = 0x3F;

export const REALTIME_COMMANDS = new Set([STATUS_REPORT_QUERY_COMMAND, CANCEL_JOG_COMMAND]);

export const STATUS_REPORT_POS_REGEX = /-?[0-9]+\.[0-9]+,-?[0-9]+\.[0-9]+,-?[0-9]+\.[0-9]+/;
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