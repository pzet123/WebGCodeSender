export enum Direction {
    Up,
    Down,
    Left,
    Right
}

export type Vec2 = {
    x: number;
    y: number;
}

export type Vec3 = Vec2 & { z: number };