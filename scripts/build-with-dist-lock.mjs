#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { withDistLock } from './lib/dist-lock.js'

const root = path.resolve(import.meta.dirname, '..')
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

withDistLock(root, 'vite-build', () => run(process.execPath, [viteCli, 'build'])).catch(error => {
  console.error(error)
  process.exit(1)
})
