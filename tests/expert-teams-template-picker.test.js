import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/expert-teams.js', import.meta.url), 'utf8')
const locale = readFileSync(new URL('../src/locales/modules/expertTeams.js', import.meta.url), 'utf8')

test('template cadence label uses dedicated localized keys instead of the broken replace', () => {
  // The old code did t('expertTeams.workflowRounds').replace(/{maxRounds}/, ...),
  // but workflowRounds has no {maxRounds} placeholder, so the round count was dropped.
  assert.doesNotMatch(
    page,
    /workflowRounds'\)\.replace/,
    'must not reuse workflowRounds (no placeholder) for the template meta',
  )
  assert.match(page, /function templateCadenceLabel\(/, 'cadence helper should exist')
  assert.match(page, /templateCadenceLabel\(tpl\)/, 'template meta should call the cadence helper')
  // Both new keys must exist with a {count} placeholder.
  assert.match(locale, /templateMetaRounds: _\([^)]*\{count\}/, 'templateMetaRounds must use {count}')
  assert.match(locale, /templateMetaParallel: _\([^)]*\{count\}/, 'templateMetaParallel must use {count}')
})

test('group template picker is an accessible, dismissible dialog', () => {
  const start = page.indexOf('function showGroupTemplatePicker')
  assert.notEqual(start, -1)
  const body = page.slice(start, start + 2600)
  assert.match(body, /(role="dialog"|setAttribute\(['"]role['"], ['"]dialog['"]\))/, 'picker should be a dialog')
  assert.match(body, /(aria-modal="true"|setAttribute\(['"]aria-modal['"], ['"]true['"]\))/, 'picker should be modal')
  assert.match(body, /(aria-labelledby=|setAttribute\(['"]aria-labelledby['"])/, 'picker should be labelled')
  assert.match(body, /e\.key === 'Escape'/, 'Escape must close the picker')
  assert.match(body, /previousFocus|restoreFocus/, 'focus should be restored on close')
})