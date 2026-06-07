import * as THREE from 'three'
import { t } from '../lib/i18n.js'

const AGENT_COLORS = [
  0x22c55e, 0xef4444, 0x7c3aed, 0x0ea5e9, 0xeab308, 0x14b8a6,
  0xf97316, 0x06b6d4, 0xa855f7, 0x84cc16, 0xec4899, 0x64748b,
]

const WORK_STATES = new Set(['queued', 'walking', 'working', 'tool_call', 'thinking', 'blocked', 'error', 'done'])

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
  parent.add(mesh)
  return mesh
}

function addCylinder(parent, radius, height, position, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, opts.segments || 18), makeMat(color, opts))
  mesh.position.set(position[0], position[1], position[2])
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

  addBox(root, [3.2, 0.18, 1.18], [0, 1.12, 0], 0xf8fafc)
  addBox(root, [0.58, 0.92, 0.74], [1.12, 0.52, 0.1], 0xe2e8f0)
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

  const privacy = addBox(root, [3.45, 0.52, 0.08], [0, 1.52, 0.62], 0xe2e8f0, {
    transparent: true,
    opacity: 0.62,
  })
  privacy.userData.kind = 'partition'

  return { root, monitor, lamp }
}

function createChair(position) {
  const root = new THREE.Group()
  root.position.copy(position)
  addBox(root, [0.82, 0.16, 0.72], [0, 0.72, 0.86], 0xf1f5f9)
  addBox(root, [0.82, 0.76, 0.14], [0, 1.08, 1.2], 0xf1f5f9)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 10), makeMat(0x94a3b8))
  stem.position.set(0, 0.36, 0.86)
  root.add(stem)
  return root
}

function createAgentAvatar(agent) {
  const root = new THREE.Group()
  root.userData.agent = agent
  root.userData.clickable = true

  const state = STATE_META[agent.officeState] || STATE_META.idle
  const bodyMat = makeMat(agent.officeState === 'offline' ? 0x64748b : 0x111827, {
    transparent: agent.officeState === 'offline',
    opacity: agent.officeState === 'offline' ? 0.55 : 1,
  })
  const accentMat = makeMat(agent.color || state.color)

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.86, 16), bodyMat)
  body.position.set(0, 0.95, 0)
  root.add(body)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 14), bodyMat)
  head.position.set(0, 1.52, 0)
  root.add(head)

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

  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.72, 10), bodyMat)
  leftArm.position.set(-0.54, 0.96, -0.03)
  leftArm.rotation.z = 0.24
  root.add(leftArm)

  const rightArm = leftArm.clone()
  rightArm.position.x = 0.54
  rightArm.rotation.z = -0.24
  root.add(rightArm)

  const leftFoot = addBox(root, [0.24, 0.12, 0.34], [-0.22, 0.15, -0.04], 0x111827)
  const rightFoot = addBox(root, [0.24, 0.12, 0.34], [0.22, 0.15, -0.04], 0x111827)

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.72, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1 })
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.set(0, 0.03, 0)
  root.add(shadow)

  for (const child of root.children) {
    child.userData.agent = agent
    child.userData.clickable = true
  }

  root.userData.parts = { body, head, visor, chest, statusBadge, leftArm, rightArm, leftFoot, rightFoot, antennaLight }
  return root
}

function createTextSprite(text) {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 80
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(15, 23, 42, 0.86)'
  if (ctx.roundRect) {
    ctx.roundRect(0, 0, 320, 80, 12)
    ctx.fill()
  } else {
    ctx.fillRect(0, 0, 320, 80)
  }
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 24px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(text).slice(0, 18), 160, 40)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(2.25, 0.56, 1)
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

export class AgentOfficeScene {
  constructor(container, options = {}) {
    this.container = container
    this.onSelect = options.onSelect || (() => {})
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

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xf8fafc)

