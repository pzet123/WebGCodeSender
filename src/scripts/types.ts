enum Direction {
    UP,
    DOWN,
    LEFT,
    RIGHT
}

enum DistanceMode {
    Abs,
    Inc
}

enum MotionMode {
    Rapid,
    Linear,
    ClockwiseArc,
    CounterClockwiseArc
}

enum UnitMode {
    Inch,
    Milimeter
}

type Vec3 = {
    x: number;
    y: number;
    z: number;
};

export { DistanceMode, MotionMode, UnitMode, Direction, Vec3 }