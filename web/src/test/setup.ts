import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Sem globals do Vitest: a limpeza do DOM entre testes é registrada aqui.
afterEach(() => cleanup())
