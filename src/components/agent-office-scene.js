import * as THREE from 'three'
import { t } from '../lib/i18n.js'

const AGENT_COLORS = [
  0x22c55e, 0xef4444, 0x7c3aed, 0x0ea5e9, 0xeab308, 0x14b8a6,
  0xf97316, 0x06b6d4, 0xa855f7, 0x84cc16, 0xec4899, 0x64748b,
]

const WORK_STATES = new Set(['queued', 'walking', 'working', 'tool_call', 'thinking', 'blocked', 'error', 'done'])
const SEATED_WORK_STATES = new Set(['working', 'tool_call', 'thinking', 'blocked', 'error', 'done'])
const COMPACT_AGENT_COUNT = 24
const DENSE_AGENT_COUNT = 50
const QUALITY_LABELS = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}
const VIEW_PRESETS = {
  overview: {
    position: [8.5, 16, 16.5],
    target: [0, 0, -0.6],
    minWidth: 34,
    minHeight: 22,
    padX: 12,
    padZ: 9,
  },
  work: {
    position: [6.4, 12.8, 14.2],
    target: [1.6, 0, -0.8],
    minWidth: 22,
    minHeight: 15,
    padX: 7,
    padZ: 6,
  },
  lounge: {
    position: [-8.8, 10.8, 13.2],
    target: [-11.6, 0, 7.05],
    minWidth: 12.5,
    minHeight: 9.5,
    padX: 0,
    padZ: 0,
  },
}

function tr(key, fallback, params) {
  const value = t(key, params)
  return value === key ? fallback : value
}

const STATE_META = {
  idle: { label: tr('agents.stateIdle', '空闲'), color: 0x2dd4bf, screen: 0x243042, active: false },
  queued: { label: tr('agents.stateQueued', '排队'), color: 0x38bdf8, screen: 0x2563eb, active: true },
  walking: { label: tr('agents.stateWalking', '移动中'), color: 0x818cf8, screen: 0x4f46e5, active: true },
  working: { label: tr('agents.stateWorking', '工作中'), color: 0x22c55e, screen: 0x16a34a, active: true },
  tool_call: { label: tr('agents.stateToolCall', '调用工具'), color: 0x06b6d4, screen: 0x0891b2, active: true },
  thinking: { label: tr('agents.stateThinking', '思考中'), color: 0xa855f7, screen: 0x7c3aed, active: true },
  blocked: { label: tr('agents.stateBlocked', '阻塞'), color: 0xf59e0b, screen: 0xd97706, active: true },
  error: { label: tr('agents.stateError', '异常'), color: 0xef4444, screen: 0xdc2626, active: true },
  done: { label: tr('agents.stateDone', '完成'), color: 0x84cc16, screen: 0x65a30d, active: true },
  offline: { label: tr('agents.stateOffline', '离线'), color: 0x94a3b8, screen: 0x475569, active: false },
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTime(value) {
  if (!value) return tr('agents.notSet', '未设置')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return tr('agents.notSet', '未设置')
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function normalizeAgent(agent, index) {
  const id = agent?.id || `agent-${index + 1}`
  const name = agent?.identityName || agent?.name || id
  const officeState = STATE_META[agent?.officeState] ? agent.officeState : 'idle'
  return {
    ...agent,
    id,
    displayName: String(name).split(',')[0].trim() || id,
    officeState,
    color: AGENT_COLORS[index % AGENT_COLORS.length],
  }
}

function layoutForAgents(count) {
  const safeCount = Math.max(1, count || 1)
  const cols = Math.max(2, Math.ceil(Math.sqrt(safeCount)))
  const rows = Math.max(1, Math.ceil(safeCount / cols))
  const spacingX = 4.8
  const spacingZ = 4.1
  const startX = -((cols - 1) * spacingX) / 2 + 1.3
  const startZ = -((rows - 1) * spacingZ) / 2 - 0.9
  return { cols, rows, spacingX, spacingZ, startX, startZ }
}

function makeMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.64,
    metalness: opts.metalness ?? 0.03,
    transparent: opts.transparent || false,
    opacity: opts.opacity ?? 1,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  })
}

function disposeObject(obj) {
  obj.traverse(child => {
    if (child.geometry) child.geometry.dispose()
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach(mat => {
        if (mat.map) mat.map.dispose()
        mat.dispose()
      })
    }
  })
}

function addBox(parent, size, position, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), makeMat(color, opts))
  mesh.position.set(position[0], position[1], position[2])
  mesh.castShadow = opts.castShadow ?? true
  mesh.receiveShadow = opts.receiveShadow ?? false
  mesh.userData.baseCastShadow = mesh.castShadow
  parent.add(mesh)
  return mesh
}

function addCylinder(parent, radius, height, position, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, opts.segments || 18), makeMat(color, opts))
  mesh.position.set(position[0], position[1], position[2])
  mesh.castShadow = opts.castShadow ?? true
  mesh.receiveShadow = opts.receiveShadow ?? false
  mesh.userData.baseCastShadow = mesh.castShadow
  parent.add(mesh)
  return mesh
}

function addSphere(parent, radius, position, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, opts.widthSegments || 18, opts.heightSegments || 12), makeMat(color, opts))
  mesh.position.set(position[0], position[1], position[2])
  mesh.scale.set(opts.scaleX || 1, opts.scaleY || 1, opts.scaleZ || 1)
  mesh.castShadow = opts.castShadow ?? true
  mesh.receiveShadow = opts.receiveShadow ?? false
  mesh.userData.baseCastShadow = mesh.castShadow
  parent.add(mesh)
  return mesh
}

function addSoftShadow(parent, size, position, opacity = 0.08) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity,
      depthWrite: false,
    })
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.set(size[0], size[1], 1)
  mesh.position.set(position[0], 0.018, position[1])
  mesh.renderOrder = -1
  mesh.userData.baseCastShadow = false
  parent.add(mesh)
  return mesh
}

function addPlant(parent, x, z) {
  const root = new THREE.Group()
  root.position.set(x, 0, z)
  addCylinder(root, 0.22, 0.42, [0, 0.24, 0], 0x94a3b8)
  const trunk = addCylinder(root, 0.045, 0.52, [0, 0.7, 0], 0x92400e)
  trunk.rotation.z = 0.08
  const leaves = [
    [-0.18, 1.03, 0, 0.38],
    [0.2, 1.05, 0.06, 0.34],
    [0.02, 1.26, -0.06, 0.36],
  ]
  for (const [lx, ly, lz, r] of leaves) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), makeMat(0x16a34a, { roughness: 0.72 }))
    leaf.scale.set(1, 0.65, 1)
    leaf.position.set(lx, ly, lz)
    leaf.castShadow = true
    root.add(leaf)
  }
  parent.add(root)
  return root
}

function addCeilingLight(parent, x, z, width = 1.8) {
  const lamp = addBox(parent, [width, 0.08, 0.18], [x, 3.35, z], 0xfef9c3, {
    emissive: 0xfef08a,
    emissiveIntensity: 0.45,
  })
  addBox(parent, [0.04, 0.5, 0.04], [x - width * 0.35, 3.62, z], 0xcbd5e1)
  addBox(parent, [0.04, 0.5, 0.04], [x + width * 0.35, 3.62, z], 0xcbd5e1)
  return lamp
}

