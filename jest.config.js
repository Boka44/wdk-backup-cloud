// jest.config.js — CommonJS to avoid needing ts-node for config parsing
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testPathIgnorePatterns: ['/node_modules/', 'tests/jest/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
        diagnostics: {
          ignoreCodes: ['TS151001']
        }
      }
    ]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  setupFiles: ['<rootDir>/tests/jest/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!tests/**'
  ],
  coverageThreshold: {
    global: {
      lines: 90,
      branches: 80,
      functions: 90,
      statements: 90
    }
  },
  coverageReporters: ['text', 'lcov']
}