    this.camera = new THREE.OrthographicCamera(-12, 12, 7, -7, 0.1, 100)
    this.camera.position.set(10, 9, 10)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
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
    this.handleVisibility = () => {
      if (document.hidden) this.stop()
      else this.start()
    }
    window.addEventListener('resize', this.handleResize)
    document.addEventListener('visibilitychange', this.handleVisibility)
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.addEventListener('pointerleave', this.handlePointerLeave)
    this.resize()
    this.start()
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xdbeafe, 1.25))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(4, 8, 5)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xe0f2fe, 0.55)
    fill.position.set(-6, 5, -3)
    this.scene.add(fill)
  }

  addRoom() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 23), makeMat(0xf7f7f4, { roughness: 0.9 }))
    floor.rotation.x = -Math.PI / 2
    this.root.add(floor)

    addBox(this.root, [11.2, 0.04, 0.1], [-3.8, 0.04, 3.4], 0xd9e2ec)
    addBox(this.root, [0.1, 0.04, 8.4], [-7.8, 0.04, -1.1], 0xd9e2ec)
    addBox(this.root, [7.8, 0.035, 2.0], [2.6, 0.035, 4.7], 0xecfeff)
    addBox(this.root, [7.8, 0.035, 2.0], [2.6, 0.036, -5.35], 0xfef3c7)
    addBox(this.root, [7.4, 0.032, 2.1], [2.6, 0.038, -0.55], 0xf1f5f9)

    addBox(this.root, [34, 0.16, 0.35], [0, 0.08, -11.2], 0xcbd5e1)
    addBox(this.root, [0.35, 0.16, 23], [-16.8, 0.08, 0], 0xcbd5e1)
    addBox(this.root, [34, 0.08, 0.18], [0, 3.1, -11.15], 0xe2e8f0)
    addBox(this.root, [0.18, 0.08, 23], [-16.75, 3.1, 0], 0xe2e8f0)
    addBox(this.root, [14.5, 0.06, 0.14], [6.2, 0.07, 10.2], 0xe2e8f0)
    addBox(this.root, [0.14, 0.06, 6.2], [14.7, 0.07, 5.1], 0xe2e8f0)

    for (let i = 0; i < 6; i += 1) {
      addBox(this.root, [0.05, 0.025, 19.0], [-12 + i * 4, 0.026, -0.2], 0xe5e7eb)
    }
    for (let i = 0; i < 5; i += 1) {
      addBox(this.root, [26.0, 0.025, 0.05], [0, 0.027, -7.5 + i * 3.5], 0xe5e7eb)
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

    addBox(this.root, [5.7, 0.08, 2.35], [-11.8, 0.05, 7.25], 0xe0f2fe)
    addBox(this.root, [2.65, 0.52, 0.78], [-12.25, 0.43, 7.2], 0x38bdf8)
    addBox(this.root, [1.2, 0.36, 1.0], [-9.8, 0.28, 7.55], 0xbae6fd)
    addBox(this.root, [2.6, 0.12, 1.05], [-12.25, 0.88, 7.78], 0x0ea5e9)
    addBox(this.root, [1.25, 0.08, 0.78], [-10.1, 0.78, 6.55], 0xf8fafc)

    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.16, 28), makeMat(0xffffff))
    table.position.set(-9.85, 0.55, 6.55)
    this.root.add(table)
    addBox(this.root, [0.7, 0.08, 0.42], [-9.85, 0.69, 6.55], 0x94a3b8)

    const meeting = new THREE.Group()
    meeting.position.set(8.9, 0, 6.0)
    addBox(meeting, [3.9, 0.18, 1.5], [0, 0.9, 0], 0xf8fafc)
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
    const nextIds = new Set(nextAgents.map(agent => agent.id))
    for (const [id, record] of this.agentRecords.entries()) {
      if (!nextIds.has(id)) {
        this.root.remove(record.group)
        disposeObject(record.group)
        this.agentRecords.delete(id)
      }
    }

    this.agents = nextAgents
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
      this.pickables.push(record.avatar, record.monitor, record.lamp)
    })

    this.fitCamera()
  }

  positionsForIndex(index) {
    const col = index % this.layout.cols
    const row = Math.floor(index / this.layout.cols)
    const x = this.layout.startX + col * this.layout.spacingX
    const z = this.layout.startZ + row * this.layout.spacingZ
    const desk = new THREE.Vector3(x, 0, z)
    const loungeSeats = [
      [-12.95, 0, 6.55],
      [-11.9, 0, 7.65],
      [-10.25, 0, 6.28],
      [-9.42, 0, 7.28],
      [-13.25, 0, 7.9],
      [-10.7, 0, 5.55],
    ]
    const seat = loungeSeats[index % loungeSeats.length]
    const rowOffset = Math.floor(index / loungeSeats.length) * 0.42
    const lounge = new THREE.Vector3(seat[0] + rowOffset, 0, seat[2] - rowOffset)
    const workOffset = ((index % 3) - 1) * 0.28
    const work = new THREE.Vector3(x + workOffset, 0, z + 0.9 + (index % 2) * 0.14)
    return { desk, lounge, work }
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
    record.selectRing.visible = record.agent.id === this.selectedAgentId
    record.selectRing.material.color.setHex(state.color)
    record.selectRing.material.emissive.setHex(state.color)
    record.selectRing.material.emissiveIntensity = 0.55
    this.updatePathLine(record, state.active || agent.officeState === 'walking' || agent.officeState === 'queued')
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

    if (previousState !== agent.officeState) {
      record.avatar.rotation.set(0, record.avatar.rotation.y, 0)
    }
  }

  updatePathLine(record, visible) {
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
      record.selectRing.visible = record.agent.id === this.selectedAgentId
    }
  }

  fitCamera() {
    const roomWidth = 33.5
    const roomHeight = 22.8
    const width = Math.max(roomWidth, this.layout.cols * this.layout.spacingX + 15)
    const height = Math.max(roomHeight, this.layout.rows * this.layout.spacingZ + 10)
    const aspect = Math.max(0.8, this.container.clientWidth / Math.max(1, this.container.clientHeight))
    this.camera.left = -width / 2
    this.camera.right = width / 2
    this.camera.top = height / 2 / aspect + 3.8
    this.camera.bottom = -height / 2 / aspect - 3.8
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
    this.renderer.render(this.scene, this.camera)
  }

  animateRecord(record, delta, elapsed) {
    const avatar = record.avatar
    const state = record.state
    const target = record.target
    if (state === 'idle') {
      const driftX = Math.sin(elapsed * 0.34 + record.idleSeed) * 0.34
      const driftZ = Math.cos(elapsed * 0.27 + record.idleSeed) * 0.24
      target.set(record.lounge.x + driftX, 0, record.lounge.z + driftZ)
    }
    const toTarget = this.tmpVec3.copy(target).sub(avatar.position)
    const distance = toTarget.length()
    const moving = distance > 0.035

    if (moving) {
      const step = Math.min(distance, delta * 3.1)
      toTarget.normalize()
      avatar.position.addScaledVector(toTarget, step)
      avatar.rotation.y = Math.atan2(toTarget.x, toTarget.z)
    } else {
      avatar.position.copy(target)
      const settledAngle = WORK_STATES.has(state) ? Math.PI : 0
      avatar.rotation.y += (settledAngle - avatar.rotation.y) * Math.min(1, delta * 4)
    }

    record.label.position.set(
      avatar.position.x,
      2.38 + record.labelOffset + Math.sin(elapsed * 1.1 + avatar.position.x) * 0.04,
      avatar.position.z
    )
    record.ring.position.x = avatar.position.x
    record.ring.position.z = avatar.position.z
    record.ring.rotation.z += delta * (state === 'error' ? 1.5 : 0.75)
    record.ring.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.06)
    record.selectRing.position.x = avatar.position.x
    record.selectRing.position.z = avatar.position.z
    record.selectRing.rotation.z -= delta * 0.9
    record.selectRing.scale.setScalar(1.22 + Math.sin(elapsed * 2.8) * 0.08)

    const parts = avatar.userData.parts || {}
    if (parts.head) parts.head.rotation.set(0, 0, 0)
    if (parts.leftArm) parts.leftArm.rotation.x = 0
    if (parts.rightArm) parts.rightArm.rotation.x = 0
    if (parts.statusBadge) parts.statusBadge.scale.setScalar(1)
    if (parts.visor) parts.visor.scale.set(1, 1, 1)
    if (record.lamp) record.lamp.scale.setScalar(1)
    record.monitor.material.emissiveIntensity = STATE_META[state]?.active ? 0.35 : 0.05

    parts.leftFoot.position.z = -0.04 + (moving ? Math.sin(elapsed * 8) * 0.08 : 0)
    parts.rightFoot.position.z = -0.04 + (moving ? Math.sin(elapsed * 8 + Math.PI) * 0.08 : 0)
    parts.leftArm.rotation.z = 0.24 + (moving ? Math.sin(elapsed * 8 + Math.PI) * 0.24 : 0)
    parts.rightArm.rotation.z = -0.24 + (moving ? Math.sin(elapsed * 8) * 0.24 : 0)

    avatar.position.y = 0
    avatar.rotation.z = 0
    if (state === 'idle') {
      avatar.position.y = Math.sin(elapsed * 1.4 + record.lounge.x) * 0.035
      parts.head.rotation.y = Math.sin(elapsed * 0.7) * 0.18
      parts.leftArm.rotation.z = 0.46 + Math.sin(elapsed * 1.8 + record.idleSeed) * 0.06
      parts.rightArm.rotation.z = -0.1 + Math.sin(elapsed * 1.4 + record.idleSeed) * 0.05
      parts.visor.scale.x = 0.82 + Math.sin(elapsed * 0.9 + record.idleSeed) * 0.08
    } else if (state === 'walking' || state === 'queued') {
      parts.head.rotation.y = Math.sin(elapsed * 3.2) * 0.08
      parts.statusBadge.scale.setScalar(1 + Math.sin(elapsed * 5) * 0.18)
    } else if (state === 'working' || state === 'tool_call') {
      parts.leftArm.rotation.x = Math.sin(elapsed * 7) * 0.28
      parts.rightArm.rotation.x = Math.sin(elapsed * 7 + Math.PI) * 0.28
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
      avatar.rotation.z = Math.sin(elapsed * 2.2) * 0.04
      parts.leftArm.rotation.z = 0.9
      parts.rightArm.rotation.z = -0.9
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
  container.innerHTML = `
    <div class="agent-office-panel-head">
      <div>
        <div class="agent-office-panel-kicker">${escHtml(state.label)}</div>
        <div class="agent-office-panel-title">${escHtml(agent.displayName || agent.identityName || agent.id)}</div>
      </div>
      <span class="agent-office-state-dot" style="background:#${state.color.toString(16).padStart(6, '0')}"></span>
    </div>
    <div class="agent-office-panel-grid">
      <div><span>ID</span><strong>${escHtml(agent.id)}</strong></div>
      <div><span>${tr('agents.labelModel', '模型')}</span><strong>${escHtml(model || tr('agents.notSet', '未设置'))}</strong></div>
      <div><span>${tr('agents.labelWorkspace', '工作区')}</span><strong title="${escHtml(agent.workspace || '')}">${escHtml(agent.workspace || tr('agents.notSet', '未设置'))}</strong></div>
      <div><span>${tr('agents.labelBindings', '渠道绑定')}</span><strong>${bindings}</strong></div>
      <div><span>${tr('agents.labelCurrentTask', '当前任务')}</span><strong>${escHtml(activity.taskTitle || tr('agents.noTask', '暂无任务'))}</strong></div>
      <div><span>${tr('agents.labelProgress', '进度')}</span><strong>${escHtml(activity.progressText || tr('agents.waitingSchedule', '等待调度'))}</strong></div>
      <div><span>来源</span><strong>${escHtml(activity.source || tr('agents.notSet', '未设置'))}</strong></div>
      <div><span>工具</span><strong>${escHtml(activity.toolName || tr('agents.notSet', '未设置'))}</strong></div>
      <div><span>更新时间</span><strong>${escHtml(formatTime(activity.updatedAt))}</strong></div>
    </div>
    <button class="btn btn-sm btn-primary agent-office-detail-btn" data-office-detail="${escHtml(agent.id)}">${tr('agents.enterDetail', '进入 Agent 详情')}</button>
  `
}