function createDesk(position, state) {
  const root = new THREE.Group()
  root.position.copy(position)

  addSoftShadow(root, [2.05, 0.9], [0.12, 0.18], 0.065)
  addBox(root, [3.2, 0.18, 1.18], [0, 1.12, 0], 0xffffff)
  addBox(root, [0.58, 0.92, 0.74], [1.12, 0.52, 0.1], 0xe8eef5)
  addBox(root, [0.74, 0.08, 0.54], [-0.98, 1.24, 0.22], 0xcbd5e1)
  addBox(root, [0.4, 0.06, 0.26], [-0.44, 1.24, 0.24], 0x0f172a)

  const legMat = makeMat(0xcbd5e1)
  for (const x of [-1.35, 1.35]) {
    for (const z of [-0.42, 0.42]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.12, 8), legMat)
      leg.position.set(x, 0.56, z)
      root.add(leg)
    }
  }

  addBox(root, [0.18, 0.46, 0.12], [0, 1.55, -0.16], 0x94a3b8)
  const monitor = addBox(root, [1.34, 0.76, 0.08], [0, 1.98, -0.22], STATE_META[state]?.screen || STATE_META.idle.screen, {
    emissive: STATE_META[state]?.screen || STATE_META.idle.screen,
    emissiveIntensity: STATE_META[state]?.active ? 0.35 : 0.05,
  })
  monitor.userData.kind = 'monitor'

  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 12), makeMat(STATE_META[state]?.color || STATE_META.idle.color, {
    roughness: 0.25,
    emissive: STATE_META[state]?.color || STATE_META.idle.color,
    emissiveIntensity: 0.35,
  }))
  lamp.position.set(-1.34, 1.29, -0.38)
  lamp.userData.kind = 'lamp'
  root.add(lamp)

  const privacy = addBox(root, [3.45, 0.52, 0.08], [0, 1.52, 0.62], 0xe8eef5, {
    transparent: true,
    opacity: 0.5,
    castShadow: false,
  })
  privacy.userData.kind = 'partition'

  return { root, monitor, lamp }
}

function createChair(position) {
  const root = new THREE.Group()
  root.position.copy(position)
  addSoftShadow(root, [0.74, 0.54], [0, 0.92], 0.055)
  addBox(root, [0.82, 0.16, 0.72], [0, 0.72, 0.86], 0xf1f5f9)
  addBox(root, [0.82, 0.76, 0.14], [0, 1.08, 1.2], 0xf1f5f9)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 10), makeMat(0x94a3b8))
  stem.position.set(0, 0.36, 0.86)
  root.add(stem)
  return root
}

function createProceduralAgentAvatar(agent) {
  const root = new THREE.Group()
  root.userData.agent = agent
  root.userData.clickable = true
  root.userData.assetType = 'procedural-v2'

  const state = STATE_META[agent.officeState] || STATE_META.idle
  const bodyMat = makeMat(agent.officeState === 'offline' ? 0x64748b : 0x111827, {
    transparent: agent.officeState === 'offline',
    opacity: agent.officeState === 'offline' ? 0.55 : 1,
  })
  const accentMat = makeMat(agent.color || state.color)

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.86, 16), bodyMat)
  body.position.set(0, 0.95, 0)
  body.castShadow = true
  root.add(body)

  const backpack = addBox(root, [0.58, 0.58, 0.18], [0, 0.98, 0.38], 0x1f2937)
  const torsoStripe = addBox(root, [0.62, 0.08, 0.08], [0, 1.13, -0.42], agent.color || state.color, {
    emissive: agent.color || state.color,
    emissiveIntensity: 0.12,
  })

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 14), bodyMat)
  head.position.set(0, 1.52, 0)
  head.castShadow = true
  root.add(head)

  const headset = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.025, 8, 32, Math.PI * 1.08), bodyMat)
  headset.position.set(0, 1.56, 0)
  headset.rotation.set(Math.PI / 2, 0, Math.PI * 0.04)
  root.add(headset)
  const mic = addCylinder(root, 0.025, 0.34, [0.38, 1.43, -0.22], 0x111827, { segments: 8 })
  mic.rotation.z = Math.PI / 2.8

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.38, 8), bodyMat)
  antenna.position.set(0, 1.92, 0)
  root.add(antenna)
  const antennaLight = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), accentMat)
  antennaLight.position.set(0, 2.15, 0)
  root.add(antennaLight)

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.08), accentMat)
  visor.position.set(0, 1.56, -0.35)
  root.add(visor)

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.18, 0.5), accentMat)
  chest.position.set(0, 0.92, -0.28)
  root.add(chest)

  const statusBadge = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), accentMat)
  statusBadge.position.set(0.28, 1.02, -0.38)
  root.add(statusBadge)

  const leftShoulder = addSphere(root, 0.12, [-0.46, 1.2, -0.03], 0x1f2937, { scaleX: 1.15, scaleY: 0.82, scaleZ: 0.82 })
  const rightShoulder = addSphere(root, 0.12, [0.46, 1.2, -0.03], 0x1f2937, { scaleX: 1.15, scaleY: 0.82, scaleZ: 0.82 })
  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.72, 10), bodyMat)
  leftArm.position.set(-0.54, 0.96, -0.03)
  leftArm.rotation.z = 0.24
  root.add(leftArm)

  const rightArm = leftArm.clone()
  rightArm.position.x = 0.54
  rightArm.rotation.z = -0.24
  root.add(rightArm)
  const leftHand = addSphere(root, 0.105, [-0.64, 0.58, -0.05], agent.color || state.color)
  const rightHand = addSphere(root, 0.105, [0.64, 0.58, -0.05], agent.color || state.color)

  const leftLeg = addBox(root, [0.17, 0.56, 0.16], [-0.24, 0.43, 0], 0x111827)
  const rightLeg = addBox(root, [0.17, 0.56, 0.16], [0.24, 0.43, 0], 0x111827)
  const leftFoot = addBox(root, [0.24, 0.12, 0.34], [-0.22, 0.15, -0.04], 0x111827)
  const rightFoot = addBox(root, [0.24, 0.12, 0.34], [0.22, 0.15, -0.04], 0x111827)

  const focusPanel = addBox(root, [0.72, 0.34, 0.035], [0, 1.14, -0.62], state.screen, {
    emissive: state.screen,
    emissiveIntensity: 0.24,
    transparent: true,
    opacity: 0.78,
  })
  focusPanel.userData.kind = 'focusPanel'
  const progressA = addBox(root, [0.46, 0.035, 0.045], [-0.05, 1.2, -0.655], state.color, {
    emissive: state.color,
    emissiveIntensity: 0.22,
  })
  const progressB = addBox(root, [0.32, 0.035, 0.045], [-0.12, 1.08, -0.655], 0xffffff, {
    emissive: state.color,
    emissiveIntensity: 0.12,
  })
  focusPanel.visible = false
  progressA.visible = false
  progressB.visible = false

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.72, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1 })
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.set(0, 0.03, 0)
  shadow.renderOrder = -1
  root.add(shadow)

  for (const child of root.children) {
    child.userData.agent = agent
    child.userData.clickable = true
  }

  root.userData.parts = {
    body,
    head,
    backpack,
    torsoStripe,
    headset,
    mic,
    antenna,
    visor,
    chest,
    statusBadge,
    leftShoulder,
    rightShoulder,
    leftArm,
    rightArm,
    leftHand,
    rightHand,
    leftLeg,
    rightLeg,
    leftFoot,
    rightFoot,
    antennaLight,
    focusPanel,
    progressA,
    progressB,
  }
  return root
}

function createAgentAvatar(agent, options = {}) {
  return createProceduralAgentAvatar(agent, options)
}

function createTextSprite(text) {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 132
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
  if (ctx.roundRect) {
    ctx.roundRect(8, 8, 464, 116, 18)
    ctx.fill()
  } else {
    ctx.fillRect(8, 8, 464, 116)
  }
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)'
  ctx.lineWidth = 4
  if (ctx.roundRect) {
    ctx.roundRect(8, 8, 464, 116, 18)
    ctx.stroke()
  } else {
    ctx.strokeRect(8, 8, 464, 116)
  }
  ctx.fillStyle = '#0f172a'
  ctx.font = '800 44px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(text).slice(0, 14), 240, 66)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(2.75, 0.76, 1)
  return sprite
}

