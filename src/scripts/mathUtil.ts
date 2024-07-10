import { Vec2 } from "./types"

export function arcLength(startPoint: Vec2, endPoint: Vec2, centerPoint: Vec2): number {
    const radius = Math.sqrt((startPoint.x - centerPoint.x) ** 2 + (startPoint.y - centerPoint.y) ** 2);
    if (startPoint.x === endPoint.x && startPoint.y === endPoint.y) {
        return Math.PI * radius * 2;
    } else {
        return (arcAngle(startPoint, endPoint, centerPoint) / (Math.PI * 2)) * (Math.PI * radius * 2);
    }
}

// Returns an angle within (0, 2PI]
export function arcAngle(startPoint: Vec2, endPoint: Vec2, centerPoint: Vec2): number {
    const startVec = { x: startPoint.x - centerPoint.x, y: startPoint.y - centerPoint.y };
    const startVecMag = Math.sqrt(startVec.x ** 2 + startVec.y ** 2);
    const endVec = { x: endPoint.x - centerPoint.x, y: endPoint.y - centerPoint.y };
    const endVecMag = Math.sqrt(endVec.x ** 2 + endVec.y ** 2);
    const dp = dotProduct2D(startVec, endVec);
    const cp = crossProduct2D(startVec, endVec);
    if (cp < 0) {
        return Math.acos(dp / (startVecMag * endVecMag));
    } else if (cp > 0) {
        return Math.PI + Math.acos(dp / (startVecMag * endVecMag))
    } else {
        return (startVec.x === endVec.x && startVec.y === endVec.y) ? Math.PI * 2 : Math.PI;
    }
}

export function circumference(radius: number): number {
    return Math.PI * radius * 2;
}

export function dotProduct2D(vecA: Vec2, vecB: Vec2): number {
    return (vecA.x * vecB.x) + (vecA.y * vecB.y);
}

export function crossProduct2D(vecA: Vec2, vecB: Vec2): number {
    return (vecA.x * vecB.y) - (vecA.y * vecB.x);
}