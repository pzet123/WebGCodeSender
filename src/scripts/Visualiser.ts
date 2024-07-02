import * as THREE from "three";
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MachineState } from "./MachineState";

const CAMERA_POS = [0, 0, 100];
const DEFAULT_CAMERA_LOOK_AT = [0, 0, 0];
const CAMERA_FOV = 75;
const VISUALISER_CONTAINER_ID = "visualiser-container";
const RENDERER_WIDTH = document.getElementById(VISUALISER_CONTAINER_ID)?.clientWidth ?? window.innerWidth;
const RENDERER_HEIGHT = document.getElementById(VISUALISER_CONTAINER_ID)?.clientHeight ?? window.innerHeight / 2;
const CAMERA_ASPECT_RATIO = RENDERER_WIDTH / RENDERER_HEIGHT;
const NEAR_CLIPPING_PLANE_DIST = 0.1;
const FAR_CLIPPING_PLANE_DIST = 1000;

class Visualiser {

    #scene;
    #camera;
    #renderer;
    #controls;
    #tool;
    #machineState;

    constructor(container: HTMLElement, machineState: MachineState) {
        this.#machineState = machineState;
        this.#adjustAxes();
        this.#scene = this.#createScene();
        this.#camera = this.#createCamera();
        this.#renderer = this.#createRenderer();
        container.appendChild(this.#renderer.domElement);
        this.#renderer.setAnimationLoop(() => this.#render());
        this.#controls = this.#createControls();
        this.#tool = this.#createTool();
        this.#initialiseScene();
    }

    #updateToolPos() {
        this.#tool.position.x = this.#machineState.pos.x;
        this.#tool.position.y = this.#machineState.pos.y;
        this.#tool.position.z = this.#machineState.pos.z + this.#tool.geometry.parameters.height / 2;
    }

    #adjustAxes() {
        THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0,0,1);
    }

    #createScene() {
        return new THREE.Scene();
    }

    #createCamera() {
        const camera = new THREE.PerspectiveCamera(CAMERA_FOV, CAMERA_ASPECT_RATIO, NEAR_CLIPPING_PLANE_DIST, FAR_CLIPPING_PLANE_DIST);
        camera.position.set(...CAMERA_POS);
        camera.lookAt(...DEFAULT_CAMERA_LOOK_AT);
        return camera;
    }

    #createRenderer() {
        const renderer = new THREE.WebGLRenderer();
        renderer.setSize(RENDERER_WIDTH, RENDERER_HEIGHT);
        renderer.physicallyCorrectLights = true;
        return renderer;
    }

    #createControls() {
        return new OrbitControls(this.#camera, this.#renderer.domElement);
    }

    #createTool() {
        const toolGeometry = new THREE.ConeGeometry(5, 16, 5);
        const toolMaterial = new THREE.MeshBasicMaterial({color: 0xffff00});
        const toolMesh = new THREE.Mesh(toolGeometry, toolMaterial);
        toolMesh.rotation.set(-Math.PI / 2, 0, 0);
        return toolMesh;
    }

    #createAxes() {
        return new THREE.AxesHelper(1000);
    }

    #initialiseScene() {
        this.#scene.add(this.#tool, this.#createAxes());
    }

    #render() {
        this.#renderer.render(this.#scene, this.#camera);
        this.#updateToolPos();
    }
}

export { Visualiser };