function createActivityRing(color) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.76, 0.025, 8, 40),
    makeMat(color, { emissive: color, emissiveIntensity: 0.4 })
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.06
  return ring
}

function createPathLine() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.09, 0, 0, 0.09, 0], 3))
  const material = new THREE.LineDashedMaterial({
    color: 0x64748b,
    dashSize: 0.32,
    gapSize: 0.22,
    transparent: true,
    opacity: 0.38,
  })
  const line = new THREE.Line(geometry, material)
  line.computeLineDistances()
  return line
}

function setPartVisible(part, visible) {
  if (part) part.visible = visible
}

function resetAvatarParts(parts) {
  if (parts.body) {
    parts.body.position.set(0, 0.95, 0)
    parts.body.rotation.set(0, 0, 0)
    parts.body.scale.set(1, 1, 1)
  }
  if (parts.backpack) {
    parts.backpack.position.set(0, 0.98, 0.38)
    parts.backpack.rotation.set(0, 0, 0)
    parts.backpack.scale.set(1, 1, 1)
  }
  if (parts.torsoStripe) {
    parts.torsoStripe.position.set(0, 1.13, -0.42)
    parts.torsoStripe.rotation.set(0, 0, 0)
    parts.torsoStripe.scale.set(1, 1, 1)
  }
  if (parts.head) {
    parts.head.position.set(0, 1.52, 0)
    parts.head.rotation.set(0, 0, 0)
  }
  if (parts.headset) {
    parts.headset.position.set(0, 1.56, 0)
    parts.headset.rotation.set(Math.PI / 2, 0, Math.PI * 0.04)
  }
  if (parts.mic) {
    parts.mic.position.set(0.38, 1.43, -0.22)
    parts.mic.rotation.set(0, 0, Math.PI / 2.8)
  }
  if (parts.antenna) {
    parts.antenna.position.set(0, 1.92, 0)
    parts.antenna.rotation.set(0, 0, 0)
  }
  if (parts.antennaLight) parts.antennaLight.position.set(0, 2.15, 0)
  if (parts.visor) {
    parts.visor.position.set(0, 1.56, -0.35)
    parts.visor.rotation.set(0, 0, 0)
    parts.visor.scale.set(1, 1, 1)
  }
  if (parts.chest) parts.chest.position.set(0, 0.92, -0.28)
  if (parts.statusBadge) {
    parts.statusBadge.position.set(0.28, 1.02, -0.38)
    parts.statusBadge.scale.setScalar(1)
  }
  if (parts.leftShoulder) {
    parts.leftShoulder.position.set(-0.46, 1.2, -0.03)
    parts.leftShoulder.rotation.set(0, 0, 0)
  }
  if (parts.rightShoulder) {
    parts.rightShoulder.position.set(0.46, 1.2, -0.03)
    parts.rightShoulder.rotation.set(0, 0, 0)
  }
  if (parts.leftArm) {
    parts.leftArm.position.set(-0.54, 0.96, -0.03)
    parts.leftArm.rotation.set(0, 0, 0.24)
  }
  if (parts.rightArm) {
    parts.rightArm.position.set(0.54, 0.96, -0.03)
    parts.rightArm.rotation.set(0, 0, -0.24)
  }
  if (parts.leftHand) {
    parts.leftHand.position.set(-0.64, 0.58, -0.05)
    parts.leftHand.scale.setScalar(1)
  }
  if (parts.rightHand) {
    parts.rightHand.position.set(0.64, 0.58, -0.05)
    parts.rightHand.scale.setScalar(1)
  }
  if (parts.leftLeg) {
    parts.leftLeg.position.set(-0.24, 0.43, 0)
    parts.leftLeg.rotation.set(0, 0, 0)
  }
  if (parts.rightLeg) {
    parts.rightLeg.position.set(0.24, 0.43, 0)
    parts.rightLeg.rotation.set(0, 0, 0)
  }
  if (parts.leftFoot) {
    parts.leftFoot.position.set(-0.22, 0.15, -0.04)
    parts.leftFoot.rotation.set(0, 0, 0)
  }
  if (parts.rightFoot) {
    parts.rightFoot.position.set(0.22, 0.15, -0.04)
    parts.rightFoot.rotation.set(0, 0, 0)
  }
  setPartVisible(parts.focusPanel, false)
  setPartVisible(parts.progressA, false)
  setPartVisible(parts.progressB, false)
}

function applySeatedPose(parts, kind, elapsed, seed, state) {
  const relax = kind === 'lounge'
  const lean = relax ? -0.12 : 0.06
  parts.body.position.set(0, 0.78, relax ? 0.08 : 0)
  parts.body.rotation.x = lean
  parts.body.scale.set(0.94, 0.82, 1)
  parts.backpack.position.set(0, 0.83, relax ? 0.38 : 0.34)
  parts.backpack.rotation.x = lean
  parts.torsoStripe.position.set(0, 0.91, -0.38)
  parts.torsoStripe.rotation.x = lean
  parts.head.position.set(0, 1.28, relax ? 0.02 : -0.03)
  parts.headset.position.set(0, 1.32, relax ? 0.02 : -0.03)
  parts.headset.rotation.set(Math.PI / 2, 0, Math.PI * 0.04)
  parts.mic.position.set(0.36, 1.2, -0.22)
  parts.mic.rotation.set(0, 0, Math.PI / 2.8)
  parts.antenna.position.set(0, 1.66, relax ? 0.02 : -0.03)
  parts.antennaLight.position.set(0, 1.89, relax ? 0.02 : -0.03)
  parts.visor.position.set(0, 1.32, -0.35)
  parts.chest.position.set(0, 0.78, -0.28)
  parts.statusBadge.position.set(0.28, 0.88, -0.38)

  const legZ = relax ? -0.38 : -0.27
  parts.leftLeg.position.set(-0.24, 0.48, legZ)
  parts.rightLeg.position.set(0.24, 0.48, legZ)
  parts.leftLeg.rotation.x = Math.PI / 2.35
  parts.rightLeg.rotation.x = Math.PI / 2.35
  parts.leftFoot.position.set(-0.25, 0.28, relax ? -0.78 : -0.66)
  parts.rightFoot.position.set(0.25, 0.28, relax ? -0.78 : -0.66)

  if (relax) {
    parts.leftShoulder.position.set(-0.44, 0.98, 0.03)
    parts.rightShoulder.position.set(0.44, 0.98, 0.03)
    parts.leftArm.position.set(-0.52, 0.82, 0.03)
    parts.rightArm.position.set(0.52, 0.82, 0.03)
    parts.leftArm.rotation.set(0.15, 0, 0.72)
    parts.rightArm.rotation.set(0.1, 0, -0.36)
    parts.leftHand.position.set(-0.72, 0.62, -0.1)
    parts.rightHand.position.set(0.63, 0.66, -0.12)
    parts.head.rotation.y = Math.sin(elapsed * 0.75 + seed) * 0.18
    parts.visor.scale.x = 0.78 + Math.sin(elapsed * 0.9 + seed) * 0.06
    return
  }

  parts.leftShoulder.position.set(-0.41, 1.04, -0.14)
  parts.rightShoulder.position.set(0.41, 1.04, -0.14)
  parts.leftArm.position.set(-0.42, 0.92, -0.26)
  parts.rightArm.position.set(0.42, 0.92, -0.26)
  parts.leftArm.rotation.set(1.05 + Math.sin(elapsed * 7) * 0.1, 0, 0.42)
  parts.rightArm.rotation.set(1.05 + Math.sin(elapsed * 7 + Math.PI) * 0.1, 0, -0.42)
  parts.leftHand.position.set(-0.48, 0.64, -0.56 + Math.sin(elapsed * 7) * 0.03)
  parts.rightHand.position.set(0.48, 0.64, -0.56 + Math.sin(elapsed * 7 + Math.PI) * 0.03)
  parts.head.rotation.x = state === 'thinking' ? -0.12 + Math.sin(elapsed * 2.1) * 0.05 : -0.06
  parts.head.rotation.y = state === 'thinking' ? Math.sin(elapsed * 1.6) * 0.16 : 0
  setPartVisible(parts.focusPanel, true)
  setPartVisible(parts.progressA, true)
  setPartVisible(parts.progressB, true)
  parts.focusPanel.scale.set(1, state === 'tool_call' ? 1.12 + Math.sin(elapsed * 6) * 0.08 : 1, 1)
  parts.progressA.scale.x = state === 'blocked' ? 0.48 : 0.85 + Math.sin(elapsed * 4) * 0.08
  parts.progressB.scale.x = state === 'error' ? 0.35 + Math.sin(elapsed * 9) * 0.12 : 0.62
}

