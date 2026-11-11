import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ProjectStore } from './store.ts'

const tempDir = () => realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidw-')))

test('adicionar uma pasta a registra e a torna o projeto ativo', () => {
  const store = new ProjectStore(':memory:')
  const folder = tempDir()
  store.add(folder)

  const { projects, activeProjectId } = store.workspace()
  assert.equal(projects.length, 1)
  assert.equal(projects[0].path, folder)
  assert.equal(projects[0].name, path.basename(folder))
  assert.equal(activeProjectId, projects[0].id)
  assert.equal(store.active()?.path, folder)
})

test('adicionar a mesma pasta duas vezes não duplica', () => {
  const store = new ProjectStore(':memory:')
  const folder = tempDir()
  store.add(folder)
  store.add(`"${folder}"`) // caminho colado com aspas duplas
  store.add(`'${folder}'`) // caminho colado com aspas simples
  store.add(`${folder}${path.sep}`) // caminho com barra final
  assert.equal(store.workspace().projects.length, 1)
})

test('recusa caminho relativo, inexistente ou que não é pasta', () => {
  const store = new ProjectStore(':memory:')
  const file = path.join(tempDir(), 'arquivo.txt')
  writeFileSync(file, 'x')

  assert.throws(() => store.add('projetos/meu'), /caminho completo/)
  assert.throws(() => store.add(path.join(tempDir(), 'nao-existe')), /não encontrada/)
  assert.throws(() => store.add(file), /não encontrada/)
  assert.equal(store.workspace().projects.length, 0)
})

test('trocar e remover projetos atualiza o ativo', () => {
  const store = new ProjectStore(':memory:')
  store.add(tempDir())
  store.add(tempDir())
  const [first, second] = store.workspace().projects

  store.select(first.id)
  assert.equal(store.workspace().activeProjectId, first.id)

  store.remove(first.id)
  assert.equal(store.workspace().activeProjectId, null)
  assert.equal(store.active(), null)
  assert.deepEqual(
    store.workspace().projects.map((p) => p.id),
    [second.id],
  )
  assert.throws(() => store.select(first.id), /desconhecido/)
})

test('os dados sobrevivem a fechar e reabrir o banco', () => {
  const file = path.join(tempDir(), 'data.sqlite')
  const folder = tempDir()
  const first = new ProjectStore(file)
  first.add(folder)
  first.close()

  const reopened = new ProjectStore(file)
  assert.equal(reopened.active()?.path, folder)
  reopened.close()
})
