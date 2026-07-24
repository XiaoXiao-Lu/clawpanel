import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const memoryPage = readFileSync(new URL('../src/pages/memory.js', import.meta.url), 'utf8')
const memoryCommand = readFileSync(new URL('../src-tauri/src/commands/memory.rs', import.meta.url), 'utf8')
const memoryLocale = readFileSync(new URL('../src/locales/modules/memory.js', import.meta.url), 'utf8')

test('Memory ZIP export streams bytes instead of decoding files as UTF-8', () => {
  const exportSection = memoryCommand.slice(memoryCommand.indexOf('pub async fn export_memory_zip'))

  assert.match(exportSection, /openclaw_dir\(\)\.join\("exports"\)\.join\("memory"\)/)
  assert.match(exportSection, /fs::create_dir_all\(&export_dir\)/)
  assert.doesNotMatch(exportSection, /std::env::temp_dir\(\)/)
  assert.match(exportSection, /fs::File::open\(&full_path\)/)
  assert.match(exportSection, /std::io::copy\(&mut input,\s*&mut zip\)/)
  assert.doesNotMatch(exportSection, /fs::read_to_string\(&full_path\)/)
})

test('Memory page exposes the last ZIP export folder', () => {
  assert.match(memoryPage, /id="btn-open-export-folder"/)
  assert.match(memoryPage, /lastExportZipPath:\s*''/)
  assert.match(memoryPage, /state\.lastExportZipPath = zipPath/)
  assert.match(memoryPage, /#btn-open-export-folder'\)\.onclick = \(\) => openExportZipFolder\(state\)/)
  assert.match(memoryPage, /api\.openPath\(state\.lastExportZipPath,\s*'folder'\)/)
  assert.match(memoryLocale, /openExportFolder:\s*_\('查看打包目录'/)
  assert.match(memoryLocale, /openExportFolderFailed:\s*_\('打开打包目录失败'/)
})

test('Memory page uses the shared markdown renderer for complete table support', () => {
  assert.match(memoryPage, /import \{ renderMarkdown \} from '\.\.\/lib\/markdown\.js'/)
  assert.doesNotMatch(memoryPage, /engines\/hermes\/lib\/markdown-renderer/)
})
