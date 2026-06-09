#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

const outDir = path.resolve(import.meta.dirname, '..', 'public', 'assets', 'agent-office')
const outFile = path.join(outDir, 'agent-avatar.glb')

if (!globalThis.FileReader) {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer()
        .then(buffer => {
          this.result = buffer
          this.onloadend?.({ target: this })
        })
        .catch(error => {
          this.error = error
          this.onerror?.(error)
        })
    }
  }
}

function mat(color, roughness = 0.78, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function box(name, size, material, position = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.name = name
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function capsule(name, radius, length, material, position = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.65, length + radius * 2, radius * 1.65), material)
  mesh.name = name
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function createNode(name, position = [0, 0, 0]) {
  const node = new THREE.Group()
  node.name = name
  node.position.set(...position)
  return node
}

function createAvatar() {
  const root = createNode('AvatarRoot', [0, 0, 0])
  const hips = createNode('Hips', [0, 1.18, 0])
  const torso = createNode('Torso', [0, 0.56, 0])
  const chest = createNode('Chest', [0, 0.44, 0])
  const neck = createNode('Neck', [0, 0.35, 0])
  const head = createNode('Head', [0, 0.22, 0])
  const leftUpperArm = createNode('LeftUpperArm', [-0.36, 0.31, 0])
  const leftForeArm = createNode('LeftForeArm', [0, -0.38, 0])
  const rightUpperArm = createNode('RightUpperArm', [0.36, 0.31, 0])
  const rightForeArm = createNode('RightForeArm', [0, -0.38, 0])
  const leftThigh = createNode('LeftThigh', [-0.16, -0.18, 0])
  const leftShin = createNode('LeftShin', [0, -0.46, 0])
  const rightThigh = createNode('RightThigh', [0.16, -0.18, 0])
  const rightShin = createNode('RightShin', [0, -0.46, 0])

  root.add(hips)
  hips.add(torso, leftThigh, rightThigh)
  torso.add(chest)
  chest.add(neck, leftUpperArm, rightUpperArm)
  neck.add(head)
  leftUpperArm.add(leftForeArm)
  rightUpperArm.add(rightForeArm)
  leftThigh.add(leftShin)
  rightThigh.add(rightShin)

  const suit = mat(0x1f2937)
  const shirt = mat(0xf8fafc)
  const accent = mat(0x0ea5e9, 0.56)
  const skin = mat(0xf2c9a0)
  const hair = mat(0x111827)
  const screen = mat(0x22c55e, 0.42, 0.12)
  const sole = mat(0x0f172a)

  hips.add(box('PelvisMesh', [0.42, 0.28, 0.24], suit, [0, 0, 0]))
  torso.add(box('TorsoMesh', [0.58, 0.72, 0.28], suit, [0, 0.1, 0]))
  torso.add(box('ShirtPanel', [0.22, 0.66, 0.02], shirt, [0, 0.11, -0.145]))
  torso.add(box('TiePanel', [0.06, 0.44, 0.024], accent, [0, 0.02, -0.162]))
  chest.add(box('StatusBadge', [0.2, 0.1, 0.026], screen, [0.2, 0.07, -0.17]))
  head.add(capsule('HeadMesh', 0.18, 0.1, skin, [0, 0.02, 0]))
  head.add(box('HairCap', [0.33, 0.1, 0.29], hair, [0, 0.17, 0.01]))
  head.add(box('FaceVisor', [0.22, 0.045, 0.022], accent, [0, 0.03, -0.18]))

  leftUpperArm.add(capsule('LeftUpperArmMesh', 0.065, 0.34, suit, [0, -0.18, 0]))
  leftForeArm.add(capsule('LeftForeArmMesh', 0.058, 0.32, skin, [0, -0.16, 0]))
  leftForeArm.add(box('LeftHandMesh', [0.11, 0.08, 0.08], skin, [0, -0.34, -0.02]))
  rightUpperArm.add(capsule('RightUpperArmMesh', 0.065, 0.34, suit, [0, -0.18, 0]))
  rightForeArm.add(capsule('RightForeArmMesh', 0.058, 0.32, skin, [0, -0.16, 0]))
  rightForeArm.add(box('RightHandMesh', [0.11, 0.08, 0.08], skin, [0, -0.34, -0.02]))

  leftThigh.add(capsule('LeftThighMesh', 0.075, 0.42, suit, [0, -0.23, 0]))
  leftShin.add(capsule('LeftShinMesh', 0.065, 0.4, suit, [0, -0.2, 0]))
  leftShin.add(box('LeftShoeMesh', [0.16, 0.08, 0.27], sole, [0, -0.44, -0.07]))
  rightThigh.add(capsule('RightThighMesh', 0.075, 0.42, suit, [0, -0.23, 0]))
  rightShin.add(capsule('RightShinMesh', 0.065, 0.4, suit, [0, -0.2, 0]))
  rightShin.add(box('RightShoeMesh', [0.16, 0.08, 0.27], sole, [0, -0.44, -0.07]))
  root.add(box('ShadowPad', [0.76, 0.025, 0.5], mat(0x94a3b8), [0, 0.04, 0.02]))
  root.traverse(child => {
    child.userData.agentOfficeAsset = true
  })
  return root
}

function quat(euler) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler))
}

