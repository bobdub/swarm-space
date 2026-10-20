import * as THREE from 'three';

/** Ignore invisible click targets and private transparent previews. */
export function isMediaOccluded(scene: THREE.Scene, camera: THREE.Camera, point: THREE.Vector3): boolean {
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const distance = origin.distanceTo(point);
  if (distance < 0.001) return false;
  const ray = new THREE.Raycaster(origin, point.clone().sub(origin).normalize(), 0, distance - 0.005);
  return ray.intersectObjects(scene.children, true).some(({ object, face }) => {
    if (!(object instanceof THREE.Mesh)) return false;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (!parent.visible) return false;
    }
    const material = Array.isArray(object.material) ? object.material[face?.materialIndex ?? 0] : object.material;
    return Boolean(material?.visible && material.depthWrite && material.opacity >= 0.95);
  });
}