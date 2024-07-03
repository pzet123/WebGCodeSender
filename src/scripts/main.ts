import { getJogButtonId } from "./util.js";
import { Visualiser } from "./Visualiser.js";
import { MachineState } from "./MachineState.js";
import * as GRBL from "./grbl.js";

// Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands
const BAUD_RATE = 115200;

const TEXT_ENCODER = new TextEncoder();

const GCODE_COMMAND_TEXTBOX_ID = "gcode-command-textbox";
const COMMAND_HISTORY_TEXTAREA_ID = "command-history-textarea";
const REQUEST_PORT_BUTTON_ID = "request-port-btn";
const SEND_GCODE_COMMAND_BUTTON_ID = "send-gcode-command-btn";
const VISUALISER_CONTAINER_ID = "visualiser-container";
const VISUALISER_X_COORDINATE_ID = "visualiser-x-coordinate";
const VISUALISER_Y_COORDINATE_ID = "visualiser-y-coordinate";
const VISUALISER_Z_COORDINATE_ID = "visualiser-z-coordinate";

const NOT_FOUND_ERROR_NAME = "NotFoundError";

const UNOPENED_PORT_ALERT_MESSAGE = "You must open a port first!";

const UP_DIR = "up";
const DOWN_DIR = "down";
const LEFT_DIR = "left";
const RIGHT_DIR = "right";

const JOG_INCREMENT = 2;
const JOG_STATE = { [UP_DIR]: false, [DOWN_DIR]: false, [LEFT_DIR]: false, [RIGHT_DIR]: false };

let port;
let machineState: MachineState;
let visualiser: Visualiser;
let commandQueue;

function init() {
    commandQueue = [];
    machineState = new MachineState();
    addEventListeners();
    updateCoordinateText();
    visualiser = new Visualiser(document.getElementById(VISUALISER_CONTAINER_ID) ?? document.body, machineState);
}

function updateCoordinateText() {
    const xCoordinateHtml = document.getElementById(VISUALISER_X_COORDINATE_ID);
    const yCoordinateHtml = document.getElementById(VISUALISER_Y_COORDINATE_ID);
    const zCoordinateHtml = document.getElementById(VISUALISER_Z_COORDINATE_ID);
    if (xCoordinateHtml) {
        xCoordinateHtml.innerHTML = machineState.pos.x.toString();
    }
    if (yCoordinateHtml) {
        yCoordinateHtml.innerHTML = machineState.pos.y.toString();
    }
    if (zCoordinateHtml) {
        zCoordinateHtml.innerHTML = machineState.pos.z.toString();
    }
    setTimeout(updateCoordinateText, 100);
}

function addEventListeners() {
    document.getElementById(REQUEST_PORT_BUTTON_ID)?.addEventListener("click", () => openPort());
    document.getElementById(SEND_GCODE_COMMAND_BUTTON_ID)?.addEventListener("click", async () =>
                            await sendTextCommand((<HTMLInputElement> document.getElementById(GCODE_COMMAND_TEXTBOX_ID))?.value));
    document.getElementById(getJogButtonId(UP_DIR))?.addEventListener("mousedown", async () => await startJog(UP_DIR));
    document.getElementById(getJogButtonId(DOWN_DIR))?.addEventListener("mousedown", async () => await startJog(DOWN_DIR));
    document.getElementById(getJogButtonId(LEFT_DIR))?.addEventListener("mousedown", async () => await startJog(LEFT_DIR));
    document.getElementById(getJogButtonId(RIGHT_DIR))?.addEventListener("mousedown", async () => await startJog(RIGHT_DIR));
    document.addEventListener("mouseup", () => {
        for (const direction in JOG_STATE) {
            if (JOG_STATE[direction]) {
                JOG_STATE[direction] = false;
            }
        }
    });
}

