const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@magnus/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
};

module.exports = createJestConfig(customJestConfig);
