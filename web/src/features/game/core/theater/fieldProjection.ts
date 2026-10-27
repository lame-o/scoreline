/**
 * The theaters' dimetric view (PlayTheater.swift `FieldProjection`): the
 * ground squashed to half height, heights at 0.82, the camera's framing
 * filling the view. Its own module so the football theater's chunk shares
 * the math without the baseball theater's drawing (mlb/theater/drawTheater.ts).
 */
import { CameraFrame } from "../../../../data/mlb/playCamera";
import type { Point, FieldPoint } from "../../../../data/mlb/theaterField";

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The dimetric (2:1) view of the field from behind home plate, through the
 * camera: the ground squashed to half height, heights at 0.82, the camera's
 * framing filling the view.
 */
export class FieldProjection {
  readonly size: Size;
  readonly camera: CameraFrame;
  /** Points per foot. */
  readonly scale: number;
  /** A standing figure's height in points: larger than life, growing with the zoom, never a speck, never a giant. */
  readonly figure: number;

  constructor(size: Size, camera: CameraFrame) {
    this.size = size;
    this.camera = camera;
    this.scale = Math.max(Math.min(size.height / camera.span, size.width / (camera.span * CameraFrame.aspect)), 0.05);
    this.figure = Math.min(Math.max(8.5 * this.scale, Math.max(10, size.height * 0.07)), Math.max(size.height * 0.18, 10));
  }

  point(p: Point, z = 0): Point {
    const { size, camera, scale } = this;
    return { x: size.width / 2 + (p.x - camera.x) * scale, y: size.height / 2 - (p.y * 0.5 + z * 0.82 - camera.y) * scale };
  }

  at(p: FieldPoint): Point {
    return this.point(p, p.z);
  }
}
