import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const nodeSdk = readFileSync(new URL('../scripts/lib/skillhub-sdk.js', import.meta.url), 'utf8')
const rustSdk = readFileSync(new URL('../src-tauri/src/commands/skillhub.rs', import.meta.url), 'utf8')

test('Node SkillHub ZIP extractor confines entries to the target skill directory', () => {
  assert.match(nodeSdk, /function safeZipOutputPath\(targetRoot,\s*entryName\)/)
  assert.match(nodeSdk, /path\.resolve\(targetRoot,\s*normalizedName\)/)
  assert.match(nodeSdk, /!outPath\.startsWith\(rootWithSep\)/)
  assert.match(nodeSdk, /normalizedName\.startsWith\('\/'\)/)
})

test('Node SkillHub ZIP install rejects empty or non-skill archives', () => {
  assert.match(nodeSdk, /filesWritten === 0/)
  assert.match(nodeSdk, /path\.join\(targetRoot,\s*'SKILL\.md'\)/)
  assert.match(nodeSdk, /fs\.rmSync\(targetRoot,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/)
  assert.match(nodeSdk, /Skill zip 无效：缺少 SKILL\.md/)
})

test('Tauri SkillHub ZIP extractor confines entries and rolls back invalid skills', () => {
  assert.match(rustSdk, /fn safe_zip_output_path\(target_root: &Path,\s*entry_name: &str\)/)
  assert.match(rustSdk, /part == "\.\."/)
  assert.match(rustSdk, /out\.starts_with\(target_root\)/)
  assert.match(rustSdk, /files_written == 0/)
  assert.match(rustSdk, /target_root\.join\("SKILL\.md"\)\.exists\(\)/)
  assert.match(rustSdk, /remove_dir_all\(&target_root\)/)
})