export class AgentOfficeScene {
  constructor(container, options = {}) {
    this.container = container
    this.onSelect = options.onSelect || (() => {})
    this.onMetrics = options.onMetrics || null
    this.agents = []
    this.agentRecords = new Map()
    this.pickables = []
    this.clock = new THREE.Clock()
    this.pointer = new THREE.Vector2()
    this.raycaster = new THREE.Raycaster()
    this.tmpVec3 = new THREE.Vector3()
    this.running = false
    this.layout = layoutForAgents(0)
    this.hoveredAgent = null
    this.selectedAgentId = null
    this.viewMode = 'overview'
    this.compactMode = false
    this.denseMode = false
    this.qualityMode = 'high'
    this.qualityReason = 'initial'
    this.frameSamples = { frames: 0, elapsed: 0, fps: 0, labels: 0 }
    this.motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null
    this.reducedMotion = !!this.motionQuery?.matches

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xf8fafc)

    this.camera = new THREE.OrthographicCamera(-12, 12, 7, -7, 0.1, 100)
    this.applyCameraPreset()

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    this.root = new THREE.Group()
    this.scene.add(this.root)
    this.addLights()
    this.addRoom()

    this.tooltip = document.createElement('div')
    this.tooltip.className = 'agent-office-tooltip'
    this.container.appendChild(this.tooltip)

