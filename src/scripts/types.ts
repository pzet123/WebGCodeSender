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

export { DistanceMode, MotionMode, UnitMode, Direction }