function qTrack(name, times, values) {
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values.flatMap(value => quat(value).toArray()))
}

function vTrack(name, times, values) {
  return new THREE.VectorKeyframeTrack(`${name}.position`, times, values.flat())
}

function clip(name, duration, tracks) {
  const animation = new THREE.AnimationClip(name, duration, tracks)
  animation.optimize()
  return animation
}

function createClips() {
  const loop = [0, 0.5, 1]
  return [
    clip('Idle', 2, [
      vTrack('AvatarRoot', [0, 1, 2], [[0, 0, 0], [0, 0.025, 0], [0, 0, 0]]),
      qTrack('Head', [0, 1, 2], [[0, -0.08, 0], [0.05, 0.08, 0], [0, -0.08, 0]]),
      qTrack('LeftUpperArm', [0, 1, 2], [[0.08, 0, -0.12], [0.02, 0, -0.1], [0.08, 0, -0.12]]),
      qTrack('RightUpperArm', [0, 1, 2], [[0.08, 0, 0.12], [0.02, 0, 0.1], [0.08, 0, 0.12]]),
    ]),
    clip('Walk', 0.8, [
      vTrack('AvatarRoot', loop, [[0, 0, 0], [0, 0.045, 0], [0, 0, 0]]),
      qTrack('Torso', loop, [[0, 0, 0.06], [0, 0, -0.06], [0, 0, 0.06]]),
      qTrack('LeftUpperArm', loop, [[0.55, 0, -0.08], [-0.55, 0, -0.08], [0.55, 0, -0.08]]),
      qTrack('RightUpperArm', loop, [[-0.55, 0, 0.08], [0.55, 0, 0.08], [-0.55, 0, 0.08]]),
      qTrack('LeftThigh', loop, [[-0.44, 0, 0], [0.48, 0, 0], [-0.44, 0, 0]]),
      qTrack('RightThigh', loop, [[0.48, 0, 0], [-0.44, 0, 0], [0.48, 0, 0]]),
      qTrack('LeftShin', loop, [[0.28, 0, 0], [-0.3, 0, 0], [0.28, 0, 0]]),
      qTrack('RightShin', loop, [[-0.3, 0, 0], [0.28, 0, 0], [-0.3, 0, 0]]),
    ]),
    clip('Working', 1.2, [
      qTrack('Torso', [0, 0.6, 1.2], [[0.16, 0, 0], [0.2, 0, 0.02], [0.16, 0, 0]]),
      qTrack('Head', [0, 0.6, 1.2], [[0.28, 0, 0], [0.32, -0.06, 0], [0.28, 0, 0]]),
      qTrack('LeftUpperArm', [0, 0.3, 0.6, 0.9, 1.2], [[0.9, 0.1, -0.35], [0.98, 0.1, -0.32], [0.88, 0.1, -0.34], [0.99, 0.1, -0.31], [0.9, 0.1, -0.35]]),
      qTrack('RightUpperArm', [0, 0.3, 0.6, 0.9, 1.2], [[0.9, -0.1, 0.35], [0.88, -0.1, 0.31], [0.98, -0.1, 0.34], [0.86, -0.1, 0.32], [0.9, -0.1, 0.35]]),
      qTrack('LeftForeArm', [0, 0.6, 1.2], [[-0.8, 0, 0.08], [-0.65, 0, 0.16], [-0.8, 0, 0.08]]),
      qTrack('RightForeArm', [0, 0.6, 1.2], [[-0.8, 0, -0.08], [-0.65, 0, -0.16], [-0.8, 0, -0.08]]),
    ]),
    clip('Thinking', 2, [
      qTrack('Torso', [0, 1, 2], [[0.08, 0, 0], [0.1, 0, -0.03], [0.08, 0, 0]]),
      qTrack('Head', [0, 1, 2], [[0.24, -0.28, 0], [0.32, 0.22, 0], [0.24, -0.28, 0]]),
      qTrack('RightUpperArm', [0, 1, 2], [[0.98, -0.12, 0.36], [1.08, -0.12, 0.38], [0.98, -0.12, 0.36]]),
      qTrack('RightForeArm', [0, 1, 2], [[-1.35, 0, -0.24], [-1.46, 0, -0.22], [-1.35, 0, -0.24]]),
    ]),
    clip('ToolCall', 1, [
      qTrack('Torso', [0, 0.5, 1], [[0.08, 0, 0], [0.02, 0, 0.08], [0.08, 0, 0]]),
      qTrack('LeftUpperArm', [0, 0.5, 1], [[0.75, 0.1, -0.55], [1.25, 0.15, -0.68], [0.75, 0.1, -0.55]]),
      qTrack('LeftForeArm', [0, 0.5, 1], [[-0.42, 0, 0.06], [-0.18, 0, 0.12], [-0.42, 0, 0.06]]),
      qTrack('Head', [0, 0.5, 1], [[0.15, -0.12, 0], [0.08, 0.18, 0], [0.15, -0.12, 0]]),
    ]),
    clip('Blocked', 1.6, [
      qTrack('Torso', [0, 0.8, 1.6], [[0.28, 0, 0], [0.34, 0, 0], [0.28, 0, 0]]),
      qTrack('Head', [0, 0.8, 1.6], [[0.46, 0, 0], [0.5, 0, 0], [0.46, 0, 0]]),
      qTrack('LeftUpperArm', [0, 0.8, 1.6], [[0.7, 0, -0.44], [0.74, 0, -0.48], [0.7, 0, -0.44]]),
      qTrack('RightUpperArm', [0, 0.8, 1.6], [[0.7, 0, 0.44], [0.74, 0, 0.48], [0.7, 0, 0.44]]),
    ]),
    clip('Done', 1.4, [
      vTrack('AvatarRoot', [0, 0.35, 0.7, 1.4], [[0, 0, 0], [0, 0.08, 0], [0, 0.02, 0], [0, 0, 0]]),
      qTrack('LeftUpperArm', [0, 0.7, 1.4], [[0.15, 0, -0.18], [2.2, 0.1, -0.62], [0.15, 0, -0.18]]),
      qTrack('RightUpperArm', [0, 0.7, 1.4], [[0.15, 0, 0.18], [2.2, -0.1, 0.62], [0.15, 0, 0.18]]),
      qTrack('Head', [0, 0.7, 1.4], [[0, 0, 0], [-0.08, 0, 0], [0, 0, 0]]),
    ]),
    clip('Error', 0.5, [
      vTrack('AvatarRoot', [0, 0.125, 0.25, 0.375, 0.5], [[-0.025, 0, 0], [0.025, 0, 0], [-0.025, 0, 0], [0.025, 0, 0], [-0.025, 0, 0]]),
      qTrack('Torso', [0, 0.25, 0.5], [[0.06, 0, -0.08], [0.06, 0, 0.08], [0.06, 0, -0.08]]),
      qTrack('Head', [0, 0.25, 0.5], [[0.22, 0, -0.08], [0.22, 0, 0.08], [0.22, 0, -0.08]]),
      qTrack('RightUpperArm', [0, 0.25, 0.5], [[1.0, 0, 0.44], [0.7, 0, 0.3], [1.0, 0, 0.44]]),
    ]),
  ]
}

async function main() {
  const avatar = createAvatar()
  const scene = new THREE.Scene()
  scene.name = 'AgentOfficeAvatarScene'
  scene.add(avatar)

  const exporter = new GLTFExporter()
  const buffer = await exporter.parseAsync(scene, {
    binary: true,
    animations: createClips(),
    trs: true,
    onlyVisible: true,
  })
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(outFile, Buffer.from(buffer))
  const stat = await fs.stat(outFile)
  console.log(`Generated ${path.relative(path.resolve(import.meta.dirname, '..'), outFile)} (${stat.size} bytes)`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
