import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const mainJs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')

test('登录默认密码回填进入 HTML 属性前必须转义', () => {
  assert.match(
    mainJs,
    /const\s+defaultPwValue\s*=\s*hasDefault\s*\?\s*escapeHtml\(defaultPw\)\s*:\s*''/,
  )
  assert.match(
    mainJs,
    /value="\$\{defaultPwValue\}"/,
  )
  assert.doesNotMatch(
    mainJs,
    /value="\$\{hasDefault\s*\?\s*defaultPw\s*:\s*''\}"/,
  )
})