async function openPort() {
    try {
        port = await navigator.serial.requestPort()
        await port.open({ baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: "none" });
        await setDefaultSettings(port);
        beginReading(port); // Initiates reading loop
        pollStatus(port); // Initiates status poll loop
        const requestPortButton = document.getElementById(REQUEST_PORT_BUTTON_ID);
        if (requestPortButton) {
            requestPortButton.innerHTML = `Request port (currently open: {pid = ${port.getInfo().usbProductId}, vid = ${port.getInfo().usbVendorId}})`;
        }
    } catch (e) {
        if (e.name != NOT_FOUND_ERROR_NAME) { // NotFoundError suggests request port prompt was dismissed by the user.
            console.error(`Failed to request port: ${e}`);
        }
    }
}

async function setDefaultSettings(port) {
    await writeCommand(port, new TextEncoder().encode(`${GRBL.STATUS_REPORT_MASK_SETTING}=1\n`)); // Include machine position in status report
}

async function beginReading(port) {
    const commandHistoryTextareaHtml = <HTMLInputElement> document.getElementById(COMMAND_HISTORY_TEXTAREA_ID);
    const reader = port.readable.getReader();
    try {
        while (port.readable) {
            const messages = await GRBL.readBuffer(reader);
            if (!messages) {
                break;
            }
            for (const message of messages) {
                machineState.registerMessage(message);
                if (message.startsWith(GRBL.OK_MESSAGE) && commandQueue.length > 0) {
                    await writeCommand(port, commandQueue.pop());
                }
                commandHistoryTextareaHtml.value += message;
            }
        }
    } catch (e) {
        console.error(`Error reading buffer: ${e}`);
    } finally {
        reader.releaseLock();
    }
}

// Recommended max poll frequency is 5Hz (https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface#status-reporting)
async function pollStatus(port) {
    await writeCommand(port, GRBL.STATUS_REPORT_QUERY_COMMAND);
    setTimeout(async () => await pollStatus(port), 250);
}

async function writeCommand(port, command: Uint8Array) {
    if (machineState.commandWillOverflowBuffer(command)) { // Queue up commands that would otherwise potentially cause a buffer overflow
        commandQueue.push(command);
    } else {
        await GRBL.writeCommand(port, command);
        machineState.registerCommand(command);
    }
}

async function sendTextCommand(commandText: string) {
    if (port) {
        await writeCommand(port, TEXT_ENCODER.encode(commandText + "\n"));
        const gCodeCommandTextboxHtml = <HTMLInputElement> document.getElementById(GCODE_COMMAND_TEXTBOX_ID);
        const commandHistoryTextareaHtml = <HTMLInputElement> document.getElementById(COMMAND_HISTORY_TEXTAREA_ID);
        if (gCodeCommandTextboxHtml && commandHistoryTextareaHtml) {
            gCodeCommandTextboxHtml.value = "";
            commandHistoryTextareaHtml.value += `${commandText} < `
        }
    } else {
        alert(UNOPENED_PORT_ALERT_MESSAGE);
    }
}

async function startJog(direction: string) {
    if (port) {
        let relative_coordinates = "X0 Y0";
        switch (direction) {
            case "up":
                relative_coordinates = `X0 Y${JOG_INCREMENT}`;
                break;
            case "down":
                relative_coordinates = `X0 Y${-JOG_INCREMENT}`;
                break;
            case "left":
                relative_coordinates = `X${-JOG_INCREMENT} Y0`;
                break;
            case "right":
                relative_coordinates = `X${JOG_INCREMENT} Y0`;
                break;
        }
        JOG_STATE[direction] = true;
        await jog(direction, `$J=G91 ${relative_coordinates} F300`);
    } else {
        alert(UNOPENED_PORT_ALERT_MESSAGE);
    }
}

async function jog(direction: string, jogCommand: string) {
    const buttonElement = document.getElementById(getJogButtonId(direction));
    if (JOG_STATE[direction] && buttonElement?.matches(":hover")) {
        await writeCommand(port, TEXT_ENCODER.encode(jogCommand + "\n"));
        setTimeout(() => jog(direction, jogCommand), 100);
    } else {
        JOG_STATE[direction] = false;
        await writeCommand(port, GRBL.CANCEL_JOG_COMMAND);
    }
}

init();