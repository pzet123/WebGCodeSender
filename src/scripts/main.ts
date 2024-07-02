import { getJogButtonId, updateTextAreaScrollTop } from "./util.js";
import { Visualiser } from "./Visualiser.js";
import { MachineState } from "./MachineState.js";

// Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands
const BAUD_RATE = 115200;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

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

// Reference: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands#grbl-v11-realtime-commands
const CANCEL_JOG_COMMAND = new Uint8Array([0x85]);
const STATUS_REPORT_QUERY_COMMAND = TEXT_ENCODER.encode("?");

const UP_DIR = "up";
const DOWN_DIR = "down";
const LEFT_DIR = "left";
const RIGHT_DIR = "right";

const JOG_INCREMENT = 2;
const JOG_STATE = { [UP_DIR]: false, [DOWN_DIR]: false, [LEFT_DIR]: false, [RIGHT_DIR]: false };

let openedPort;
let machineState: MachineState;
let visualiser: Visualiser;

function init() {
    addEventListeners();
    machineState = new MachineState();
    updateCoordinateText();
    visualiser = new Visualiser(document.getElementById(VISUALISER_CONTAINER_ID) ?? document.body, machineState);
}

async function sendStatusCommand() {
    await writeCommand(openedPort, STATUS_REPORT_QUERY_COMMAND);
    setTimeout(async () => await sendStatusCommand(), 250);
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
    document.getElementById(SEND_GCODE_COMMAND_BUTTON_ID)?.addEventListener("click", () => sendTextCommand((<HTMLInputElement> document.getElementById(GCODE_COMMAND_TEXTBOX_ID))?.value));
    document.getElementById(getJogButtonId(UP_DIR))?.addEventListener("mousedown", () => startJog(UP_DIR));
    document.getElementById(getJogButtonId(DOWN_DIR))?.addEventListener("mousedown", () => startJog(DOWN_DIR));
    document.getElementById(getJogButtonId(LEFT_DIR))?.addEventListener("mousedown", () => startJog(LEFT_DIR));
    document.getElementById(getJogButtonId(RIGHT_DIR))?.addEventListener("mousedown", () => startJog(RIGHT_DIR));
    document.addEventListener("mouseup", () => {
        for (const direction in JOG_STATE) {
            if (JOG_STATE[direction]) {
                JOG_STATE[direction] = false;
            }
        }
    });
}

function openPort() {
    navigator.serial.requestPort().then((port) => {
        port.open({ baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: "none" }).then(() => {
            openedPort = port;
            beginReading();
            sendStatusCommand();
            const requestPortButton = document.getElementById(REQUEST_PORT_BUTTON_ID);
            if (requestPortButton) {
                requestPortButton.innerHTML = `Request port (currently open: {pid = ${port.getInfo().usbProductId}, vid = ${port.getInfo().usbVendorId}})`;
            }
        }).catch((e) => {
            alert(`Failed to open port: ${e}`);
        });
    }).catch((e) => {
        if (e.name != NOT_FOUND_ERROR_NAME) { // NotFoundError suggests request port prompt was dismissed by the user.
            console.log(`Failed to request port: ${e}`);
        }
    });
}

async function beginReading() {
    const commandHistoryTextareaHtml = <HTMLInputElement> document.getElementById(COMMAND_HISTORY_TEXTAREA_ID);
    while (openedPort.readable) {
        const reader = openedPort.readable.getReader();
        const dataBuffer: any[] = [];
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }
            dataBuffer.push(...value);
            if (dataBuffer[dataBuffer.length - 1] == "\n".charCodeAt(0)) {
                const output = TEXT_DECODER.decode(new Uint8Array(dataBuffer));
                if (output.indexOf("MPos:") === -1) {
                    if (commandHistoryTextareaHtml) {
                        commandHistoryTextareaHtml.value += output;
                    }
                    updateTextAreaScrollTop(COMMAND_HISTORY_TEXTAREA_ID)
                } else {
                    machineState.registerStatusReport(output);
                }
                dataBuffer.length = 0;
            }
          }
        } catch (e) {
          console.error(`Error while reading port: ${e}`);
        } finally {
          reader.releaseLock();
        }
      }
}

async function writeCommand(port, command: Uint8Array) {
    const writer = port.writable.getWriter();
    await writer.write(command);
    writer.releaseLock();
    machineState.registerCommand(command.toString());
}

async function sendTextCommand(commandText: string) {
    if (openedPort) {
        await writeCommand(openedPort, TEXT_ENCODER.encode(commandText + "\n"));
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

function startJog(direction: string) {
    if (openedPort) {
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
        jog(direction, `$J=G91 ${relative_coordinates} F300`);
    } else {
        alert(UNOPENED_PORT_ALERT_MESSAGE);
    }
}

function jog(direction: string, jogCommand: string) {
    const buttonElement = document.getElementById(getJogButtonId(direction));
    if (JOG_STATE[direction] && buttonElement?.matches(":hover")) {
        writeCommand(openedPort, TEXT_ENCODER.encode(jogCommand + "\n"));
        setTimeout(() => jog(direction, jogCommand), 100);
    } else {
        JOG_STATE[direction] = false;
        writeCommand(openedPort, CANCEL_JOG_COMMAND);
    }
}

init();