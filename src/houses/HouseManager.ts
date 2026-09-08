import type { HouseInstance } from "../types";
import { CesiumScene } from "../cesium/CesiumScene";

export const DEFAULT_HOUSE_URL = "/models/bungalow.glb";
//export const DEFAULT_HOUSE_URL = "/models/sample-house.glb";

export class HouseManager {
  constructor(private scene: CesiumScene) {}

  async placeDefault(location: {
    latitude: number;
    longitude: number;
    height?: number;
  }) {
    const instance: HouseInstance = {
      latitude: location.latitude,
      longitude: location.longitude,
      height: location.height ?? 0,
      headingDeg: 0,
      scale: 1,
    };
    await this.scene.placeHouse(
      DEFAULT_HOUSE_URL,
      instance.longitude,
      instance.latitude,
      instance.height,
    );
    return instance;
  }

  setHeading(degrees: number) {
    this.scene.setHouseTransform(degrees);
  }
}