    this.handleResize = this.resize.bind(this)
    this.handlePointerDown = this.onPointerDown.bind(this)
    this.handlePointerMove = this.onPointerMove.bind(this)
    this.handlePointerLeave = () => this.setTooltip(null)
    this.handleMotionPreference = () => {
      this.reducedMotion = !!this.motionQuery?.matches
      for (const record of this.agentRecords.values()) this.refreshRecordVisibility(record)
    }
    this.handleVisibility = () => {
      if (document.hidden) this.stop()
      else this.start()
    }
    window.addEventListener('resize', this.handleResize)
    document.addEventListener('visibilitychange', this.handleVisibility)
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.addEventListener('pointerleave', this.handlePointerLeave)
    if (this.motionQuery?.addEventListener) {
      this.motionQuery.addEventListener('change', this.handleMotionPreference)
    } else {
      this.motionQuery?.addListener?.(this.handleMotionPreference)
    }
    this.resize()
    this.start()
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xe0f2fe, 1.45))
    const key = new THREE.DirectionalLight(0xffffff, 1.05)
    this.keyLight = key
    key.position.set(5.5, 10, 5.5)
    key.castShadow = true
    key.shadow.mapSize.width = 2048
    key.shadow.mapSize.height = 2048
    key.shadow.camera.left = -18
    key.shadow.camera.right = 18
    key.shadow.camera.top = 14
    key.shadow.camera.bottom = -14
    key.shadow.camera.near = 1
    key.shadow.camera.far = 28
    key.shadow.bias = -0.00025
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xe0f2fe, 0.62)
    fill.position.set(-6, 5, -3)
    this.scene.add(fill)
  }

  addRoom() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 23), makeMat(0xf9fafb, { roughness: 0.92 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.root.add(floor)

    addBox(this.root, [11.2, 0.035, 0.08], [-3.8, 0.035, 3.4], 0xe5edf6, { castShadow: false })
    addBox(this.root, [0.08, 0.035, 8.4], [-7.8, 0.035, -1.1], 0xe5edf6, { castShadow: false })
    addBox(this.root, [7.8, 0.025, 2.0], [2.6, 0.032, 4.7], 0xeefcff, { castShadow: false })
    addBox(this.root, [7.8, 0.025, 2.0], [2.6, 0.034, -5.35], 0xfff7d6, { castShadow: false })
    addBox(this.root, [7.4, 0.025, 2.1], [2.6, 0.036, -0.55], 0xf2f6fa, { castShadow: false })

    addBox(this.root, [34, 0.16, 0.35], [0, 0.08, -11.2], 0xd8e1ec, { castShadow: false })
    addBox(this.root, [0.35, 0.16, 23], [-16.8, 0.08, 0], 0xd8e1ec, { castShadow: false })
    addBox(this.root, [34, 0.08, 0.18], [0, 3.1, -11.15], 0xe8eef5, { castShadow: false })
    addBox(this.root, [0.18, 0.08, 23], [-16.75, 3.1, 0], 0xe8eef5, { castShadow: false })
    addBox(this.root, [14.5, 0.05, 0.12], [6.2, 0.06, 10.2], 0xe8eef5, { castShadow: false })
    addBox(this.root, [0.12, 0.05, 6.2], [14.7, 0.06, 5.1], 0xe8eef5, { castShadow: false })

    for (let i = 0; i < 6; i += 1) {
      addBox(this.root, [0.035, 0.018, 19.0], [-12 + i * 4, 0.024, -0.2], 0xedf2f7, { castShadow: false })
    }
    for (let i = 0; i < 5; i += 1) {
      addBox(this.root, [26.0, 0.018, 0.035], [0, 0.025, -7.5 + i * 3.5], 0xedf2f7, { castShadow: false })
    }

    for (let i = 0; i < 7; i += 1) {
      addBox(this.root, [1.25, 1.52, 0.07], [-13.4 + i * 1.55, 1.58, -10.98], 0xdbeafe, {
        transparent: true,
        opacity: 0.38,
        roughness: 0.22,
      })
    }
    for (let i = 0; i < 5; i += 1) {
      addBox(this.root, [0.07, 1.42, 1.28], [-16.55, 1.55, -6.2 + i * 1.55], 0xdbeafe, {
        transparent: true,
        opacity: 0.32,
        roughness: 0.22,
      })
    }

    addSoftShadow(this.root, [3.2, 1.5], [-11.55, 7.22], 0.06)
    addBox(this.root, [5.7, 0.06, 2.35], [-11.8, 0.045, 7.25], 0xe0f2fe, { castShadow: false })
    addBox(this.root, [2.65, 0.52, 0.78], [-12.25, 0.43, 7.2], 0x60a5fa)
    addBox(this.root, [1.2, 0.36, 1.0], [-9.8, 0.28, 7.55], 0xbfdbfe)
    addBox(this.root, [2.6, 0.12, 1.05], [-12.25, 0.88, 7.78], 0x2563eb)
    addBox(this.root, [1.25, 0.08, 0.78], [-10.1, 0.78, 6.55], 0xf8fafc)
    addBox(this.root, [0.98, 0.32, 0.82], [-9.1, 0.24, 6.35], 0xdbeafe)
    addBox(this.root, [0.98, 0.12, 0.82], [-9.1, 0.5, 6.35], 0x93c5fd)
    addBox(this.root, [1.05, 0.32, 0.8], [-13.2, 0.24, 8.08], 0xdbeafe)
    addBox(this.root, [1.05, 0.12, 0.8], [-13.2, 0.5, 8.08], 0x93c5fd)

    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.16, 28), makeMat(0xffffff))
    table.position.set(-9.85, 0.55, 6.55)
    this.root.add(table)
    addBox(this.root, [0.7, 0.08, 0.42], [-9.85, 0.69, 6.55], 0x94a3b8)

    const meeting = new THREE.Group()
    meeting.position.set(8.9, 0, 6.0)
    addSoftShadow(meeting, [2.8, 1.25], [0, 0], 0.055)
    addBox(meeting, [3.9, 0.18, 1.5], [0, 0.9, 0], 0xffffff)
    addBox(meeting, [1.1, 0.62, 0.16], [-2.35, 0.68, 0], 0xe2e8f0)
    addBox(meeting, [1.1, 0.62, 0.16], [2.35, 0.68, 0], 0xe2e8f0)
    addBox(meeting, [0.16, 0.62, 1.1], [0, 0.68, -1.08], 0xe2e8f0)
    addBox(meeting, [0.16, 0.62, 1.1], [0, 0.68, 1.08], 0xe2e8f0)
    addBox(meeting, [1.55, 0.72, 0.08], [0, 1.36, -0.78], 0x0f172a, {
      emissive: 0x2563eb,
      emissiveIntensity: 0.16,
    })
    this.root.add(meeting)

    addBox(this.root, [5.4, 1.35, 0.12], [1.5, 2.25, -9.78], 0xdbeafe)
    addBox(this.root, [1.15, 0.18, 0.08], [-0.35, 2.23, -9.68], 0x22c55e, { emissive: 0x22c55e, emissiveIntensity: 0.2 })
    addBox(this.root, [1.65, 0.18, 0.08], [1.35, 2.23, -9.68], 0x38bdf8, { emissive: 0x38bdf8, emissiveIntensity: 0.15 })
    addBox(this.root, [0.85, 0.18, 0.08], [3.15, 2.23, -9.68], 0xf59e0b, { emissive: 0xf59e0b, emissiveIntensity: 0.15 })

    for (let i = 0; i < 5; i += 1) {
      addBox(this.root, [1.45, 1.05, 0.08], [-6.2 + i * 1.7, 2.05, -10.02], i % 2 ? 0xe0f2fe : 0xf8fafc)
    }

    addPlant(this.root, -15.15, 8.55)
    addPlant(this.root, -7.2, 8.35)
    addPlant(this.root, 13.7, 7.35)
    addPlant(this.root, 13.7, -7.6)
    addCeilingLight(this.root, -10.8, 6.6, 2.2)
    addCeilingLight(this.root, 1.8, -1.2, 2.8)
    addCeilingLight(this.root, 8.9, 5.6, 2.3)
  }

  setAgents(agents = []) {
    const nextAgents = agents.map(normalizeAgent)
    const previousCompact = this.compactMode
    const previousDense = this.denseMode
    const previousCount = this.agents.length
    const nextIds = new Set(nextAgents.map(agent => agent.id))
    for (const [id, record] of this.agentRecords.entries()) {
      if (!nextIds.has(id)) {
        this.root.remove(record.group)
        disposeObject(record.group)
        this.agentRecords.delete(id)
      }
    }

    this.agents = nextAgents
    this.compactMode = this.agents.length > COMPACT_AGENT_COUNT
    this.denseMode = this.agents.length > DENSE_AGENT_COUNT
    if (previousCount !== this.agents.length || previousCompact !== this.compactMode || previousDense !== this.denseMode) {
      this.frameSamples = { frames: 0, elapsed: 0, fps: 0, labels: this.visibleLabelCount() }
    }
    this.applyQualityMode('agent-count')
    this.layout = layoutForAgents(this.agents.length)
    this.pickables = []

    this.agents.forEach((agent, index) => {
      const positions = this.positionsForIndex(index)
      let record = this.agentRecords.get(agent.id)
      if (!record) {
        record = this.createAgentRecord(agent, positions)
        this.agentRecords.set(agent.id, record)
        this.root.add(record.group)
      }
      this.updateRecord(record, agent, positions)
      this.applyRecordQuality(record)
      this.pickables.push(record.avatar, record.monitor, record.lamp)
    })

    this.fitCamera()
    this.emitMetrics(this.frameSamples.fps || 0)
  }

  resolveQualityMode() {
    const fps = this.frameSamples.fps || 0
    if (this.denseMode || this.agents.length > DENSE_AGENT_COUNT || (fps && fps < 32)) return 'low'
    if (this.compactMode || this.agents.length > COMPACT_AGENT_COUNT || (fps && fps < 48)) return 'medium'
    return 'high'
  }

  pixelRatioForQuality(mode) {
    const device = window.devicePixelRatio || 1
    if (mode === 'low') return Math.min(device, 0.9)
    if (mode === 'medium') return Math.min(device, 1.15)
    return Math.min(device, 1.5)
  }

  applyQualityMode(reason = 'auto') {
    const next = this.resolveQualityMode()
    const changed = next !== this.qualityMode
    this.qualityMode = next
    this.qualityReason = reason
    this.container.dataset.officeQuality = next
    this.renderer.setPixelRatio(this.pixelRatioForQuality(next))
    this.renderer.shadowMap.enabled = next !== 'low'
    if (this.keyLight?.shadow?.mapSize) {
      const size = next === 'high' ? 2048 : next === 'medium' ? 1024 : 512
      this.keyLight.shadow.mapSize.set(size, size)
    }
    if (changed) {
      for (const record of this.agentRecords.values()) {
        this.applyRecordQuality(record)
        this.refreshRecordVisibility(record)
      }
      this.resize()
    }
  }

  applyRecordQuality(record) {
    const parts = record.avatar.userData.parts || {}
    const selected = record.agent.id === this.selectedAgentId
    const lowDetail = this.qualityMode === 'low' && !selected
    const mediumDetail = this.qualityMode === 'medium' && !selected
    const visibleDetail = !lowDetail
    ;[
      parts.backpack,
      parts.torsoStripe,
      parts.headset,
      parts.mic,
      parts.leftShoulder,
      parts.rightShoulder,
      parts.leftHand,
      parts.rightHand,
    ].forEach(part => setPartVisible(part, visibleDetail))
    setPartVisible(parts.antenna, !lowDetail && !mediumDetail)
    setPartVisible(parts.antennaLight, !lowDetail)
    record.label.scale.set(this.qualityMode === 'low' ? 2.35 : this.qualityMode === 'medium' ? 2.55 : 2.75, this.qualityMode === 'low' ? 0.64 : 0.76, 1)
    record.group.traverse(child => {
      if (child.isMesh) {
        if (typeof child.userData.baseCastShadow !== 'boolean') child.userData.baseCastShadow = child.castShadow
        child.castShadow = this.qualityMode !== 'low' && child.userData.baseCastShadow
      }
    })
  }

  positionsForIndex(index) {
    const col = index % this.layout.cols
    const row = Math.floor(index / this.layout.cols)
    const x = this.layout.startX + col * this.layout.spacingX
    const z = this.layout.startZ + row * this.layout.spacingZ
    const desk = new THREE.Vector3(x, 0, z)
    const loungeSeats = [
      [-13.05, 0, 6.72, -0.6, -0.18, 0.1],
      [-11.62, 0, 7.82, 0.55, 0.2, -0.08],
      [-9.92, 0, 6.24, -0.5, -0.08, 0.16],
      [-8.72, 0, 7.1, 0.58, 0.18, -0.12],
      [-13.28, 0, 8.12, -0.58, 0.2, 0.2],
      [-10.58, 0, 5.34, 0.54, -0.18, -0.08],
    ]
    const seat = loungeSeats[index % loungeSeats.length]
    const rowOffset = Math.floor(index / loungeSeats.length) * 0.42
    const lounge = new THREE.Vector3(seat[0] + rowOffset * 0.5, 0, seat[2] - rowOffset * 0.32)
    const workOffset = ((index % 3) - 1) * 0.22
    const work = new THREE.Vector3(x + workOffset, 0, z + 1.03)
    return {
      desk,
      lounge,
      work,
      labelShiftX: seat[3] || 0,
      labelShiftZ: seat[4] || 0,
      labelShiftY: seat[5] || 0,
    }
  }

  createAgentRecord(agent, positions) {
    const group = new THREE.Group()
    const workstation = createDesk(positions.desk, agent.officeState)
    const chair = createChair(positions.desk)
    const avatar = createAgentAvatar(agent)
    const label = createTextSprite(agent.displayName)
    const ring = createActivityRing(STATE_META[agent.officeState]?.color || STATE_META.idle.color)
    const selectRing = createActivityRing(0x0f172a)
    const pathLine = createPathLine()

    avatar.position.copy(WORK_STATES.has(agent.officeState) ? positions.work : positions.lounge)
    label.position.set(avatar.position.x, 2.38, avatar.position.z)
    ring.position.x = avatar.position.x
    ring.position.z = avatar.position.z
    selectRing.position.x = avatar.position.x
    selectRing.position.z = avatar.position.z
    selectRing.scale.setScalar(1.22)
    selectRing.visible = false

    group.add(workstation.root, chair, pathLine, avatar, label, ring, selectRing)
    group.userData.agent = agent

    return {
      group,
      workstation: workstation.root,
      chair,
      monitor: workstation.monitor,
      lamp: workstation.lamp,
      avatar,
      label,
      ring,
      selectRing,
      pathLine,
      agent,
      state: agent.officeState,
      target: avatar.position.clone(),
      idleSeed: Math.random() * Math.PI * 2,
      labelOffset: (Math.random() - 0.5) * 0.28,
      labelShiftX: positions.labelShiftX || 0,
      labelShiftZ: positions.labelShiftZ || 0,
      labelShiftY: positions.labelShiftY || 0,
      labelBase: label.position.clone(),
      desk: positions.desk.clone(),
      lounge: positions.lounge.clone(),
      work: positions.work.clone(),
    }
  }

  updateRecord(record, agent, positions) {
    const previousState = record.state
    record.agent = agent
    record.state = agent.officeState
    record.group.userData.agent = agent
    record.avatar.userData.agent = agent
    record.label.userData.agent = agent
    record.desk.copy(positions.desk)
    record.lounge.copy(positions.lounge)
    record.work.copy(positions.work)
    record.labelShiftX = positions.labelShiftX || 0
    record.labelShiftZ = positions.labelShiftZ || 0
    record.labelShiftY = positions.labelShiftY || 0

    record.workstation.position.copy(positions.desk)
    record.chair.position.copy(positions.desk)
    record.target.copy(WORK_STATES.has(agent.officeState) ? positions.work : positions.lounge)

    const state = STATE_META[agent.officeState] || STATE_META.idle
    record.monitor.material.color.setHex(state.screen)
    record.monitor.material.emissive.setHex(state.screen)
    record.monitor.material.emissiveIntensity = state.active ? 0.4 : 0.05
    record.lamp.material.color.setHex(state.color)
    record.lamp.material.emissive.setHex(state.color)
    record.ring.material.color.setHex(state.color)
    record.ring.material.emissive.setHex(state.color)
    record.ring.visible = state.active
    record.selectRing.material.color.setHex(state.color)
    record.selectRing.material.emissive.setHex(state.color)
    record.selectRing.material.emissiveIntensity = 0.55
    this.refreshRecordVisibility(record)
    record.monitor.userData.agent = agent
    record.lamp.userData.agent = agent
    const parts = record.avatar.userData.parts || {}
    if (parts.visor?.material) {
      parts.visor.material.color.setHex(state.color)
      parts.visor.material.emissive.setHex(state.color)
      parts.visor.material.emissiveIntensity = state.active ? 0.18 : 0.04
    }
    if (parts.statusBadge?.material) {
      parts.statusBadge.material.color.setHex(state.color)
      parts.statusBadge.material.emissive.setHex(state.color)
      parts.statusBadge.material.emissiveIntensity = state.active ? 0.4 : 0.12
    }
    if (parts.antennaLight?.material) {
      parts.antennaLight.material.color.setHex(state.color)
      parts.antennaLight.material.emissive.setHex(state.color)
      parts.antennaLight.material.emissiveIntensity = state.active ? 0.35 : 0.1
    }
    if (parts.focusPanel?.material) {
      parts.focusPanel.material.color.setHex(state.screen)
      parts.focusPanel.material.emissive.setHex(state.screen)
    }
    if (parts.progressA?.material) {
      parts.progressA.material.color.setHex(state.color)
      parts.progressA.material.emissive.setHex(state.color)
    }
    if (parts.progressB?.material) {
      parts.progressB.material.emissive.setHex(state.color)
    }

    if (previousState !== agent.officeState) {
      record.avatar.rotation.set(0, record.avatar.rotation.y, 0)
    }
  }

  shouldShowLabel(record) {
    const state = STATE_META[record.state] || STATE_META.idle
    const selected = record.agent.id === this.selectedAgentId
    if (this.qualityMode === 'low') return selected || (state.active && this.agents.length <= 18)
    if (this.qualityMode === 'medium') return selected || state.active
    if (this.denseMode) return selected
    if (selected || state.active) return true
    return this.viewMode === 'lounge' && !this.compactMode
  }

  shouldShowPathLine(record, requestedVisible) {
    if (!requestedVisible || this.reducedMotion || this.denseMode || this.qualityMode === 'low') return false
    return !this.compactMode || record.agent.id === this.selectedAgentId
  }

  refreshRecordVisibility(record) {
    const state = STATE_META[record.state] || STATE_META.idle
    const active = state.active || record.state === 'walking' || record.state === 'queued'
    record.selectRing.visible = record.agent.id === this.selectedAgentId
    record.label.visible = this.shouldShowLabel(record)
    this.updatePathLine(record, active)
  }

  updatePathLine(record, requestedVisible) {
    const visible = this.shouldShowPathLine(record, requestedVisible)
    record.pathLine.visible = visible
    if (!visible) return
    const attr = record.pathLine.geometry.getAttribute('position')
    attr.setXYZ(0, record.lounge.x, 0.09, record.lounge.z)
    attr.setXYZ(1, record.work.x, 0.09, record.work.z)
    attr.needsUpdate = true
    record.pathLine.computeLineDistances()
  }

  setSelectedAgent(agentId) {
    this.selectedAgentId = agentId || null
    for (const record of this.agentRecords.values()) {
      this.applyRecordQuality(record)
      this.refreshRecordVisibility(record)
    }
  }

  setViewMode(mode) {
    this.viewMode = VIEW_PRESETS[mode] ? mode : 'overview'
    this.applyCameraPreset()
    this.fitCamera()
  }

  applyCameraPreset() {
    const preset = VIEW_PRESETS[this.viewMode] || VIEW_PRESETS.overview
    this.camera.position.set(...preset.position)
    this.camera.lookAt(...preset.target)
  }

  fitCamera() {
    const preset = VIEW_PRESETS[this.viewMode] || VIEW_PRESETS.overview
    const roomWidth = 33.5
    const roomHeight = 22.8
    let width = Math.max(preset.minWidth, this.layout.cols * this.layout.spacingX + preset.padX)
    let height = Math.max(preset.minHeight, this.layout.rows * this.layout.spacingZ + preset.padZ)
    if (this.viewMode === 'overview') {
      width = Math.max(roomWidth, width)
      height = Math.max(roomHeight, height)
    }
    const aspect = Math.max(0.8, this.container.clientWidth / Math.max(1, this.container.clientHeight))
    const viewHeight = Math.max(height, width / aspect)
    const viewWidth = viewHeight * aspect
    this.camera.left = -viewWidth / 2
    this.camera.right = viewWidth / 2
    this.camera.top = viewHeight / 2
    this.camera.bottom = -viewHeight / 2
    this.camera.updateProjectionMatrix()
  }

  pickAgent(event) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.pickables, true)[0]
    return hit?.object?.userData?.agent || hit?.object?.parent?.userData?.agent || null
  }

  onPointerDown(event) {
    const agent = this.pickAgent(event)
    if (agent) this.onSelect(agent)
  }

  onPointerMove(event) {
    const agent = this.pickAgent(event)
    if (!agent) {
      this.setTooltip(null)
      return
    }
    this.setTooltip(agent, event)
  }

  setTooltip(agent, event) {
    if (!agent) {
      this.tooltip.classList.remove('is-visible')
      this.hoveredAgent = null
      return
    }
    if (this.hoveredAgent !== agent.id) {
      const state = STATE_META[agent.officeState] || STATE_META.idle
      this.tooltip.innerHTML = `<strong>${escHtml(agent.displayName || agent.id)}</strong><span>${escHtml(state.label)}</span>`
      this.hoveredAgent = agent.id
    }
    const rect = this.container.getBoundingClientRect()
    this.tooltip.style.left = `${Math.min(rect.width - 170, Math.max(12, event.clientX - rect.left + 14))}px`
    this.tooltip.style.top = `${Math.min(rect.height - 58, Math.max(12, event.clientY - rect.top + 14))}px`
    this.tooltip.classList.add('is-visible')
  }

  resize() {
    const width = Math.max(420, this.container.clientWidth || 420)
    const height = Math.max(430, this.container.clientHeight || 520)
    this.renderer.setSize(width, height, false)
    this.fitCamera()
  }

  start() {
    if (this.running) return
    this.running = true
    this.clock.getDelta()
    this.animate()
  }

  stop() {
    this.running = false
  }

  animate() {
    if (!this.running) return
    requestAnimationFrame(() => this.animate())
    const delta = Math.min(0.05, this.clock.getDelta())
    const elapsed = this.clock.getElapsedTime()

    for (const record of this.agentRecords.values()) {
      this.animateRecord(record, delta, elapsed)
    }
    this.layoutLabels()
    this.recordPerformance(delta)
    this.renderer.render(this.scene, this.camera)
  }

  recordPerformance(delta) {
    this.frameSamples.frames += 1
    this.frameSamples.elapsed += delta
    if (this.frameSamples.elapsed < 1) return
    const fps = Math.round(this.frameSamples.frames / Math.max(0.001, this.frameSamples.elapsed))
    this.frameSamples = { frames: 0, elapsed: 0, fps, labels: this.visibleLabelCount() }
    this.applyQualityMode('fps')
    this.emitMetrics(fps)
  }

  visibleLabelCount() {
    return Array.from(this.agentRecords.values()).filter(record => record.label.visible).length
  }

  emitMetrics(fps = 0) {
    const renderInfo = this.renderer.info?.render || {}
    this.onMetrics?.({
      fps,
      agents: this.agents.length,
      labels: this.visibleLabelCount(),
      dense: this.denseMode,
      compact: this.compactMode,
      reducedMotion: this.reducedMotion,
      quality: this.qualityMode,
      qualityLabel: QUALITY_LABELS[this.qualityMode] || this.qualityMode,
      qualityReason: this.qualityReason,
      assetType: 'procedural-v2',
      drawCalls: renderInfo.calls || 0,
      triangles: renderInfo.triangles || 0,
      points: renderInfo.points || 0,
      lines: renderInfo.lines || 0,
      pixelRatio: Number(this.renderer.getPixelRatio?.() || 1).toFixed(2),
      shadows: !!this.renderer.shadowMap.enabled,
    })
  }

  layoutLabels() {
    const visible = []
    const viewHeight = Math.max(1, this.camera.top - this.camera.bottom)
    const pxPerWorld = Math.max(1, this.container.clientHeight / viewHeight)
    const rect = this.renderer.domElement.getBoundingClientRect()
    for (const record of this.agentRecords.values()) {
      if (!record.label.visible) continue
      record.label.position.copy(record.labelBase || record.label.position)
      const projected = this.tmpVec3.copy(record.label.position).project(this.camera)
      const width = record.label.scale.x * pxPerWorld
      const height = record.label.scale.y * pxPerWorld
      const x = (projected.x * 0.5 + 0.5) * rect.width
      const y = (-projected.y * 0.5 + 0.5) * rect.height
      visible.push({ record, x, y, width, height })
    }
    visible.sort((a, b) => a.y - b.y || a.x - b.x)
    const placed = []
    for (const item of visible) {
      let shiftPx = 0
      let attempts = 0
      while (attempts < 8) {
        const box = {
          left: item.x - item.width / 2,
          right: item.x + item.width / 2,
          top: item.y - item.height / 2 - shiftPx,
          bottom: item.y + item.height / 2 - shiftPx,
        }
        const hit = placed.find(other => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom))
        if (!hit) {
          placed.push(box)
          break
        }
        shiftPx += Math.min(28, hit.bottom - box.top + 8)
        attempts += 1
      }
      if (shiftPx > 0) item.record.label.position.y += shiftPx / pxPerWorld
    }
  }

  animateRecord(record, delta, elapsed) {
    const avatar = record.avatar
    const state = record.state
    const target = record.target
    const toTarget = this.tmpVec3.copy(target).sub(avatar.position)
    const distance = toTarget.length()
    const moving = distance > 0.035
    const seatedAtWork = SEATED_WORK_STATES.has(state) && !moving
    const seatedAtLounge = (state === 'idle' || state === 'offline') && !moving
    const seated = seatedAtWork || seatedAtLounge

    if (moving) {
      const step = Math.min(distance, delta * (this.reducedMotion ? 7 : 3.1))
      toTarget.normalize()
      avatar.position.addScaledVector(toTarget, step)
      avatar.rotation.y = Math.atan2(-toTarget.x, -toTarget.z)
    } else {
      avatar.position.copy(target)
      const settledAngle = seatedAtWork ? 0 : Math.PI * 0.08
      avatar.rotation.y += (settledAngle - avatar.rotation.y) * Math.min(1, delta * 4)
    }

    record.label.position.set(
      avatar.position.x + (record.labelShiftX || 0),
      (seated ? 2.08 : 2.38) + record.labelOffset + (record.labelShiftY || 0) + (this.reducedMotion ? 0 : Math.sin(elapsed * 1.1 + avatar.position.x) * 0.04),
      avatar.position.z + (record.labelShiftZ || 0)
    )
    record.labelBase = record.label.position.clone()
    record.ring.position.x = avatar.position.x
    record.ring.position.z = avatar.position.z
    record.ring.rotation.z += this.reducedMotion ? 0 : delta * (state === 'error' ? 1.5 : 0.75)
    record.ring.scale.setScalar(this.reducedMotion ? 1 : 1 + Math.sin(elapsed * 2.2) * 0.06)
    record.selectRing.position.x = avatar.position.x
    record.selectRing.position.z = avatar.position.z
    record.selectRing.rotation.z -= this.reducedMotion ? 0 : delta * 0.9
    record.selectRing.scale.setScalar(this.reducedMotion ? 1.22 : 1.22 + Math.sin(elapsed * 2.8) * 0.08)

    const parts = avatar.userData.parts || {}
    resetAvatarParts(parts)
    if (record.lamp) record.lamp.scale.setScalar(1)
    record.monitor.material.emissiveIntensity = STATE_META[state]?.active ? 0.35 : 0.05

    const gait = moving && !this.reducedMotion
    parts.leftFoot.position.z = -0.04 + (gait ? Math.sin(elapsed * 8) * 0.08 : 0)
    parts.rightFoot.position.z = -0.04 + (gait ? Math.sin(elapsed * 8 + Math.PI) * 0.08 : 0)
    parts.leftLeg.position.z = gait ? Math.sin(elapsed * 8 + Math.PI) * 0.04 : 0
    parts.rightLeg.position.z = gait ? Math.sin(elapsed * 8) * 0.04 : 0
    parts.leftArm.rotation.z = 0.24 + (gait ? Math.sin(elapsed * 8 + Math.PI) * 0.24 : 0)
    parts.rightArm.rotation.z = -0.24 + (gait ? Math.sin(elapsed * 8) * 0.24 : 0)
    if (parts.leftHand) parts.leftHand.position.x = -0.64 + (gait ? Math.sin(elapsed * 8 + Math.PI) * 0.08 : 0)
    if (parts.rightHand) parts.rightHand.position.x = 0.64 + (gait ? Math.sin(elapsed * 8) * 0.08 : 0)
    if (parts.backpack) parts.backpack.rotation.z = gait ? Math.sin(elapsed * 8) * 0.04 : 0

    avatar.position.y = 0
    avatar.rotation.z = 0
    if (seatedAtWork) {
      applySeatedPose(parts, 'work', this.reducedMotion ? 0 : elapsed, record.idleSeed, state)
      if (record.lamp) record.lamp.scale.setScalar(state === 'blocked' ? 1.08 : 1)
      record.monitor.material.emissiveIntensity = state === 'thinking'
        ? 0.28 + (this.reducedMotion ? 0 : Math.sin(elapsed * 2.5) * 0.08)
        : 0.35 + (this.reducedMotion ? 0 : Math.sin(elapsed * 4) * 0.08)
      if (this.reducedMotion) return
    } else if (seatedAtLounge) {
      applySeatedPose(parts, 'lounge', this.reducedMotion ? 0 : elapsed, record.idleSeed, state)
      if (!this.reducedMotion) avatar.position.y = Math.sin(elapsed * 1.1 + record.lounge.x) * 0.018
      if (this.reducedMotion) return
    } else if (this.reducedMotion) {
      return
    }

    if (state === 'walking' || state === 'queued') {
      avatar.position.y = Math.sin(elapsed * 8) * 0.035
      parts.head.rotation.y = Math.sin(elapsed * 3.2) * 0.08
      parts.statusBadge.scale.setScalar(1 + Math.sin(elapsed * 5) * 0.18)
      parts.visor.scale.x = 0.92 + Math.sin(elapsed * 6) * 0.04
    } else if (state === 'working' || state === 'tool_call') {
      record.monitor.material.emissiveIntensity = 0.35 + Math.sin(elapsed * 5) * 0.12
      parts.head.rotation.x = Math.sin(elapsed * 3.5) * 0.04
      if (state === 'tool_call') {
        record.ring.scale.setScalar(1.05 + Math.sin(elapsed * 7) * 0.18)
        parts.statusBadge.scale.setScalar(1 + Math.sin(elapsed * 8) * 0.25)
      }
    } else if (state === 'thinking') {
      avatar.rotation.y += Math.sin(elapsed * 1.1) * 0.1
      record.monitor.material.emissiveIntensity = 0.26 + Math.sin(elapsed * 2.5) * 0.1
      parts.head.rotation.y = Math.sin(elapsed * 2.1) * 0.22
      record.ring.rotation.z += delta * 1.6
    } else if (state === 'blocked') {
      avatar.rotation.z = Math.sin(elapsed * 2.2) * 0.025
      parts.leftArm.rotation.z = 0.78
      parts.rightArm.rotation.z = -0.78
      record.lamp.scale.setScalar(1.08 + Math.sin(elapsed * 3.5) * 0.12)
    } else if (state === 'error') {
      avatar.rotation.z = Math.sin(elapsed * 6) * 0.035
      record.lamp.scale.setScalar(1 + Math.sin(elapsed * 8) * 0.18)
      parts.head.rotation.z = Math.sin(elapsed * 8) * 0.08
      parts.statusBadge.scale.setScalar(1.15 + Math.sin(elapsed * 10) * 0.28)
    } else if (state === 'done') {
      record.ring.scale.setScalar(1.08 + Math.sin(elapsed * 4) * 0.12)
      avatar.position.y = Math.sin(elapsed * 5) * 0.04
    }
  }

  dispose() {
    this.stop()
    window.removeEventListener('resize', this.handleResize)
    document.removeEventListener('visibilitychange', this.handleVisibility)
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.handlePointerLeave)
    if (this.motionQuery?.removeEventListener) {
      this.motionQuery.removeEventListener('change', this.handleMotionPreference)
    } else {
      this.motionQuery?.removeListener?.(this.handleMotionPreference)
    }
    disposeObject(this.root)
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.tooltip.remove()
  }
}

