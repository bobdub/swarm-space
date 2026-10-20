import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isMediaOccluded } from '../mediaOcclusion';
describe('wall media line of sight', () => {
  it('occludes media behind solid avatars but ignores invisible click targets', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 5);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
    body.position.z = 2;
    scene.add(body);
    scene.updateMatrixWorld(true);
    const poster = new THREE.Vector3(0, 0, 0);
    expect(isMediaOccluded(scene, camera, poster)).toBe(true);
    body.material.transparent = true;
    body.material.opacity = 0;
    body.material.depthWrite = false;
    expect(isMediaOccluded(scene, camera, poster)).toBe(false);
    body.material.opacity = 1;
    body.material.depthWrite = true;
    body.visible = false;
    expect(isMediaOccluded(scene, camera, poster)).toBe(false);
    body.geometry.dispose();
    body.material.dispose();
  });
});