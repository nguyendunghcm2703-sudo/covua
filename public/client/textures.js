// Texture cho Three.js: vẽ bằng canvas (art.js) nên không cần tải file ảnh.

import * as THREE from 'three';
import { paintTable, paintBoard, paintTray, boardSize } from './art.js';

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(canvas, renderer) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export function makeTableTexture(renderer) {
  const c = canvasOf(512, 512);
  paintTable(c.getContext('2d'), 512, 512);
  const tex = finish(c, renderer);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  return tex;
}

export function makeTrayTexture(renderer) {
  const c = canvasOf(256, 256);
  paintTray(c.getContext('2d'), 256, 256);
  return finish(c, renderer);
}

export function makeBoardTexture(renderer) {
  const u = 160;
  const { W, H } = boardSize(u);
  const c = canvasOf(W, H);
  paintBoard(c.getContext('2d'), u);
  return finish(c, renderer);
}

export function clearPieceTextures() {}
