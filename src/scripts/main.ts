import { getJogButtonId } from "./util.js";
import { Visualiser } from "./Visualiser.js";
import { MachineState } from "./MachineState.js";
import * as GRBL from "./grbl.js";
import { Direction } from "./types.js";

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
const JOG_CANCEL_BUTTON_ID = "cancel-jog-btn";
const JOG_INCREMENT_SELECT_ID = "jog-increment-select";
const JOG_FEEDRATE_SELECT_ID = "jog-feedrate-select";
const SIMULATE_MOTION_CHECKBOX_ID = "simulate-motion-checkbox";

const NOT_FOUND_ERROR_NAME = "NotFoundError";

const UNOPENED_PORT_ALERT_MESSAGE = "You must open a port first!";

const DEFAULT_JOG_INCREMENT = 1;
const DEFAULT_JOG_FEEDRATE = 300;

let port;
let machineState: MachineState;
let visualiser: Visualiser;
let commandQueue: Uint8Array[];
let debounceTimeout;
let jogIncrement;
let jogFeedrate;

function init() {
    commandQueue = [];
    machineState = new MachineState();
    jogIncrement = DEFAULT_JOG_INCREMENT;
    jogFeedrate = DEFAULT_JOG_FEEDRATE;
    addEventListeners();
    updateCoordinateText();
    visualiser = new Visualiser(document.getElementById(VISUALISER_CONTAINER_ID) ?? document.body, machineState);
}

function updateCoordinateText() {
    const xCoordinateHtml = document.getElementById(VISUALISER_X_COORDINATE_ID);
    const yCoordinateHtml = document.getElementById(VISUALISER_Y_COORDINATE_ID);
    const zCoordinateHtml = document.getElementById(VISUALISER_Z_COORDINATE_ID);
    const digitsAfterDp = 2;
    if (xCoordinateHtml) {
        xCoordinateHtml.innerHTML = machineState.pos.x.toFixed(digitsAfterDp);
    }
    if (yCoordinateHtml) {
        yCoordinateHtml.innerHTML = machineState.pos.y.toFixed(digitsAfterDp);
    }
    if (zCoordinateHtml) {
        zCoordinateHtml.innerHTML = machineState.pos.z.toFixed(digitsAfterDp);
    }
    setTimeout(updateCoordinateText, 100);
}

function addEventListeners() {
    document.getElementById(REQUEST_PORT_BUTTON_ID)?.addEventListener("click", () => openPort());
    document.getElementById(SEND_GCODE_COMMAND_BUTTON_ID)?.addEventListener("click", () =>
                sendTextCommand((<HTMLInputElement> document.getElementById(GCODE_COMMAND_TEXTBOX_ID))?.value));
    document.getElementById(getJogButtonId(Direction.Up))?.addEventListener("mousedown", () => debounceJog(Direction.Up));
    document.getElementById(getJogButtonId(Direction.Down))?.addEventListener("mousedown", () => debounceJog(Direction.Down));
    document.getElementById(getJogButtonId(Direction.Left))?.addEventListener("mousedown", () => debounceJog(Direction.Left));
    document.getElementById(getJogButtonId(Direction.Right))?.addEventListener("mousedown", () => debounceJog(Direction.Right));
    document.getElementById(JOG_CANCEL_BUTTON_ID)?.addEventListener("mousedown", () => cancelJog());
    document.getElementById(JOG_INCREMENT_SELECT_ID)?.addEventListener("change", () =>
                jogIncrement = parseInt((<HTMLSelectElement> document.getElementById(JOG_INCREMENT_SELECT_ID))?.value ?? DEFAULT_JOG_INCREMENT));
    document.getElementById(JOG_FEEDRATE_SELECT_ID)?.addEventListener("change", () =>
                jogFeedrate = parseInt((<HTMLSelectElement> document.getElementById(JOG_FEEDRATE_SELECT_ID))?.value ?? DEFAULT_JOG_INCREMENT));
    document.getElementById(SIMULATE_MOTION_CHECKBOX_ID)?.addEventListener("change", () => machineState.toggleMotionSimulation());
}

async function debounceJog(direction: Direction, timeout = 200) {
    if (port) {
        clearInterval(debounceTimeout);
        debounceTimeout = setTimeout(() => jog(direction), timeout);
    } else {
        alert(UNOPENED_PORT_ALERT_MESSAGE);
    }
}

async function cancelJog() {
    await writeCommand(port, new Uint8Array([GRBL.CANCEL_JOG_COMMAND]));
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
        if (e.name !== NOT_FOUND_ERROR_NAME) { // NotFoundError suggests request port prompt was dismissed by the user.
            console.error(`Failed to request port: ${e}`);
        }
    }
}

async function setDefaultSettings(port) {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds to ensure controller is ready to accept commands.
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
                    await writeCommand(port, commandQueue.shift()!);
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
    await writeCommand(port, new Uint8Array([GRBL.STATUS_REPORT_QUERY_COMMAND]));
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

async function jog(direction: Direction) {
    let relativeCoordinates = "X0 Y0";
    switch (direction) {
        case Direction.Up:
            relativeCoordinates = `X0 Y${jogIncrement}`;
            break;
        case Direction.Down:
            relativeCoordinates = `X0 Y${-jogIncrement}`;
            break;
        case Direction.Left:
            relativeCoordinates = `X${-jogIncrement} Y0`;
            break;
        case Direction.Right:
            relativeCoordinates = `X${jogIncrement} Y0`;
            break;
    }
    await writeCommand(port, TEXT_ENCODER.encode(`$J=G91 ${relativeCoordinates} F${jogFeedrate}\n`));
}

init();