export function renderAgentOfficePanel(container, agent) {
  if (!container) return
  if (!agent) {
    container.innerHTML = `
      <div class="agent-office-panel-empty">
        <div class="agent-office-panel-title">选择一个 Agent</div>
        <div class="agent-office-panel-desc">点击办公室里的角色或工位，查看模型、工作区、绑定渠道和当前状态。</div>
      </div>
    `
    return
  }
  const state = STATE_META[agent.officeState] || STATE_META.idle
  const model = typeof agent.model === 'object' ? (agent.model?.primary || agent.model?.id || '') : (agent.model || '')
  const bindings = Array.isArray(agent.bindings) ? agent.bindings.length : (agent.bindingCount || 0)
  const activity = agent.activity || {}
  const agentName = agent.displayName || agent.identityName || agent.id
  const workspace = agent.workspace || tr('agents.notSet', '未设置')
  const taskTitle = activity.taskTitle || tr('agents.noTask', '暂无任务')
  const progress = activity.progressText || tr('agents.waitingSchedule', '等待调度')
  const initial = String(agentName || 'A').trim().slice(0, 1).toUpperCase()
  container.innerHTML = `
    <div class="agent-office-profile">
      <div class="agent-office-avatar" style="--agent-color:#${state.color.toString(16).padStart(6, '0')}">${escHtml(initial)}</div>
      <div class="agent-office-profile-main">
        <div class="agent-office-panel-kicker">${escHtml(state.label)}</div>
        <div class="agent-office-panel-title">${escHtml(agentName)}</div>
        <div class="agent-office-panel-sub">${escHtml(model || tr('agents.notSet', '未设置'))}</div>
      </div>
      <span class="agent-office-status-pill" style="--agent-color:#${state.color.toString(16).padStart(6, '0')}">${escHtml(state.label)}</span>
    </div>
    <div class="agent-office-task-card">
      <div>
        <span>${tr('agents.labelCurrentTask', '当前任务')}</span>
        <strong>${escHtml(taskTitle)}</strong>
      </div>
      <p>${escHtml(progress)}</p>
    </div>
    <div class="agent-office-panel-grid agent-office-panel-grid--compact">
      <div><span>ID</span><strong>${escHtml(agent.id)}</strong></div>
      <div><span>${tr('agents.labelWorkspace', '工作区')}</span><strong title="${escHtml(agent.workspace || '')}">${escHtml(workspace)}</strong></div>
      <div><span>${tr('agents.labelBindings', '渠道绑定')}</span><strong>${bindings}</strong></div>
      <div><span>工具</span><strong>${escHtml(activity.toolName || tr('agents.notSet', '未设置'))}</strong></div>
      <div><span>更新时间</span><strong>${escHtml(formatTime(activity.updatedAt))}</strong></div>
      <div><span>来源</span><strong>${escHtml(activity.source || tr('agents.notSet', '未设置'))}</strong></div>
    </div>
    <button class="btn btn-sm btn-primary agent-office-detail-btn" data-office-detail="${escHtml(agent.id)}">${tr('agents.enterDetail', '进入 Agent 详情')}</button>
  `
}
